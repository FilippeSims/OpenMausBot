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

(enabled ? it : it.skip)("grants and removes the independent global role through the real settings UI", async () => {
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
    const api = async (path: string, body?: unknown, method = "PATCH") => {
      const response = await fetch(info.url + path, body === undefined ? {} : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(result));
      return result;
    };
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", info.ui, ...args]) as Promise<any>;
    const snapshot = async () => (await ui("snapshot")).snapshot as string;
    const clickRole = async (role: string, name: string | RegExp) => {
      const refs = (await ui("snapshot")).refs as Record<string, { role: string; name: string }>;
      const match = Object.entries(refs).find(([, entry]) => entry.role === role && (typeof name === "string" ? entry.name === name : name.test(entry.name)));
      expect(match).toBeDefined();
      return ui("click", "--ref", "@" + match![0]);
    };
    const saved = async () => (await api("/api/bots?messages=0")).bots.find((bot: any) => bot.id === info.botId);
    const general = (await api("/api/bots", { name: "General Chief" }, "POST")).bot;
    await api(`/api/bots/${general.id}`, { chiefOfStaff: true });
    await api(`/api/bots/${info.botId}`, { name: "Director", section: "Leadership" });
    await ui("eval", "--js", "location.reload(); true");
    await expect.poll(snapshot, { timeout: 15_000 }).toContain("Actions for Director");
    await clickRole("button", /^Director Rename Director /);
    await expect.poll(snapshot, { timeout: 10_000 }).toContain("Open Director's profile");
    await clickRole("button", "Open Director's profile");
    await clickRole("button", "Permissions");
    await expect.poll(snapshot, { timeout: 10_000 }).toContain('switch "Global Chief"');
    await clickRole("switch", "Global Chief");
    await expect.poll(async () => (await saved()).globalChief, { timeout: 10_000 }).toBe(true);
    expect((await saved()).section).toBeUndefined();
    expect((await api("/api/bots?messages=0")).bots.find((bot: any) => bot.id === general.id).chiefOfStaff).toBe(true);
    const granted = await snapshot();
    expect(granted).toContain('switch "Global Chief" [checked=true');
    expect(granted).not.toContain("Additional teams");
    const placement = await ui("eval", "--js", `Boolean(document.querySelector('[data-global-chief="${info.botId}"]'))`);
    expect(placement.result).toBe(true);
    expect(granted.indexOf("Director Rename Director Global Chief")).toBeLessThan(granted.indexOf("General Chief Rename General Chief"));
    await ui("eval", "--js", `document.querySelector('[data-global-chief="${info.botId}"]').scrollIntoView({ block: 'start' }); true`);
    const screenshot = info.logPath + ".global-chief.png";
    await ui("screenshot", "--out", screenshot);
    await clickRole("switch", "Global Chief");
    await expect.poll(async () => (await saved()).globalChief, { timeout: 10_000 }).toBe(false);
    expect((await saved()).chiefOfStaff).toBe(false);
    await expect.poll(snapshot, { timeout: 10_000 }).toContain('switch "Chief of Staff"');
    writeFileSync(info.logPath + ".global-chief-ui.json", JSON.stringify({ granted, revoked: await snapshot(), final: await saved(), screenshot, logPath: info.logPath }, null, 2));
    console.log("Global Chief UI evidence:", info.logPath + ".global-chief-ui.json");
  } finally { await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 }); }
}, 240_000);
