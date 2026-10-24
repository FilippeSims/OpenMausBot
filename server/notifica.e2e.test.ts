import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runControlOmb } from "../scripts/control-omb.ts";
import { launchRestartableServer } from "./testing/restartable-server.ts";
import type { NotificaStatus } from "../shared/notifica.ts";
import type { WireBot } from "../shared/wire.ts";

it("asks through the real bot tool, survives a restart while waiting, and resumes only the original session through an ordinary user message", async () => {
  const calls: Array<{ path: string; key: string; body: any }> = [];
  const answers = new Map<string, string>();
  const remote = createServer(async (req, res) => {
    let text = ""; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    calls.push({ path: req.url!, key: req.headers.authorization!, body });
    res.setHeader("content-type", "application/json");
    if (req.url === "/agentMessage") return res.end(JSON.stringify({ conversationId: "conversation-" + body.conversationKey,
      messageId: "question-" + body.eventId, alertId: "alert-" + body.eventId, duplicate: false }));
    const answer = answers.get(body.questionId);
    res.end(JSON.stringify(answer === undefined ? { status: "pending", reply: null } : { status: "replied", reply: {
      id: "reply-" + body.questionId, questionId: body.questionId, text: answer, createdAt: "2026-10-24T12:00:00.000Z",
    } }));
  });
  await new Promise<void>(resolve => remote.listen(0, "127.0.0.1", resolve));
  const remoteUrl = `http://127.0.0.1:${(remote.address() as AddressInfo).port}`;
  const fixture = await launchRestartableServer({ scripted: true, env: { FAKE_CLAUDE_NOTIFICA_URL: remoteUrl } });
  const api = async <T = any>(path: string, method = "GET", body?: unknown, expected = 200): Promise<T> => {
    const response = await fetch(fixture.url + path, { method, headers: { "content-type": "application/json", origin: fixture.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json(); expect(response.status, JSON.stringify(value)).toBe(expected); return value as T;
  };
  const plans: Record<string, unknown> = {};
  const rows = () => {
    try { return readFileSync(fixture.planPath + ".evidence.jsonl", "utf8").trim().split("\n").map(line => JSON.parse(line)); } catch { return []; }
  };
  const send = (bot: WireBot, threadId: string, text: string) => runControlOmb(["send", "--url", fixture.url, "--bot", bot.id, "--task", threadId, "--text", text]);
  try {
    const bot = (await api("/api/bots", "POST", { name: "Notifica requester" }, 201)).bot as WireBot;
    const other = (await api("/api/bots", "POST", { name: "Other requester" }, 201)).bot as WireBot;
    const originalThread = bot.threadId;
    const marker = join(fixture.dataDir, "reply-must-never-run-as-shell");
    const answer = `Comece pela proposta A. $(touch ${marker})`;
    const ask = { eventId: "review-1", title: "Revisão da proposta", message: "Qual proposta devo revisar primeiro?", suggestions: ["Proposta A", "Proposta B"] };
    plans[bot.id] = { script: [
      { key: "ask", match: ["Original project: spring campaign"], expectSystemIncludes: ["Notifica is connected", "perguntar_usuario"],
        steps: [{ tool: "perguntar_usuario", arguments: ask }, { tool: "perguntar_usuario", arguments: ask },
          { tool: "perguntar_usuario", arguments: { ...ask, botId: other.id }, expectError: true }], reply: "Aguardando sua escolha no Notifica." },
      { key: "independent", match: ["Independent task marker"], reply: "A outra tarefa terminou durante a espera." },
      { key: "resume", match: ["Comece pela proposta A."],
        steps: [{ tool: "perguntar_usuario", arguments: { eventId: "result-1", title: "Resultado", message: "Proposta A revisada para a campanha original.", expectsReply: false } }],
        reply: "Continuei a campanha original e revisei a proposta A." },
    ] };
    plans[other.id] = { script: [{ key: "other-ask", match: ["Other bot question"], steps: [{ tool: "perguntar_usuario", arguments: { ...ask, eventId: "other-1" } }], reply: "Other bot waiting." }] };
    writeFileSync(fixture.planPath, JSON.stringify(plans));
    const config = await api(`/api/bots/${bot.id}/notifica`, "PUT", { enabled: true, key: "fixture-key-a" });
    expect(JSON.stringify(config)).not.toContain("fixture-key-a");
    await api(`/api/bots/${other.id}/notifica`, "PUT", { enabled: true, key: "fixture-key-b" });
    await send(bot, originalThread, "Original project: spring campaign. Ask which proposal to review and wait.");
    await expect.poll(async () => (await api<NotificaStatus>(`/api/bots/${bot.id}/notifica`)).pending[0]?.status, { timeout: 30_000 }).toBe("aguardando_usuario");
    await expect.poll(() => rows().filter(row => row.botId === bot.id).length, { timeout: 20_000 }).toBe(1);
    const originalCursor = JSON.parse(readFileSync(join(fixture.dataDir, "bots.json"), "utf8")).find((item: any) => item.id === bot.id).tasks.find((task: any) => task.threadId === originalThread).resumeCursors;
    const snapshot = (await api("/api/bots?messages=0")).bots.find((item: WireBot) => item.id === bot.id) as WireBot;
    expect(snapshot.tasks?.find(task => task.threadId === originalThread)).toMatchObject({ activity: "waiting-on-you", busy: false });
    const waiting = (await api<NotificaStatus>(`/api/bots/${bot.id}/notifica`)).pending[0];
    expect(waiting).toMatchObject({ threadId: originalThread, messageId: "question-review-1", alertId: "alert-review-1" });
    expect(calls.filter(call => call.path === "/agentMessage" && call.key === "Bearer fixture-key-a")).toHaveLength(1);
    const independentThread = (await api(`/api/bots/${bot.id}/tasks`, "POST", { title: "Independent task" }, 201)).task.threadId as string;
    await send(bot, independentThread, "Independent task marker. Complete this while the first task waits.");
    await expect.poll(() => rows().filter(row => row.botId === bot.id).length, { timeout: 20_000 }).toBe(2);
    await send(other, other.threadId, "Other bot question");
    await expect.poll(async () => (await api<NotificaStatus>(`/api/bots/${other.id}/notifica`)).pending[0]?.status, { timeout: 20_000 }).toBe("aguardando_usuario");
    await expect.poll(() => calls.filter(call => call.path === "/agentReply").length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    expect(rows().filter(row => row.botId === bot.id)).toHaveLength(2);
    await fixture.stop();
    expect(readFileSync(join(fixture.dataDir, "notifica.json.enc"), "utf8")).not.toContain("fixture-key-a");
    await fixture.start();
    expect((await api<NotificaStatus>(`/api/bots/${bot.id}/notifica`)).pending[0]).toMatchObject(waiting);
    answers.set("question-review-1", answer);
    await expect.poll(() => rows().find(row => row.botId === bot.id && row.planKey === "resume"), { timeout: 40_000 }).toBeTruthy();
    const resumed = JSON.parse(readFileSync(join(fixture.dataDir, "fake-claude-dump.json"), "utf8"));
    expect(resumed.argv).toContain("--resume");
    expect(JSON.stringify(originalCursor)).toContain(resumed.argv[resumed.argv.indexOf("--resume") + 1]);
    await expect.poll(async () => (await api<NotificaStatus>(`/api/bots/${bot.id}/notifica`)).pending.length, { timeout: 20_000 }).toBe(0);
    const messages = (await api(`/api/threads/${originalThread}/messages`)).messages;
    const received = messages.filter((message: any) => message.role === "user" && message.text === answer);
    expect(received).toHaveLength(1); expect(received[0].sendId).toMatch(/^notifica-/);
    const otherTaskMessages = (await api(`/api/threads/${independentThread}/messages`)).messages;
    expect(otherTaskMessages.some((message: any) => message.text === answer)).toBe(false);
    expect((await api<NotificaStatus>(`/api/bots/${other.id}/notifica`)).pending[0].status).toBe("aguardando_usuario");
    expect(existsSync(marker)).toBe(false);
    const resultCall = calls.find(call => call.path === "/agentMessage" && call.body.eventId === "result-1")!;
    expect(resultCall.body).toMatchObject({ expectsReply: false, conversationKey: waiting.conversationKey });
    expect(resultCall.key).toBe("Bearer fixture-key-a");
    await fixture.stop(); await fixture.start();
    expect((await api(`/api/threads/${originalThread}/messages`)).messages.filter((message: any) => message.role === "user" && message.text === answer)).toHaveLength(1);
    expect(rows().filter(row => row.botId === bot.id && row.planKey === "resume")).toHaveLength(1);
    const room = (await api("/api/groups", "POST", { name: "Notifica room", memberIds: [bot.id, other.id],
      setup: { bulletin: "Test only", defaultResponder: { kind: "member", botId: other.id } } }, 201)).group;
    plans[bot.id] = { script: [
      { key: "room-ask", match: ["Room proposal review"], steps: [{ tool: "perguntar_usuario", arguments: { ...ask, eventId: "room-question" } }], reply: "Room waiting." },
      { key: "room-resume", match: ["Room answer for original bot"], reply: "The original bot continued inside its room." },
    ] };
    writeFileSync(fixture.planPath, JSON.stringify(plans));
    await api(`/api/groups/${room.id}/messages`, "POST", { text: `@${bot.name}: Room proposal review`, threadId: room.threadId }, 202);
    await expect.poll(async () => (await api<NotificaStatus>(`/api/bots/${bot.id}/notifica`)).pending.find(item => item.threadId === room.threadId)?.status,
      { timeout: 20_000 }).toBe("aguardando_usuario");
    answers.set("question-room-question", "Room answer for original bot");
    await expect.poll(() => rows().find(row => row.botId === bot.id && row.planKey === "room-resume"), { timeout: 40_000 }).toBeTruthy();
    const roomMessages = (await api(`/api/threads/${room.threadId}/messages`)).messages;
    expect(roomMessages.find((message: any) => message.text === "The original bot continued inside its room.")?.from?.botId).toBe(bot.id);
    expect(rows().filter(row => row.botId === other.id)).toHaveLength(1);
    writeFileSync(fixture.logPath + ".notifica.json", JSON.stringify({ waiting, calls, rows: rows(), received, originalCursor, resumeArgv: resumed.argv }, null, 2));
    console.log("Notifica acceptance evidence:", fixture.logPath);
  } catch (error) {
    writeFileSync(fixture.logPath + ".notifica-failure.json", JSON.stringify({ calls, rows: rows(), bots: await api("/api/bots?messages=0").catch(() => null) }, null, 2));
    throw error;
  } finally {
    await fixture.close();
    await new Promise<void>(resolve => remote.close(() => resolve()));
  }
}, 180_000);
