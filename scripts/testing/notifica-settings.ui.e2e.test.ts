import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { runControlOmb } from "../control-omb.ts";

it("configures a bot's write-only Notifica connection through the real Portuguese settings", async () => {
  const child = spawn(process.execPath, ["--experimental-strip-types", join(fileURLToPath(new URL("../..", import.meta.url)), "scripts/control-omb.ts"), "ui", "launch", "--entry", "settings"],
    { cwd: fileURLToPath(new URL("../..", import.meta.url)), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout!.on("data", chunk => { stdout += String(chunk); }); child.stderr!.on("data", chunk => { stderr += String(chunk); });
  let info: { url: string; ui: string; botId: string; logPath: string } | undefined;
  try {
    await expect.poll(() => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("UI fixture failed: " + stderr);
      try { info = JSON.parse(stdout); return Boolean(info?.ui); } catch { return false; }
    }, { timeout: 120_000 }).toBe(true);
    const fixture = info!;
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", fixture.ui, ...args]) as Promise<any>;
    const evaluate = async (code: string) => (await ui("eval", "--js", code)).result;
    const snapshot = async () => (await ui("snapshot")).snapshot as string;
    const click = async (name: string) => {
      const refs = (await ui("snapshot")).refs as Record<string, { role: string; name: string }>;
      const item = Object.entries(refs).find(([, entry]) => entry.role === "button" && entry.name === name);
      expect(item, name).toBeDefined(); await ui("click", "--ref", "@" + item![0]);
    };
    await expect.poll(snapshot, { timeout: 20_000 }).toContain('button "Open settings"');
    await evaluate("(async () => { (await import('/src/lib/i18n.ts')).setLocale('pt-br'); return true; })()");
    await click("Open settings");
    await expect.poll(snapshot).toContain("Voz e alertas");
    await click("Voz e alertas");
    await expect.poll(snapshot).toContain("Chave privada deste bot");
    await ui("type", "--name", "Chave privada deste bot", "--text", "fixture-ui-private-key");
    const refs = (await ui("snapshot")).refs as Record<string, { role: string; name: string }>;
    const toggle = Object.entries(refs).find(([, entry]) => entry.role === "switch" && entry.name === "Ativar Notifica para este bot")!;
    await ui("click", "--ref", "@" + toggle[0]); await click("Salvar Notifica");
    await expect.poll(snapshot).toContain("Configuração do Notifica salva.");
    expect(await evaluate("document.querySelector('section[aria-label=Notifica] input[type=password]').value")).toBe("");
    const status = await (await fetch(`${fixture.url}/api/bots/${fixture.botId}/notifica`)).json();
    expect(status).toMatchObject({ configured: true, enabled: true, pending: [] }); expect(JSON.stringify(status)).not.toContain("fixture-ui-private-key");
    await ui("screenshot", "--out", fixture.logPath + ".notifica-settings.png");
    expect((await ui("console")).messages.filter((entry: { type: string }) => entry.type === "error")).toEqual([]);
    writeFileSync(fixture.logPath + ".notifica-settings.json", JSON.stringify({ status, snapshot: await snapshot() }, null, 2));
    console.log("Notifica settings UI evidence:", fixture.logPath);
  } catch (error) {
    if (info) writeFileSync(info.logPath + ".notifica-ui-failure.json", JSON.stringify(await runControlOmb(["ui", "snapshot", "--ui", info.ui]).catch(() => stderr), null, 2));
    throw error;
  } finally { await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 }); }
}, 200_000);
