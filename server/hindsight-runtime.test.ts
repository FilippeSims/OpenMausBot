import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { HindsightRuntime } from "./hindsight-runtime.ts";
import type { HindsightConfig } from "./hindsight-memory.ts";
import { waitForExit } from "./testing/cleanup.ts";

it("preserves existing external services and does not silently enable missing runtimes", async () => {
  let config: HindsightConfig | undefined;
  const runtime = new HindsightRuntime({ dataDir: "/unused-fixture", config: () => config });
  expect(runtime.status()).toMatchObject({ mode: "external", enabled: false, embeddedAvailable: false });
  config = { enabled: true, url: "http://127.0.0.1:8888" };
  expect(runtime.mode()).toBe("external");
  expect(runtime.config()).toEqual(config);
  await runtime.reconcile();
  expect(runtime.processId()).toBeUndefined();
  await runtime.close();
});

const bundle = process.env.OMB_HINDSIGHT_VERIFY_BUNDLE;
it.skipIf(!bundle)("owns a private native API, survives restart and closes PostgreSQL with its parent", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-memory-runtime-"));
  let config: HindsightConfig | undefined;
  const runtime = new HindsightRuntime({ dataDir, bundle, config: () => config });
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    // An unconfigured packaged installation starts memory automatically.
    await runtime.reconcile();
    expect(runtime.status()).toMatchObject({ enabled: true, mode: "embedded", runtimeState: "ready" });
    const python = runtime.processId()!;
    const postgres = Number(readFileSync(join(dataDir, "hindsight-runtime/.pg0/instances/mausbot/data/postmaster.pid"), "utf8").split("\n")[0]);
    const endpoint = runtime.config()!.url!;
    expect((await fetch(`${endpoint}/health`)).status).toBe(401);
    const headers = { authorization: `Bearer ${runtime.apiKey()}` };
    expect((await fetch(`${endpoint}/health`, { headers })).status).toBe(200);
    const bank = `${endpoint}/v1/default/banks/omb-fixture`;
    const jsonHeaders = { ...headers, "content-type": "application/json" };
    expect((await fetch(bank + "/memories", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ async: false, items: [{ content: "The synthetic Aurora launch is on Friday.", document_id: "memory/example.md", timestamp: "unset", update_mode: "replace" }] }) })).status).toBe(200);
    const recall = async () => await (await fetch(bank + "/memories/recall", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ query: "When is the Aurora launch?", budget: "low", max_tokens: 256, types: ["world", "experience"] }) })).json() as { results: unknown[] };
    expect((await recall()).results.length).toBeGreaterThan(0);
    expect((await fetch(bank + "/documents/memory%2Fexample.md", { method: "DELETE", headers })).status).toBe(200);
    expect((await recall()).results).toEqual([]);
    for (const path of ["/mcp", "/docs", "/v1/default/banks/omb-fixture/reflect", "/v1/default/banks/omb-fixture"]) {
      expect((await fetch(endpoint + path, { method: "POST", headers })).status).toBe(404);
    }
    const destination = runtime.destination();
    config = { enabled: false, mode: "embedded" };
    await runtime.reconcile();
    await expect.poll(() => alive(python) || alive(postgres), { timeout: 10_000 }).toBe(false);
    expect(runtime.status()).toMatchObject({ enabled: false, runtimeState: "stopped" });
    config = { enabled: true, mode: "embedded" };
    await runtime.reconcile();
    expect(runtime.status()).toMatchObject({ runtimeState: "ready" });
    expect(runtime.destination()).toBe(destination);
    const restartedPython = runtime.processId()!;
    const restartedPostgres = Number(readFileSync(join(dataDir, "hindsight-runtime/.pg0/instances/mausbot/data/postmaster.pid"), "utf8").split("\n")[0]);
    await runtime.close();
    await expect.poll(() => alive(restartedPython) || alive(restartedPostgres), { timeout: 10_000 }).toBe(false);
  } finally {
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}, 120_000);

it.skipIf(!bundle)("runs from a relocated bundle and exits its database after the owning app crashes", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-memory-crash-"));
  const relocated = join(dataDir, "resources with spaces");
  cpSync(bundle!, relocated, { recursive: true, verbatimSymlinks: true });
  const owner = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./testing/hindsight-owner.ts", import.meta.url)), relocated, dataDir], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  owner.stdout!.on("data", part => { output += part.toString(); });
  owner.stderr!.resume();
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    await expect.poll(() => output.includes("\n"), { timeout: 90_000 }).toBe(true);
    const pids = JSON.parse(output.trim()) as { python: number; postgres: number };
    await waitForExit(owner, { signal: "SIGKILL" });
    await expect.poll(() => alive(pids.python) || alive(pids.postgres), { timeout: 15_000 }).toBe(false);
  } finally {
    await waitForExit(owner, { signal: "SIGTERM" });
    rmSync(dataDir, { recursive: true, force: true });
  }
}, 120_000);
