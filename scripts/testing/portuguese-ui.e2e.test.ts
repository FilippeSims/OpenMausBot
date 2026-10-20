import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { resolveAgentBrowserBinary } from "../../server/browser-engine.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { runControlOmb } from "../control-omb.ts";
import { UI_TOOLS_DIR } from "./control-omb-ui.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const enabled = process.env.OMB_UI_E2E === "1" || Boolean(resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env }));

(enabled ? it : it.skip)("uses Portuguese throughout bot settings, preserves user text and switches language without frozen labels", async () => {
  const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/control-omb.ts", "ui", "launch"], {
    cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "", error = "";
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { error += String(chunk); });
  let info: { ui: string; url: string; botId: string; logPath: string } | undefined;
  try {
    await expect.poll(() => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(error);
      try { info = JSON.parse(output); return Boolean(info?.ui); } catch { return false; }
    }, { timeout: 180_000, interval: 250 }).toBe(true);
    const fixture = info!;
    const api = async (path: string, body?: unknown) => {
      const response = await fetch(fixture.url + path, body === undefined ? {} : {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const value = await response.json();
      expect(response.ok, JSON.stringify(value)).toBe(true);
      return value;
    };
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", fixture.ui, ...args]) as Promise<any>;
    const snapshot = async () => (await ui("snapshot")).snapshot as string;
    const evaluate = async (js: string) => (await ui("eval", "--js", js)).result;
    const click = async (role: string, name: string | RegExp) => {
      const refs = (await ui("snapshot")).refs as Record<string, { role: string; name: string }>;
      const found = Object.entries(refs).find(([, entry]) => entry.role === role && (typeof name === "string" ? entry.name === name : name.test(entry.name)));
      expect(found, String(name)).toBeDefined();
      await ui("click", "--ref", "@" + found![0]);
    };
    const saved = async () => (await api("/api/bots?messages=0")).bots.find((bot: { id: string }) => bot.id === fixture.botId);
    await api(`/api/bots/${fixture.botId}`, { name: "Locale Bot", description: "Keep this exact English note" });
    await api("/api/config", { language: "pt-br" });
    await ui("eval", "--js", "location.reload(); true");
    await expect.poll(() => evaluate("document.documentElement.lang"), { timeout: 15_000 }).toBe("pt-BR");
    await expect.poll(snapshot, { timeout: 15_000 }).toContain("Locale Bot Renomear Locale Bot");
    await click("button", /^Locale Bot Renomear Locale Bot(?: |$)/);
    await click("button", /Abrir o perfil de Locale Bot/);
    await expect.poll(snapshot, { timeout: 10_000 }).toMatch(/Todas as configurações|Permissões/);
    if ((await snapshot()).includes("Todas as configurações")) await click("button", /^Todas as configurações/);
    await click("button", "Permissões");
    const permissions = await snapshot();
    expect(permissions).toContain('switch "Chefe Geral"');
    expect(permissions).toContain('switch "Chefe do time"');
    expect(permissions).toContain("Pedir minha aprovação antes de contatar outros bots");
    expect(permissions).not.toMatch(/All settings|Chief of Staff|Ask me before contacting other bots/);
    await click("switch", "Chefe Geral");
    await expect.poll(async () => (await saved()).globalChief, { timeout: 10_000 }).toBe(true);
    await click("switch", "Chefe Geral");
    await expect.poll(async () => (await saved()).globalChief, { timeout: 10_000 }).toBe(false);
    await click("button", "Identidade");
    const identity = await snapshot();
    expect(identity).toContain("Montar personagem");
    expect(identity).toContain("Clássico");
    for (const crop of ["Mascote", "Círculo", "Arredondado", "Quadrado"]) expect(identity).toContain(crop);
    expect(identity).not.toMatch(/button "(?:Mascot|Circle|Rounded|Square)"/);
    expect(identity).toMatch(/Cor/i);
    expect(await evaluate("[...document.querySelectorAll('input,textarea')].some(node => node.value === 'Keep this exact English note')")).toBe(true);
    const screenshot = fixture.logPath + ".portuguese.png";
    await ui("screenshot", "--out", screenshot);
    await api("/api/config", { language: "en" });
    await expect.poll(() => evaluate("document.documentElement.lang"), { timeout: 10_000 }).toBe("en");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain('button "Permissions"');
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Build a character");
    await api("/api/config", { language: "pt-br" });
    await expect.poll(() => evaluate("document.documentElement.lang"), { timeout: 10_000 }).toBe("pt-BR");
    await ui("eval", "--js", "location.reload(); true");
    await expect.poll(() => evaluate("document.documentElement.lang"), { timeout: 10_000 }).toBe("pt-BR");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain('button "Você"');
    await click("button", "Você");
    await click("menuitem", "Configurações");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Idioma do app");
    const settings = await snapshot();
    expect(settings).toContain("Configurações");
    expect(settings).not.toMatch(/App language|All settings|Model providers/);
    await ui("screenshot", "--out", fixture.logPath + ".portuguese-settings.png");
    expect((await saved()).description).toBe("Keep this exact English note");
    writeFileSync(fixture.logPath + ".portuguese.json", JSON.stringify({ permissions, identity, settings, screenshot, final: await saved(), logPath: fixture.logPath }, null, 2));
    console.log("Portuguese UI evidence:", fixture.logPath + ".portuguese.json");
  } catch (failure) {
    if (info) writeFileSync(info.logPath + ".portuguese-failure.json", JSON.stringify(await runControlOmb(["ui", "snapshot", "--ui", info.ui]), null, 2));
    throw failure;
  } finally {
    await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 });
  }
}, 240_000);
