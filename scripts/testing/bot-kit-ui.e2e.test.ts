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

(enabled ? it : it.skip)("builds and persists a character with the owner's body, face and adjustable accessory layers", async () => {
  const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/control-omb.ts", "ui", "launch"], {
    cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let error = "";
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { error += String(chunk); });
  let info: { ui: string; url: string; botId: string; logPath: string };
  try {
    await expect.poll(() => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(error);
      try { info = JSON.parse(output); return Boolean(info.ui); } catch { return false; }
    }, { timeout: 180_000, interval: 250 }).toBe(true);
    const api = async (path: string, body?: unknown, method = "PATCH", status = 200) => {
      const response = await fetch(info.url + path, body === undefined ? {} : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      expect(response.status, JSON.stringify(result)).toBe(status);
      return result;
    };
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", info.ui, ...args]) as Promise<any>;
    const snapshot = async () => (await ui("snapshot")).snapshot as string;
    const clickRole = async (role: string, name: string | RegExp) => {
      const refs = (await ui("snapshot")).refs as Record<string, { role: string; name: string }>;
      const match = Object.entries(refs).find(([, entry]) => entry.role === role && (typeof name === "string" ? entry.name === name : name.test(entry.name)));
      expect(match, String(name)).toBeDefined();
      return ui("click", "--ref", "@" + match![0]);
    };
    const saved = async () => (await api("/api/bots?messages=0")).bots.find((bot: any) => bot.id === info.botId);
    const evaluate = async (js: string) => (await ui("eval", "--js", js)).result;
    await api(`/api/bots/${info.botId}`, { name: "Layer Bot" });
    await ui("eval", "--js", "localStorage.setItem('omb-advanced-mode', '1'); location.reload(); true");
    await expect.poll(() => evaluate("document.documentElement.lang"), { timeout: 10_000 }).toBe("en");
    await expect.poll(snapshot, { timeout: 15_000 }).toContain("Actions for Layer Bot");
    await clickRole("button", /^Layer Bot Rename Layer Bot /);
    await clickRole("button", "Open Layer Bot's profile");
    if ((await snapshot()).includes("All settings")) await clickRole("button", /^All settings/);
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Identity");
    if (!(await snapshot()).includes('button "Identity" [expanded=true')) await clickRole("button", "Identity");
    await clickRole("button", "Build a character");
    await expect.poll(async () => (await saved()).mascotAppearance?.body, { timeout: 10_000 }).toBe("14-robo");
    await clickRole("button", "Use body: Kitten");
    await clickRole("button", "Use face: Wink");
    await clickRole("button", "Toggle accessory: Crown");
    await clickRole("button", "Toggle accessory: Round glasses");
    await expect.poll(async () => (await saved()).mascotAppearance?.accessories.length, { timeout: 10_000 }).toBe(2);
    await evaluate("document.querySelector('input[aria-label=\"Horizontal position\"]').focus(); true");
    await ui("press", "--keys", "ArrowRight");
    await expect.poll(async () => (await saved()).mascotAppearance?.accessories[1]?.x, { timeout: 10_000 }).toBe(1);
    await clickRole("button", "Use purple mascot color");
    await expect.poll(async () => (await saved()).color, { timeout: 10_000 }).toBe("purple");
    const customized = await saved();
    expect(customized.mascotAppearance).toMatchObject({ body: "17-gatinho", face: "04-piscadinha", accessories: [{ id: "01-coroa" }, { id: "04-oculos-redondos", x: 1 }] });
    const created = (await api("/api/bots", { name: "New kit bot", settings: { mascotAppearance: customized.mascotAppearance, color: "purple" } }, "POST", 201)).bot;
    expect(created.mascotAppearance).toEqual(customized.mascotAppearance);
    await expect.poll(() => evaluate("[...document.querySelectorAll('[data-mascot-kit=\"17-gatinho\"]')].filter(svg => svg.querySelectorAll('[data-kit-accessory]').length === 2).length"), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await evaluate("document.querySelector('[data-bot-settings-section=identity]').scrollIntoView({block:'start'}); true");
    const screenshot = info.logPath + ".bot-kit.png";
    await ui("screenshot", "--out", screenshot);
    await api(`/api/bots/${info.botId}`, { mascotAppearance: { body: "../unsafe" } }, "PATCH", 400);
    await ui("eval", "--js", "location.reload(); true");
    await expect.poll(() => evaluate("document.documentElement.lang"), { timeout: 10_000 }).toBe("en");
    await expect.poll(snapshot, { timeout: 15_000 }).toContain("Layer Bot");
    expect((await saved()).mascotAppearance).toEqual(customized.mascotAppearance);
    await clickRole("button", /^Layer Bot Rename Layer Bot /);
    await clickRole("button", "Open Layer Bot's profile");
    if ((await snapshot()).includes("All settings")) await clickRole("button", /^All settings/);
    if (!(await snapshot()).includes('button "Identity" [expanded=true')) await clickRole("button", "Identity");
    await expect.poll(() => evaluate("document.querySelector('button[aria-label=\"Use face: Wink\"]')?.getAttribute('aria-pressed')"), { timeout: 10_000 }).toBe("true");
    await clickRole("button", "Remove accessories");
    await expect.poll(async () => (await saved()).mascotAppearance?.accessories, { timeout: 10_000 }).toEqual([]);
    await clickRole("button", "Reset mascot");
    await expect.poll(async () => (await saved()).mascotAppearance, { timeout: 10_000 }).toBeNull();
    expect((await saved()).mascotBody).toBe("cursor");
    await evaluate("localStorage.setItem('omb-advanced-mode', '0'); location.reload(); true");
    await expect.poll(snapshot, { timeout: 15_000 }).toContain("Layer Bot");
    await clickRole("button", /^Layer Bot Rename Layer Bot /);
    await clickRole("button", "Open Layer Bot's profile");
    await clickRole("button", "Edit avatar");
    await clickRole("button", "Build a character");
    await clickRole("button", "Use body: Kitten");
    await clickRole("button", "Use face: Wink");
    await clickRole("button", "Toggle accessory: Crown");
    await expect.poll(async () => (await saved()).mascotAppearance, { timeout: 10_000 }).toMatchObject({ body: "17-gatinho", face: "04-piscadinha", accessories: [{ id: "01-coroa" }] });
    await ui("screenshot", "--out", info.logPath + ".bot-kit-simple.png");
    await clickRole("button", "Reset");
    await expect.poll(async () => (await saved()).mascotAppearance, { timeout: 10_000 }).toBeNull();
    writeFileSync(info.logPath + ".bot-kit.json", JSON.stringify({ customized, final: await saved(), screenshot, logPath: info.logPath }, null, 2));
    console.log("Bot character kit evidence:", info.logPath + ".bot-kit.json");
  } catch (failure) {
    if (info!) {
      const state = await runControlOmb(["ui", "snapshot", "--ui", info.ui]);
      writeFileSync(info.logPath + ".bot-kit-failure.json", JSON.stringify(state, null, 2));
    }
    throw failure;
  } finally { await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 }); }
}, 240_000);
