import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { resolveAgentBrowserBinary } from "../../server/browser-engine.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { runControlOmb } from "../control-omb.ts";
import { agentBrowser, sessionEnv, UI_TOOLS_DIR, type UiHandle } from "./control-omb-ui.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const enabled = process.env.OMB_UI_E2E === "1" || Boolean(resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env }));

(enabled ? it : it.skip)("manages a team's visual references through the real file browser at desktop and phone sizes", async () => {
  const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/control-omb.ts", "ui", "launch"], {
    cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); });
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  let info: { ui: string; url: string; botId: string; logPath: string } | undefined;
  try {
    await expect.poll(() => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(stderr);
      try { info = JSON.parse(stdout); return Boolean(info?.ui); } catch { return false; }
    }, { timeout: 180_000, interval: 250 }).toBe(true);
    const fixture = info!;
    const api = async (path: string, method = "GET", body?: unknown) => {
      const response = await fetch(fixture.url + path, { method, headers: { "content-type": "application/json", origin: fixture.url },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value = await response.json();
      expect(response.ok, JSON.stringify(value)).toBe(true);
      return value as any;
    };
    await api(`/api/bots/${fixture.botId}`, "PATCH", { name: "Luna", title: "Designer", section: "Estúdio" });
    await api("/api/config", "PUT", { language: "pt-br" });
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", fixture.ui, ...args]) as Promise<any>;
    const evaluate = async (js: string) => (await ui("eval", "--js", js)).result;
    const snapshot = async () => (await ui("snapshot")).snapshot as string;
    const click = async (name: string, role = "button") => {
      let found: [string, { role: string; name: string }] | undefined;
      await expect.poll(async () => {
        const refs = (await ui("snapshot")).refs as Record<string, { role: string; name: string }>;
        found = Object.entries(refs).find(([, item]) => item.role === role && item.name === name);
        return Boolean(found);
      }, { timeout: 10_000 }).toBe(true);
      await ui("click", "--ref", "@" + found![0]);
    };
    await evaluate("location.reload(); true");
    await expect.poll(snapshot, { timeout: 15_000 }).toContain('tab "Times"');
    await click("Times", "tab");
    await click("Abrir time Estúdio");
    await click("Abrir arquivos de Estúdio");
    await expect.poll(snapshot).toContain("Abrir pasta Referências");
    await click("Abrir pasta Referências");
    await click("Nova pasta");
    await ui("type", "--name", "Nome da pasta", "--text", "Identidade Visual");
    await click("Salvar");
    await expect.poll(snapshot).toContain("Abrir pasta Identidade Visual");
    await click("Abrir pasta Identidade Visual");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#124a97"/><text x="32" y="72" fill="white" font-size="32">LUMEN</text></svg>';
    await evaluate(`(() => { const input = document.querySelector('[data-team-files-dialog] input[type=file]'); const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(svg)}], 'logo.svg', { type: 'image/svg+xml' })); input.files = data.files; input.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
    await expect.poll(snapshot).toContain("Ver prévia de logo.svg");
    await click("Ver prévia de logo.svg");
    await expect.poll(() => evaluate("(() => { const image = document.querySelector('[data-team-files-dialog] img'); return image?.complete && image.naturalWidth; })()")).toBe(240);
    const geometry = [];
    const browser = JSON.parse(readFileSync(fixture.ui, "utf8")) as UiHandle;
    for (const [width, height] of [[1280, 900], [390, 844]]) {
      await agentBrowser(browser.binary, sessionEnv(browser), ["set", "viewport", String(width), String(height)]);
      const bounds = await evaluate("(() => { const dialog = document.querySelector('[data-team-files-dialog]').getBoundingClientRect(); const img = document.querySelector('[data-team-files-dialog] img').getBoundingClientRect(); return {left:dialog.left,right:dialog.right,top:dialog.top,bottom:dialog.bottom,imageRight:img.right,scroll:document.documentElement.scrollWidth}; })()");
      expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(width);
      expect(bounds.top).toBeGreaterThanOrEqual(0); expect(bounds.bottom).toBeLessThanOrEqual(height);
      expect(bounds.imageRight).toBeLessThanOrEqual(width); expect(bounds.scroll).toBeLessThanOrEqual(width);
      geometry.push({ width, height, ...bounds });
      await ui("screenshot", "--out", fixture.logPath + `.team-files-${width}.png`);
    }
    await agentBrowser(browser.binary, sessionEnv(browser), ["set", "viewport", "1280", "900"]);
    await click("Fechar prévia do arquivo");
    await click("Renomear logo.svg");
    await evaluate("document.querySelector('[aria-label=\"Nome do arquivo ou pasta\"]').select(); true");
    await ui("press", "--keys", "Backspace");
    await ui("type", "--name", "Nome do arquivo ou pasta", "--text", "logo-principal.svg");
    await click("Salvar");
    await expect.poll(snapshot).toContain("Mover logo-principal.svg para a lixeira");
    await click("Mover logo-principal.svg para a lixeira");
    await expect.poll(snapshot).not.toContain("Ver prévia de logo-principal.svg");
    await click("Lixeira");
    await expect.poll(snapshot).toContain("Restaurar Referências/Identidade Visual/logo-principal.svg");
    await click("Restaurar Referências/Identidade Visual/logo-principal.svg");
    await click("Arquivos");
    await expect.poll(snapshot).toContain("Ver prévia de logo-principal.svg");
    const files = await api("/api/team-files?section=Est%C3%BAdio&path=Refer%C3%AAncias%2FIdentidade+Visual");
    expect(files.entries.map((entry: { name: string }) => entry.name)).toEqual(["logo-principal.svg"]);
    expect((await ui("console")).messages.filter((message: { type: string }) => message.type === "error")).toEqual([]);
    writeFileSync(fixture.logPath + ".team-files-ui.json", JSON.stringify({ geometry, files, logPath: fixture.logPath, final: await snapshot() }, null, 2));
    console.log("Team files UI evidence:", fixture.logPath);
  } catch (error) {
    if (info) writeFileSync(info.logPath + ".team-files-failure.json", JSON.stringify(await runControlOmb(["ui", "snapshot", "--ui", info.ui]), null, 2));
    throw error;
  } finally { await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 }); }
}, 240_000);
