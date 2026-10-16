import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve, sep } from "node:path";
import { checkHindsightConnection, type HindsightConfig } from "./hindsight-memory.ts";

type Mode = "embedded" | "external";
type RuntimeState = "stopped" | "starting" | "ready" | "error";
interface RuntimeOptions {
  dataDir: string;
  bundle?: string;
  config: () => HindsightConfig | undefined;
  changed?: () => void;
}

/** One app-owned process, with no dependency on Docker or the system Python. */
export class HindsightRuntime {
  private child?: ChildProcess;
  private task?: Promise<void>;
  private state: RuntimeState = "stopped";
  private token?: string;
  private url?: string;
  private generation = "";
  private closing = false;
  private retryAt = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private readonly home: string;
  private readonly options: RuntimeOptions;
  constructor(options: RuntimeOptions) {
    this.options = options;
    this.home = join(options.dataDir, "hindsight-runtime");
  }

  available(): boolean { return Boolean(this.options.bundle && existsSync(join(this.options.bundle, "runtime.json"))); }
  mode(config = this.options.config()): Mode {
    return config?.mode ?? (config?.url || !this.available() ? "external" : "embedded");
  }
  desired(): boolean { return this.options.config()?.enabled ?? (this.mode() === "embedded" && this.available()); }
  apiKey(): string | undefined { return this.mode() === "embedded" ? this.token : process.env.OMB_HINDSIGHT_API_KEY; }
  destination(): string | undefined { return this.mode() === "embedded" ? `embedded:${this.home}:${this.generation}` : undefined; }
  processId(): number | undefined { return this.child?.pid; }
  config(): HindsightConfig | undefined {
    const config = this.options.config();
    if (this.mode() === "external") return config;
    return { ...config, mode: "embedded", enabled: this.desired() && this.state === "ready", url: this.url };
  }
  status() {
    return { mode: this.mode(), embeddedAvailable: this.available(), runtimeState: this.state,
      enabled: this.desired(), ...(this.mode() === "embedded" ? {
        url: undefined, keyConfigured: false, pending: this.state === "starting",
        error: this.state === "error" ? "The built-in memory service could not start; local notes remain available." : null,
      } : {}) };
  }

  async reconcile(): Promise<void> {
    if (this.closing) return;
    if (this.task) { await this.task; if (!this.closing) return this.reconcile(); return; }
    const start = this.desired() && this.mode() === "embedded";
    if (!start) { await this.stopChild(); return; }
    if (this.state === "ready" || Date.now() < this.retryAt) return;
    this.task = this.start().finally(() => { this.task = undefined; });
    await this.task;
    if (!this.desired() || this.mode() !== "embedded" || this.closing) await this.stopChild();
  }

  private fail(): void {
    this.state = "error";
    this.retryAt = Date.now() + 30_000;
    clearTimeout(this.retryTimer);
    if (!this.closing) {
      this.retryTimer = setTimeout(() => { void this.reconcile(); }, 30_050);
      this.retryTimer.unref();
    }
    this.options.changed?.();
  }

  private async start(): Promise<void> {
    this.state = "starting";
    this.options.changed?.();
    try {
      if (!this.available()) throw new Error("Missing bundled runtime");
      const bundle = resolve(this.options.bundle!);
      const manifest = JSON.parse(readFileSync(join(bundle, "runtime.json"), "utf8")) as { version: number; target: string; interpreter: string };
      const python = resolve(bundle, manifest.interpreter);
      if (manifest.version !== 1 || manifest.target !== `${process.platform}-${process.arch}` || !python.startsWith(bundle + sep)) throw new Error("Wrong bundled runtime");
      mkdirSync(this.home, { recursive: true, mode: 0o700 });
      const credentials = join(this.home, "database-key");
      if (!existsSync(credentials)) writeFileSync(credentials, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
      const databaseKey = readFileSync(credentials, "utf8").trim();
      if (!/^[a-f0-9]{64}$/.test(databaseKey)) throw new Error("Invalid database credential");
      const generationFile = join(this.home, "database-generation");
      if (!existsSync(generationFile) || !existsSync(join(this.home, ".pg0", "instances", "mausbot", "data", "PG_VERSION"))) {
        writeFileSync(generationFile, randomBytes(16).toString("hex"), { mode: 0o600 });
      }
      this.generation = readFileSync(generationFile, "utf8").trim();
      const port = await freePort();
      this.token = randomBytes(32).toString("hex");
      this.url = `http://127.0.0.1:${port}`;
      // Do not inherit AI credentials, proxy settings, Python search paths or
      // Hindsight overrides from the desktop/server environment.
      const env: NodeJS.ProcessEnv = { HOME: this.home, USERPROFILE: this.home, TMPDIR: this.home, TEMP: this.home, TMP: this.home,
        PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1", LANG: "en_US.UTF-8" };
      for (const name of ["SYSTEMROOT", "WINDIR", "COMSPEC"]) if (process.env[name]) env[name] = process.env[name];
      if (process.platform === "win32") {
        env.LOCALAPPDATA = join(this.home, "AppData", "Local");
        env.APPDATA = join(this.home, "AppData", "Roaming");
        mkdirSync(env.LOCALAPPDATA, { recursive: true });
        mkdirSync(env.APPDATA, { recursive: true });
      }
      const child = spawn(python, ["-I", "-B", "-u", join(bundle, "launcher.py")], { cwd: this.home, env, windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
      this.child = child;
      // Runtime errors are reported with a safe status; engine logs can include
      // database URIs or note text, so never relay raw stderr to app logs/UI.
      const log = join(this.home, "runtime.log");
      writeFileSync(log, "", { mode: 0o600 });
      let logged = 0;
      child.stderr?.on("data", (part: Buffer) => {
        if (logged > 1_048_576) return;
        logged += part.length;
        const safe = part.toString("utf8").replaceAll(databaseKey, "[redacted]").replaceAll(this.token ?? "[no-token]", "[redacted]");
        try { appendFileSync(log, safe); } catch { /* Diagnostics must not break shutdown. */ }
      });
      child.stdin?.on("error", () => {});
      child.on("error", () => { if (this.child === child) this.fail(); });
      child.on("exit", () => {
        if (this.child !== child) return;
        this.child = undefined;
        this.token = undefined;
        this.url = undefined;
        if (this.state !== "stopped" && !this.closing) this.fail();
      });
      child.stdin?.write(JSON.stringify({ token: this.token, port, databaseKey }) + "\n");
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline && this.child === child && !this.closing && this.desired() && this.mode() === "embedded") {
        const result = await checkHindsightConnection({ url: this.url }, this.token);
        if (result.ok) { this.state = "ready"; this.retryAt = 0; this.options.changed?.(); return; }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error("Runtime did not become ready");
    } catch {
      await this.stopChild();
      if (!this.closing && this.desired() && this.mode() === "embedded") this.fail();
    }
  }

  private async stopChild(): Promise<void> {
    clearTimeout(this.retryTimer);
    this.state = "stopped";
    const child = this.child;
    this.child = undefined;
    this.token = undefined;
    this.url = undefined;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.stdin?.end();
    });
    this.options.changed?.();
  }

  async close(): Promise<void> {
    this.closing = true;
    clearTimeout(this.retryTimer);
    await this.stopChild();
    await this.task;
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
