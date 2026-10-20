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

(enabled ? it : it.skip)("finds and opens bots across teams, focuses teams and restores navigation in the real renderer", async () => {
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
    const api = async (path: string, body?: unknown, method = "PATCH") => {
      const response = await fetch(fixture.url + path, body === undefined ? {} : {
        method, headers: { "Content-Type": "application/json", origin: fixture.url }, body: JSON.stringify(body),
      });
      const value = await response.json();
      expect(response.ok, JSON.stringify(value)).toBe(true);
      return value;
    };
    const create = async (name: string, section?: string, title = "") => (await api("/api/bots", { name, section, settings: { title } }, "POST")).bot as { id: string };
    await api(`/api/bots/${fixture.botId}`, { name: "Nina", title: "Redação", section: "Marketing" });
    const boss = await create("MAC BOSS");
    await api(`/api/bots/${boss.id}`, { globalChief: true, acknowledgeGlobalAccess: true });
    const chief = await create("Luna", "Marketing", "Chefe do time");
    await api(`/api/bots/${chief.id}`, { chiefOfStaff: true });
    const finance = await create("Luna", "Financeiro", "Contas a pagar");
    const archived = await create("Hidden marker", "Marketing", "Hidden role marker");
    await api(`/api/bots/${archived.id}`, { hidden: true });
    await api("/api/sidebar-sections", { name: "Vazio" }, "POST");
    const room = (await api("/api/groups", { name: "Sala da campanha", memberIds: [fixture.botId, chief.id], section: "Marketing" }, "POST")).group;
    for (let n = 0; n < 42; n++) await create(`Fixture Bot ${String(n).padStart(2, "0")}`, "Laboratório");
    await api("/api/config", { language: "pt-br" }, "PUT");
    const ui = (verb: string, ...args: string[]) => runControlOmb(["ui", verb, "--ui", fixture.ui, ...args]) as Promise<any>;
    const evaluate = async (js: string) => (await ui("eval", "--js", js)).result;
    const snapshot = async () => (await ui("snapshot")).snapshot as string;
    const click = async (role: string, name: string | RegExp) => {
      const refs = (await ui("snapshot")).refs as Record<string, { role: string; name: string }>;
      const found = Object.entries(refs).find(([, item]) => item.role === role && (typeof name === "string" ? item.name === name : name.test(item.name)));
      expect(found, String(name)).toBeDefined();
      await ui("click", "--ref", "@" + found![0]);
    };
    const search = async (text: string) => {
      if ((await snapshot()).includes('button "Limpar busca da navegação"')) await ui("click", "--name", "Limpar busca da navegação");
      await ui("click", "--name", "Buscar time, bot ou função…");
      if (text) await ui("type", "--name", "Buscar time, bot ou função…", "--text", text);
    };
    await evaluate("localStorage.setItem('omb-advanced-mode', '1'); localStorage.removeItem('openmausbot.sidebarNavigation.v1'); location.reload(); true");
    await expect.poll(snapshot, { timeout: 15_000 }).toContain('tab "Recentes"');
    await ui("press", "--keys", "Meta+k");
    expect(await evaluate("document.activeElement.hasAttribute('data-sidebar-navigation-search')")).toBe(true);
    await search("luna");
    await expect.poll(() => evaluate("document.querySelectorAll('[data-navigation-results] [data-navigation-bot]').length")).toBe(2);
    const duplicateNames = await snapshot();
    expect(duplicateNames).toContain("Financeiro · Contas a pagar");
    expect(duplicateNames).toContain("Marketing · Chefe do time");
    expect(duplicateNames).not.toContain("Hidden marker");
    await click("button", /^Luna Renomear Luna.*Financeiro/);
    await expect.poll(() => evaluate("document.querySelector('[data-chathead-team]')?.textContent")).toBe("Times › Financeiro");
    await search("redacao");
    await expect.poll(() => evaluate("[...document.querySelectorAll('[data-navigation-results] [data-navigation-bot]')].map(node => node.dataset.navigationBot)")).toEqual([fixture.botId]);
    await search("Marketing");
    await click("button", "Abrir time Marketing");
    await expect.poll(() => evaluate("document.querySelector('[data-navigation-focused-team]')?.dataset.navigationFocusedTeam")).toBe("Marketing");
    expect(await evaluate(`Boolean(document.querySelector('[data-navigation-results] [data-navigation-bot="${finance.id}"]'))`)).toBe(false);
    expect(await evaluate(`Boolean(document.querySelector('[data-global-chief="${boss.id}"]'))`)).toBe(true);
    expect(await snapshot()).toContain("Sala da campanha");
    await click("button", "Favoritar Marketing");
    await click("button", "Todos os times");
    await expect.poll(snapshot).toContain("TIMES FAVORITOS");
    await evaluate("location.reload(); true");
    await expect.poll(snapshot, { timeout: 15_000 }).toContain('tab "Times" [selected');
    expect(await evaluate("JSON.parse(localStorage.getItem('openmausbot.sidebarNavigation.v1')).team")).toBeNull();
    expect(await evaluate("JSON.parse(localStorage.getItem('openmausbot.sidebarNavigation.v1')).favorites")).toContain("Marketing");
    await click("button", "Abrir time Vazio");
    expect(await snapshot()).toContain("Este time ainda não tem bots ou grupos.");
    await click("tab", "Bots");
    const before = await evaluate("document.querySelectorAll('[data-navigation-results] [data-navigation-bot]').length");
    expect(before).toBe(40);
    await click("button", "Mostrar mais");
    expect(await evaluate("document.querySelectorAll('[data-navigation-results] [data-navigation-bot]').length")).toBeGreaterThan(before);
    await click("tab", "Recentes");
    expect(await evaluate("document.querySelector('[data-navigation-results] [data-navigation-bot]')?.dataset.navigationBot")).toBe(finance.id);
    await click("tab", "Times");
    await click("button", "Abrir time Marketing");
    await click("button", /^Nina Renomear Nina/);
    await expect.poll(() => evaluate("document.querySelector('[data-chathead-team]')?.textContent")).toBe("Times › Marketing");
    const browser = JSON.parse(readFileSync(fixture.ui, "utf8")) as UiHandle;
    const geometry = [];
    for (const [width, height] of [[1280, 900], [1024, 600], [390, 844]]) {
      await agentBrowser(browser.binary, sessionEnv(browser), ["set", "viewport", String(width), String(height)]);
      if (width < 768) {
        await expect.poll(() => evaluate(`(() => {
          const button = document.querySelector('button[aria-label="Abrir lista de bots"]');
          const rect = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
        })()`)).toBe(true);
        await click("button", "Abrir lista de bots");
        await expect.poll(() => evaluate("document.querySelector('[data-sidebar]').getBoundingClientRect().left")).toBe(0);
      }
      const bounds = await evaluate(`(() => {
        const sidebar = document.querySelector('[data-sidebar]').getBoundingClientRect();
        const nav = document.querySelector('[data-sidebar-navigation]');
        const header = nav.querySelector('[data-glass-bar=top]').getBoundingClientRect();
        const footer = nav.querySelector('[data-glass-bar=bottom]').getBoundingClientRect();
        const search = nav.querySelector('input').getBoundingClientRect();
        return { width: innerWidth, scroll: document.documentElement.scrollWidth, sidebar: {left: sidebar.left, right: sidebar.right}, search: {left: search.left, right: search.right}, available: footer.top - header.bottom };
      })()`);
      expect(bounds.scroll).toBeLessThanOrEqual(width);
      expect(bounds.search.left).toBeGreaterThanOrEqual(0);
      expect(bounds.search.right).toBeLessThanOrEqual(width);
      expect(bounds.available).toBeGreaterThan(150);
      geometry.push(bounds);
      await ui("screenshot", "--out", fixture.logPath + `.navigation-${width}.png`);
      if (width < 768) await ui("press", "--keys", "Escape");
    }
    await agentBrowser(browser.binary, sessionEnv(browser), ["set", "viewport", "1280", "900"]);
    await evaluate("localStorage.setItem('omb-advanced-mode', '0'); location.reload(); true");
    await expect.poll(snapshot, { timeout: 15_000 }).toContain('tab "Times" [selected');
    expect(await snapshot()).toContain("Marketing");
    await ui("screenshot", "--out", fixture.logPath + ".navigation-simple.png");
    const saved = (await api("/api/bots?messages=0")).bots;
    expect(saved.find((bot: { id: string }) => bot.id === boss.id).globalChief).toBe(true);
    expect(saved.find((bot: { id: string }) => bot.id === archived.id).hidden).toBe(true);
    expect((await ui("console")).messages.filter((message: { type: string }) => message.type === "error")).toEqual([]);
    writeFileSync(fixture.logPath + ".navigation.json", JSON.stringify({ duplicateNames, geometry, boss, finance, room, logPath: fixture.logPath, final: await snapshot() }, null, 2));
  } catch (error) {
    if (info) writeFileSync(info.logPath + ".navigation-failure.json", JSON.stringify(await runControlOmb(["ui", "snapshot", "--ui", info.ui]), null, 2));
    throw error;
  } finally { await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 }); }
}, 240_000);
