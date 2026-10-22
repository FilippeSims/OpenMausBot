import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import type { WireBot } from "../shared/wire.ts";
import { CAPTURE_MARKER } from "./memory-capture.ts";
import type { SemanticMemoryHit } from "./hindsight-memory.ts";

const bundle = process.env.OMB_HINDSIGHT_VERIFY_BUNDLE;
const serverEntry = process.env.OMB_HINDSIGHT_VERIFY_SERVER_ENTRY;

interface SearchResult {
  backend: "hindsight" | "local";
  hits: SemanticMemoryHit[];
  local: Array<{ file: string; snippet: string }>;
  team: Array<{ id: string; text: string; section: string }>;
}
interface Step { tool: string; arguments: Record<string, unknown> }
interface Plan { reply: string; steps?: Step[]; expectContextIncludes?: string[] }
interface Evidence {
  botId: string;
  threadId: string;
  evidence: Array<{ step?: Step; response?: { result: { content: Array<{ text: string }> } } }>;
}

it.skipIf(!bundle)("captures a conversation and recalls private and accepted team notes with the installed native engine", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "omb-memory-acceptance-"));
  const routes = join(scratch, "capture.json");
  const privateFact = "O protótipo Orvalho usa acabamento em cobre escovado.";
  const teamFact = "A equipe combinou entregar o projeto Orvalho no dia 28 de novembro às 16h45.";
  writeFileSync(routes, JSON.stringify({ [CAPTURE_MARKER]: JSON.stringify([
    { text: privateFact, kind: "decision", aboutUser: false, topic: "prototipo", topicAliases: ["material", "revestimento"], confidence: 0.99 },
  ]) }));
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes }, undefined,
    undefined, undefined, undefined, { scripted: true }, [], undefined, undefined, bundle, serverEntry);
  const results: Record<string, unknown> = {};
  const plan: Record<string, Plan> = {};
  const planPath = join(fixture.info.dataDir, "room-plan.json");
  const api = async <T = Record<string, unknown>>(path: string, method = "GET", body?: unknown, status = 200): Promise<T> => {
    const response = await fetch(fixture.info.url + path, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const value = await response.json();
    expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
    return value as T;
  };
  const create = async (name: string, section?: string) => {
    const { bot } = await api<{ bot: WireBot }>("/api/bots", "POST", { name, section }, 201);
    await api(`/api/bots/${bot.id}`, "PATCH", { memoryUpkeep: false });
    expect(await api(`/api/bots/${bot.id}/memory/upkeep`)).toMatchObject({ enabled: false });
    return bot;
  };
  const evidence = (): Evidence[] => readFileSync(planPath + ".evidence.jsonl", "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const turn = async (bot: WireBot, text: string, next: Plan, threadId = bot.threadId) => {
    plan[bot.id] = next;
    writeFileSync(planPath, JSON.stringify(plan));
    await runControlOmb(["send", "--url", fixture.info.url, "--bot", bot.id, "--task", threadId, "--text", text]);
    expect(await runControlOmb(["wait", "--url", fixture.info.url, "--bot", bot.id, "--task", threadId, "--timeout", "30"]))
      .toMatchObject({ status: "settled" });
    return evidence().filter(row => row.botId === bot.id && row.threadId === threadId).at(-1)!;
  };
  const search = async (bot: WireBot, query: string, threadId = bot.threadId, expectedContext: string[] = []) => {
    const before = performance.now();
    const row = await turn(bot, query, { reply: "Consulta de verificação concluída.",
      steps: [{ tool: "memory_search", arguments: { query } }], expectContextIncludes: expectedContext }, threadId);
    const output = row.evidence.find(item => item.step?.tool === "memory_search")?.response?.result.content[0]?.text;
    expect(output).toBeDefined();
    return { result: JSON.parse(output!) as SearchResult, turnMs: Math.round(performance.now() - before) };
  };
  const recordSearch = async (name: string, ...args: Parameters<typeof search>): Promise<SearchResult> => {
    const value = await search(...args);
    results[name] = value;
    return value.result;
  };
  const indexed = () => (JSON.parse(readFileSync(join(fixture.info.dataDir, "hindsight-index.json"), "utf8")) as {
    indexed: Record<string, Record<string, string>>;
  }).indexed;
  const runtime = async () => (await api<{ memory: { hindsight: { runtimeState: string } } }>("/api/config")).memory.hindsight.runtimeState;
  const privateQuery = "Qual material foi escolhido para o revestimento do protótipo?";
  const teamQuery = "Qual horário de entrega a equipe aprovou para o projeto Orvalho?";
  try {
    await expect.poll(runtime, { timeout: 90_000 }).toBe("ready");
    await api("/api/config", "PUT", { memory: { captureQuietMs: 1_000,
      hindsight: { enabled: true, mode: "embedded", recallTimeoutMs: 2_000, retainTimeoutMs: 30_000 } } });
    const author = await create("Engenheira de teste", "Laboratório");
    const teammate = await create("Redator de teste", "Laboratório");
    const outsider = await create("Financeiro de teste", "Financeiro");
    const chief = await create("Chefe Geral de teste");
    await api(`/api/bots/${author.id}`, "PATCH", { memoryUpkeep: true });
    await turn(author, `Guarde para futuras conversas: ${privateFact}`, { reply: "Informação recebida." });
    const filePath = `/api/bots/${author.id}/memory/file?path=memory%2Fprototipo.md`;
    await expect.poll(async () => {
      const response = await fetch(fixture.info.url + filePath);
      return response.ok ? (await response.json() as { text: string }).text : "";
    }, { timeout: 30_000 }).toContain(privateFact);
    const captured = await api<{ text: string }>(filePath);
    results.automaticCapture = { path: "memory/prototipo.md", text: captured.text };
    await api(`/api/bots/${author.id}`, "PATCH", { memoryUpkeep: false });
    writeFileSync(routes, JSON.stringify({ [CAPTURE_MARKER]: "[]" }));
    await expect.poll(() => Object.values(indexed()).some(bank => bank["memory/prototipo.md"]), { timeout: 30_000 }).toBe(true);

    const { task } = await api<{ task: { threadId: string } }>(`/api/bots/${author.id}/tasks`, "POST", { title: "Conversa sem histórico" }, 201);
    const messages = await api(`/api/threads/${task.threadId}/messages`);
    expect(JSON.stringify(messages)).not.toContain(privateFact);
    const freshConversation = await recordSearch("freshConversation", author, privateQuery, task.threadId, ["Relevant memory retrieved by Hindsight", privateFact]);
    expect(freshConversation).toMatchObject({
      backend: "hindsight", hits: expect.arrayContaining([expect.objectContaining({ source: "memory/prototipo.md", text: expect.stringContaining("cobre escovado") })]),
    });
    expect(await recordSearch("privateIsolation", teammate, privateQuery)).toMatchObject({ hits: [], local: [], team: [] });

    await turn(author, `Registre para todo o time: ${teamFact}`, { reply: "Decisão do time registrada.", steps: [
      { tool: "propose_team_memory", arguments: { kind: "decision", name: "Entrega Orvalho", detail: teamFact } },
    ] });
    const { entries } = await api<{ entries: Array<{ id: string; status: string }> }>("/api/team-memory?section=Laborat%C3%B3rio");
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("accepted");
    await expect.poll(() => Object.values(indexed()).some(bank => bank[entries[0].id]), { timeout: 30_000 }).toBe(true);
    const teamRecall = await recordSearch("teamRecall", teammate, teamQuery, teammate.threadId, ["Relevant memory retrieved by Hindsight", teamFact]);
    expect(teamRecall).toMatchObject({ backend: "hindsight",
      hits: expect.arrayContaining([expect.objectContaining({ scope: "team", source: `team/${entries[0].id}`, text: expect.stringContaining("16h45") })]) });
    expect(JSON.stringify(teamRecall)).not.toContain(privateFact);
    expect(await recordSearch("otherTeamIsolation", outsider, teamQuery)).toMatchObject({ hits: [], local: [], team: [] });

    await api(`/api/bots/${chief.id}`, "PATCH", { globalChief: true, acknowledgeGlobalAccess: true });
    const globalPrivateRecall = await recordSearch("globalPrivateRecall", chief, privateQuery);
    expect(globalPrivateRecall.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "bot", metadata: expect.objectContaining({ bot_id: author.id }), text: expect.stringContaining("cobre escovado") }),
    ]));
    const globalTeamRecall = await recordSearch("globalTeamRecall", chief, teamQuery);
    expect(globalTeamRecall.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "team", source: `team/${entries[0].id}` }),
    ]));
    await api(`/api/bots/${chief.id}`, "PATCH", { globalChief: false });
    expect(await recordSearch("revokedGlobal", chief, privateQuery)).toMatchObject({ hits: [], local: [], team: [] });

    const beforeRestart = indexed();
    await api("/api/config", "PUT", { memory: { hindsight: { enabled: false, mode: "embedded" } } });
    await expect.poll(runtime).toBe("stopped");
    const localFallback = await recordSearch("localFallback", teammate, teamQuery);
    expect(localFallback).toMatchObject({ backend: "local", hits: [], local: [] });
    expect(localFallback.team.map(entry => entry.id)).toContain(entries[0].id);
    expect(JSON.stringify(localFallback)).not.toContain(privateFact);
    await api("/api/config", "PUT", { memory: { hindsight: { enabled: true, mode: "embedded" } } });
    await expect.poll(runtime, { timeout: 30_000 }).toBe("ready");
    expect(indexed()).toEqual(beforeRestart);
    const persisted = await recordSearch("persistedAfterRestart", teammate, teamQuery);
    expect(persisted).toMatchObject({ backend: "hindsight", local: [], hits: expect.arrayContaining([
      expect.objectContaining({ scope: "team", source: `team/${entries[0].id}`, text: expect.stringContaining("16h45") }),
    ]) });
    expect(JSON.stringify(persisted)).not.toContain(privateFact);
    expect((await api<{ text: string }>(filePath)).text).toContain(privateFact);
    const evidencePath = fixture.info.logPath + ".memory-acceptance.json";
    writeFileSync(evidencePath, JSON.stringify({ testedAt: new Date().toISOString(), bundle, serverEntry,
      logPath: fixture.info.logPath, isolated: true, modelExtraction: "scripted", semanticEngine: "real bundled Hindsight", results }, null, 2));
    console.log("Memory acceptance evidence:", evidencePath);
  } finally {
    await fixture.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, 180_000);
