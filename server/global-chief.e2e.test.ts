import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import type { WireBot } from "../shared/wire.ts";
import { readHandoffs } from "./testing/handoff-rows.ts";

it("coordinates two team chiefs and their specialists, recalls global context and revokes access", async () => {
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true }, [], undefined,
    undefined, undefined, process.env.OMB_GLOBAL_CHIEF_VERIFY_SERVER_ENTRY);
  const api = async (path: string, method = "GET", body?: unknown, status = 200): Promise<any> => {
    const response = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const create = async (name: string, section?: string, extra = {}): Promise<WireBot> =>
    (await api("/api/bots", "POST", { name, section, ...extra }, 201)).bot;
  const planPath = join(fixture.info.dataDir, "room-plan.json");
  const plan: Record<string, any> = {};
  const evidence = (): any[] => existsSync(`${planPath}.evidence.jsonl`)
    ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const turn = async (bot: WireBot, text: string) => {
    writeFileSync(planPath, JSON.stringify(plan));
    await runControlOmb(["send", "--url", fixture.info.url, "--bot", bot.id, "--task", bot.threadId, "--text", text]);
    expect(await runControlOmb(["wait", "--url", fixture.info.url, "--bot", bot.id, "--task", bot.threadId, "--timeout", "30"])).toMatchObject({ status: "settled" });
  };
  const resultOf = (bot: WireBot, tool: string) => evidence().filter(turn => turn.botId === bot.id).at(-1)?.evidence.find((step: any) => step.step?.tool === tool)?.response.result;
  const current = async (id: string): Promise<WireBot> => (await api("/api/bots?messages=0")).bots.find((bot: WireBot) => bot.id === id);
  try {
    const director = await create("Director", "Old home");
    const general = await create("General Chief");
    await api(`/api/bots/${general.id}`, "PATCH", { chiefOfStaff: true });
    await api(`/api/bots/${director.id}`, "PATCH", { globalChief: true }, 400);
    await api(`/api/bots/${director.id}`, "PATCH", { globalChief: true, acknowledgeGlobalAccess: true });
    expect(await current(director.id)).toMatchObject({ chiefOfStaff: true, globalChief: true, hidden: false, pinned: false });
    expect((await current(director.id)).section).toBeUndefined();
    expect((await current(general.id)).chiefOfStaff).toBe(true);
    const engineering = await create("Engineering Chief", "Engineering");
    const developer = await create("Developer", "Engineering");
    const marketing = await create("Marketing Chief", "Marketing");
    const writer = await create("Writer", "Marketing");
    const privateBot = await create("Private finance", "Finance", { visibility: "admins" });
    const noMemory = await create("Disabled notes", "No notes");
    await api(`/api/bots/${noMemory.id}`, "PATCH", { memoryEnabled: false });
    for (const lead of [engineering, marketing]) await api(`/api/bots/${lead.id}`, "PATCH", { chiefOfStaff: true });
    for (const bot of [director, engineering, developer, marketing, writer, privateBot, noMemory]) {
      await api(`/api/bots/${bot.id}`, "PATCH", { memoryUpkeep: false });
      await api(`/api/bots/${bot.id}/memory/file`, "PUT", { path: "memory/project.md", text: `Workspace beacon ${bot.name} durable fact.\n` });
    }
    await api("/api/team-memory?section=Engineering", "POST", { kind: "decision", name: "Beacon engineering", detail: "Workspace beacon approved engineering context" }, 201);
    await api("/api/team-memory?section=Marketing", "POST", { kind: "decision", name: "Beacon marketing", detail: "Workspace beacon approved marketing context" }, 201);
    plan[developer.id] = { reply: "Workspace beacon historical engineering context" };
    plan[writer.id] = { reply: "Workspace beacon historical marketing context" };
    plan[privateBot.id] = { reply: "Workspace beacon restricted finance context" };
    await turn(developer, "Record the workspace beacon engineering context.");
    await turn(writer, "Record the workspace beacon marketing context.");
    await turn(privateBot, "Record the workspace beacon restricted finance context.");
    const writerMessages = (await api(`/api/threads/${writer.threadId}/messages`)).messages;
    const writerMessage = writerMessages.find((message: any) => message.text === plan[writer.id].reply);
    expect(writerMessage).toBeDefined();
    plan[director.id] = { steps: [
      { tool: "memory_search", arguments: { query: "workspace beacon" } },
      { tool: "session_search", arguments: { query: "workspace beacon", scope: "conversations", limit: 25 } },
      { tool: "session_read", arguments: { thread_id: writer.threadId, message_id: writerMessage.id } },
      { tool: "session_search", arguments: { query: "beacon", scope: "team" } },
      { tool: "coordinate_bots", arguments: { bot_ids: [engineering.id, marketing.id], message: "Deliver your part of the workspace beacon release and verify it." } },
    ], reply: "Both teams assigned", resumeReply: "Engineering and marketing completed; consolidated workspace beacon result", expectSystemIncludes: ["Global Chief (Chefe Geral)"] };
    for (const [lead, specialist] of [[engineering, developer], [marketing, writer]]) {
      plan[lead.id] = { steps: [{ arguments: { bot_ids: [specialist.id], message: "Verify your part of the beacon release" } }], reply: "Specialist assigned", resumeReply: `${lead.name} reviewed the specialist evidence` };
      plan[specialist.id] = { reply: `${specialist.name} verified the release` };
    }
    await turn(director, "Coordinate Engineering and Marketing and bring one verified release result.");
    await expect.poll(() => evidence().filter(turn => turn.botId === director.id).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    const initial = evidence().find(turn => turn.botId === director.id);
    const output = (tool: string) => initial.evidence.find((step: any) => step.step?.tool === tool)?.response.result.content[0].text;
    const memories = JSON.parse(output("memory_search"));
    expect(memories.local.map((hit: any) => hit.botId)).toEqual(expect.arrayContaining([developer.id, writer.id]));
    expect(JSON.stringify(memories)).not.toContain("Private finance");
    expect(JSON.stringify(memories)).not.toContain("Disabled notes");
    expect(memories.team.map((hit: any) => hit.section)).toEqual(expect.arrayContaining(["Engineering", "Marketing"]));
    expect(output("session_search")).toContain("historical engineering context");
    expect(output("session_search")).toContain("historical marketing context");
    expect(output("session_search")).not.toContain("restricted finance context");
    expect(output("session_read")).toContain("Workspace beacon historical marketing context");
    expect(output("session_read")).toContain("Writer");
    const handoffs = readHandoffs(fixture.info.dataDir);
    const childrenOf = (botId: string) => handoffs.filter(node => node.parentId && handoffs.find(parent => parent.id === node.parentId)?.botId === botId).map(node => node.botId);
    expect(childrenOf(director.id).sort()).toEqual([engineering.id, marketing.id].sort());
    expect(childrenOf(engineering.id)).toEqual([developer.id]);
    expect(childrenOf(marketing.id)).toEqual([writer.id]);
    expect(handoffs.every(node => node.status === "completed")).toBe(true);
    await api(`/api/bots/${director.id}`, "PATCH", { section: "Engineering" }, 400);
    await api("/api/groups", "POST", { name: "Forbidden membership", memberIds: [director.id, writer.id] }, 400);
    const gate = join(fixture.info.dataDir, "release-global-child");
    const ready = join(fixture.info.dataDir, "global-child-ready");
    plan[director.id] = { steps: [{ arguments: { bot_ids: [writer.id], message: "Work pending global revocation" } }], reply: "Work assigned", resumeReply: "Access changed; pending result withheld" };
    plan[writer.id] = { readyFile: ready, gateFile: gate, reply: "WITHHELD_BEACON_RESULT" };
    writeFileSync(planPath, JSON.stringify(plan));
    await runControlOmb(["send", "--url", fixture.info.url, "--bot", director.id, "--task", director.threadId, "--text", "Test revocation while a child is working."]);
    await expect.poll(() => existsSync(ready), { timeout: 15_000 }).toBe(true);
    await api(`/api/bots/${general.id}`, "PATCH", { globalChief: true, acknowledgeGlobalAccess: true }, 409);
    await api(`/api/bots/${director.id}`, "PATCH", { globalChief: false });
    writeFileSync(gate, "finish owned fixture work");
    await runControlOmb(["wait", "--url", fixture.info.url, "--bot", director.id, "--task", director.threadId, "--timeout", "30"]);
    await expect.poll(async () => (await current(writer.id)).busy, { timeout: 15_000 }).toBe(false);
    const afterRevocation = (await api(`/api/threads/${director.threadId}/messages`)).messages;
    expect(JSON.stringify(afterRevocation)).not.toContain("WITHHELD_BEACON_RESULT");
    plan[director.id] = { steps: [
      { tool: "memory_search", arguments: { query: "workspace beacon" } },
      { tool: "session_read", arguments: { thread_id: writer.threadId, message_id: writerMessage.id }, expectError: true },
    ], reply: "Global access revoked" };
    await turn(director, "Check that global context access was revoked.");
    expect(JSON.parse(resultOf(director, "memory_search").content[0].text).local.map((hit: any) => hit.botId)).toEqual([director.id]);
    expect(resultOf(director, "session_read").isError).toBe(true);
    expect((await current(general.id)).chiefOfStaff).toBe(true);
    const evidencePath = fixture.info.logPath + ".global-chief.json";
    writeFileSync(evidencePath, JSON.stringify({ logPath: fixture.info.logPath, initial, handoffs, revoked: await current(director.id), finalTurn: evidence().at(-1) }, null, 2));
    console.log("Global Chief evidence:", evidencePath);
  } finally { await fixture.close(); }
}, 120_000);
