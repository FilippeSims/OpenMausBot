import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { resolveAgentBrowserBinary } from "../../server/browser-engine.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { runControlOmb } from "../control-omb.ts";
import { agentBrowser, sessionEnv, UI_TOOLS_DIR, type UiHandle } from "./control-omb-ui.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const enabled = process.env.OMB_UI_E2E === "1" || Boolean(resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env }));
type FixtureInfo = { ui: string; url: string; botId: string; logPath: string };

(enabled ? it : it.skip)("highlights active teams, filters working bots and follows live completion without reloading", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "omb-team-activity-"));
  const planPath = join(scratch, "plans.json");
  writeFileSync(planPath, "{}");
  const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/control-omb.ts", "ui", "launch"], {
    cwd: ROOT, env: { ...process.env, FAKE_CLAUDE_ROOM_PLAN: planPath }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); });
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  let info: FixtureInfo | undefined;
  try {
    info = await new Promise<FixtureInfo>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Fixture startup timed out: " + stderr)), 180_000);
      child.once("exit", () => { clearTimeout(timer); reject(new Error(stderr)); });
      child.stdout.on("data", () => {
        try { const value = JSON.parse(stdout); if (value.ui) { clearTimeout(timer); resolve(value); } } catch { /* Child stdout may arrive in multiple chunks. */ }
      });
    });
    const fixture = info!;
    const api = async (path: string, method = "GET", body?: unknown) => {
      const response = await fetch(fixture.url + path, { method, headers: { "content-type": "application/json", origin: fixture.url },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value = await response.json();
      expect(response.ok, JSON.stringify(value)).toBe(true);
      return value as any;
    };
    await api(`/api/bots/${fixture.botId}`, "PATCH", { name: "Luna", title: "Designer", section: "Estúdio" });
    const create = async (name: string, section: string) => (await api("/api/bots", "POST", { name, section })).bot;
    const nina = await create("Nina", "Estúdio");
    const chief = await create("Alpha Chief", "Estúdio");
    await api(`/api/bots/${chief.id}`, "PATCH", { chiefOfStaff: true });
    const waiting = await create("Rafael", "Atendimento");
    await api(`/api/bots/${waiting.id}`, "PATCH", { approvalMode: "ask" });
    await create("Beto", "AFinanceiro");
    await api("/api/config", "PUT", { language: "pt-br" });
    const release = join(scratch, "release");
    writeFileSync(planPath, JSON.stringify({
      [fixture.botId]: { gateFile: release, reply: "Synthetic design complete." },
      [nina.id]: { gateFile: release, reply: "Synthetic copy complete." },
      [waiting.id]: { approve: { tool_name: "Bash", input: { command: "git push origin fixture-activity" } }, replyIfDenied: "Synthetic approval denied." },
    }));
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
    await evaluate("localStorage.setItem('omb-advanced-mode','1'); localStorage.removeItem('openmausbot.sidebarNavigation.v1'); location.reload(); true");
    await expect.poll(snapshot, { timeout: 15_000 }).toContain('tab "Times"');
    await click("Times", "tab");
    await click("Favoritar AFinanceiro");
    const selected = (await api("/api/bots?messages=0")).bots.find((bot: { id: string }) => bot.id === fixture.botId);
    for (const member of [selected, nina, waiting]) await runControlOmb(["send", "--url", fixture.url, "--bot", member.id, "--task", member.threadId, "--text", "Synthetic team activity verification."]);
    await expect.poll(snapshot, { timeout: 20_000 }).toContain("Mostrar bots trabalhando: 2");
    await expect.poll(snapshot, { timeout: 20_000 }).toContain("Mostrar bots que precisam de você: 1");
    const teamOrder = () => evaluate("[...document.querySelectorAll('[data-navigation-team]')].map(node => node.dataset.navigationTeam)");
    await expect.poll(teamOrder).toEqual(["Estúdio", "Atendimento", "AFinanceiro", ""]);
    expect(await evaluate("document.querySelector('[data-navigation-team=Estúdio] [data-active-bot-names]').textContent")).toContain("Luna");
    const browser = JSON.parse(readFileSync(fixture.ui, "utf8")) as UiHandle;
    const geometry = [];
    for (const [width, height] of [[1280, 900], [1024, 600], [390, 844]]) {
      await agentBrowser(browser.binary, sessionEnv(browser), ["set", "viewport", String(width), String(height)]);
      if (width < 768) await click("Abrir lista de bots");
      const bounds = await evaluate("(() => { const nav = document.querySelector('[data-sidebar-navigation]'); const summary = nav.querySelector('[data-navigation-activity]').getBoundingClientRect(); const top = nav.querySelector('[data-glass-bar=top]').getBoundingClientRect(); const bottom = nav.querySelector('[data-glass-bar=bottom]').getBoundingClientRect(); return {left:summary.left,right:summary.right,available:bottom.top-top.bottom,scroll:document.documentElement.scrollWidth}; })()");
      expect(bounds.scroll).toBeLessThanOrEqual(width); expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(width); expect(bounds.available).toBeGreaterThan(150);
      geometry.push({ width, height, ...bounds });
      await ui("screenshot", "--out", fixture.logPath + `.activity-${width}.png`);
      if (width < 768) await ui("press", "--keys", "Escape");
    }
    await agentBrowser(browser.binary, sessionEnv(browser), ["set", "viewport", "1280", "900"]);
    await click("Mostrar bots trabalhando: 2");
    await expect.poll(() => evaluate("[...document.querySelectorAll('[data-navigation-results] [data-navigation-bot]')].map(node=>node.dataset.navigationBot)")).toEqual([fixture.botId, nina.id]);
    expect(await evaluate("document.querySelector('[data-navigation-bot-status=working]').textContent")).toContain("Trabalhando");
    await click("Mostrar bots que precisam de você: 1");
    await expect.poll(() => evaluate("[...document.querySelectorAll('[data-navigation-results] [data-navigation-bot]')].map(node=>node.dataset.navigationBot)")).toEqual([waiting.id]);
    await click("Mostrar times em atividade: 2");
    await expect.poll(teamOrder).toEqual(["Estúdio", "Atendimento"]);
    await click("Abrir time Estúdio");
    await expect.poll(() => evaluate("[...document.querySelectorAll('[data-navigation-results] [data-navigation-bot]')].map(node=>node.dataset.navigationBot)")).toEqual([fixture.botId, nina.id, chief.id]);
    await click("Todos os times");
    writeFileSync(release, "complete");
    await expect.poll(snapshot, { timeout: 20_000 }).toContain("Mostrar bots trabalhando: 0");
    await expect.poll(teamOrder).toEqual(["Atendimento", "AFinanceiro", "Estúdio", ""]);
    await click("Mostrar times em atividade: 1");
    await expect.poll(teamOrder).toEqual(["Atendimento"]);
    await api(`/api/bots/${waiting.id}/interrupt`, "POST", { threadId: waiting.threadId });
    await expect.poll(snapshot, { timeout: 20_000 }).toContain("Mostrar times em atividade: 0");
    await expect.poll(snapshot).toContain("Nenhuma atividade corresponde a este filtro agora.");
    await click("Voltar a mostrar todos");
    await expect.poll(teamOrder).toEqual(["AFinanceiro", "Atendimento", "Estúdio", ""]);
    expect((await ui("console")).messages.filter((message: {type:string})=>message.type === "error")).toEqual([]);
    writeFileSync(fixture.logPath + ".team-activity.json", JSON.stringify({ geometry, logPath: fixture.logPath, final: await snapshot() }, null, 2));
    console.log("Team activity evidence:", fixture.logPath);
  } catch (error) {
    if (info) writeFileSync(info.logPath + ".activity-failure.json", JSON.stringify(await runControlOmb(["ui", "snapshot", "--ui", info.ui]), null, 2));
    throw error;
  } finally { await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 }); rmSync(scratch, { recursive: true, force: true }); }
}, 240_000);
