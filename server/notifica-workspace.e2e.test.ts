import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { launchRestartableServer } from "./testing/restartable-server.ts";

type Remote = { url: string; key: string; send(botId: string, text: string): Promise<string>; approvals(): Promise<any[]>; decide(id: string, decision: "approved" | "denied"): Promise<void>; results(conversationId: string): Promise<any[]>; close(): Promise<void> };
async function remoteFixture(): Promise<Remote> {
  const file = process.env.OMB_NOTIFICA_ACCEPTANCE_FIXTURE;
  if (file) {
    const config = JSON.parse(readFileSync(file, "utf8"));
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(config.baseUrl)) throw new Error("Acceptance API must use loopback");
    const auth = await (await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: config.email, password: config.password, returnSecureToken: true }) })).json() as any;
    if (!auth.idToken) throw new Error("Fixture login failed");
    const callable = async (name: string, data: unknown) => {
      const response = await fetch(config.baseUrl + "/" + name, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${auth.idToken}` }, body: JSON.stringify({ data }) });
      const value = await response.json() as any; if (!response.ok || value.error) throw new Error(`${name}: ${JSON.stringify(value)}`); return value.result ?? value.data;
    };
    const decode = (value: any): any => value.stringValue ?? value.timestampValue ?? (value.integerValue !== undefined ? Number(value.integerValue) : value.booleanValue ?? (value.mapValue ? Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([key, item]) => [key, decode(item)])) : null));
    const docs = async (path: string) => {
      const response = await fetch(`http://127.0.0.1:8080/v1/projects/demo-notifica/databases/(default)/documents/users/${auth.localId}/${path}?pageSize=100`, { headers: { Authorization: `Bearer ${auth.idToken}` } });
      const value = await response.json() as any; if (!response.ok) throw new Error("Fixture document read failed");
      return (value.documents ?? []).map((doc: any) => ({ id: doc.name.split("/").at(-1), ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, decode(item)])) }));
    };
    return { url: config.baseUrl, key: config.workspaceKey ?? config.token,
      send: async (targetBotId, text) => { const { conversationId } = await callable("startConversation", { integrationId: config.integrationId, targetBotId }); await callable("sendToAgent", { conversationId, requestId: randomUUID(), text }); return conversationId; },
      approvals: async () => (await docs("approvals")).filter((approval: any) => approval.source === config.integrationId),
      decide: async (approvalId, decision) => { await callable("decideApproval", { approvalId, requestId: randomUUID(), decision }); },
      results: conversationId => docs(`conversations/${conversationId}/messages`), close: async () => {} };
  }
  const inbox: any[] = [], approvals: any[] = [], outputs: any[] = [];
  const server = createServer(async (req, res) => {
    let text = ""; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text); res.setHeader("content-type", "application/json");
    const send = (value: unknown) => res.end(JSON.stringify(value));
    if (req.url === "/agentInbox") return send({ messages: inbox });
    if (req.url === "/agentAck") { const index = inbox.findIndex(item => item.id === body.messageId); if (index >= 0) inbox.splice(index, 1); return send({ ok: true }); }
    if (req.url === "/agentApproval") {
      const approval = { ...body, id: body.approvalId, remoteId: body.approvalId, conversationId: "conv-" + body.conversationKey, status: "pending" };
      if (!approvals.some(item => item.id === approval.id)) approvals.push(approval);
      return send({ approvalId: approval.id, conversationId: approval.conversationId, alertId: "alert-" + approval.id, duplicate: false });
    }
    if (req.url === "/agentApprovalResolve") { const approval = approvals.find(item => item.id === body.approvalId); if (approval) approval.status = body.status; return send({ ok: true }); }
    if (req.url === "/agentMessage") {
      const conversationId = "conv-" + body.conversationKey;
      if (!outputs.some(item => item.id === body.eventId)) outputs.push({ id: body.eventId, conversationId, role: "agent", text: body.message });
      return send({ conversationId, messageId: body.eventId, alertId: null, duplicate: false });
    }
    return send({ ok: true });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, key: "workspace-fixture-secret",
    send: async (targetBotId, text) => { const conversationKey = "notifica:direct:" + targetBotId, conversationId = "conv-" + conversationKey;
      inbox.push({ id: randomUUID(), conversationId, conversationKey, targetBotId, title: "Remote request", text, kind: "message", createdAt: new Date().toISOString() }); return conversationId; },
    approvals: async () => approvals,
    decide: async (id, decision) => { const approval = approvals.find(item => item.id === id)!; approval.status = decision;
      inbox.push({ id: randomUUID(), conversationId: approval.conversationId, conversationKey: approval.conversationKey, targetBotId: approval.targetBotId, title: approval.title,
        text: "Human decision", kind: "approval", approvalId: approval.remoteId, decision, createdAt: new Date().toISOString() }); },
    results: async conversationId => outputs.filter(item => item.conversationId === conversationId), close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

it("connects companies and teams, carries remote chat to the correct native task, applies exact native decisions and resumes the same task after restart", async () => {
  const remote = await remoteFixture();
  const fixture = await launchRestartableServer({ scripted: true, env: { FAKE_CLAUDE_NOTIFICA_URL: remote.url } });
  const api = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(fixture.url + path, { method, headers: { "content-type": "application/json", origin: fixture.url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json() as any; expect(response.ok, JSON.stringify(value)).toBe(true); return value;
  };
  try {
    const bot = (await api("/api/bots", "POST", { name: "Remote marketer" })).bot;
    const other = (await api("/api/bots", "POST", { name: "Remote engineer" })).bot;
    await api(`/api/bots/${bot.id}/notifica`, "PUT", { enabled: true, key: "legacy-fixture-must-not-be-used" });
    await api(`/api/bots/${bot.id}`, "PATCH", { section: "Marketing", approvalMode: "ask" });
    await api(`/api/bots/${other.id}`, "PATCH", { section: "Development", approvalMode: "ask" });
    writeFileSync(fixture.planPath, JSON.stringify({ [bot.id]: { script: [
      { key: "deny", match: ["Denied native fixture"], approve: { tool_name: "Bash", input: { command: "echo denied-native-fixture" } }, reply: "Unexpected allow", replyIfDenied: "Native permission denied safely." },
      { key: "allow", match: ["Approved native fixture"], approve: { tool_name: "Bash", input: { command: "echo approved-native-fixture" } }, progress: "Permission accepted; preparing the report.", reply: "Native permission approved precisely.", replyIfDenied: "Unexpected denial" },
      { key: "resume", match: ["Same task after restart"], steps: [{ tool: "perguntar_usuario", arguments: { eventId: "workspace-binding-proof", title: "Mesma conversa", message: "A mensagem segue no workspace apesar da conexão individual existente.", expectsReply: false } }], reply: "Same remote task resumed." },
    ] }, [other.id]: { reply: "Engineering handled its own message." } }));
    const companies = [{ id: "acme", name: "Acme" }, { id: "beta", name: "Beta" }];
    await api("/api/notifica/workspace", "PUT", { enabled: true, key: remote.key, companies, teamCompanies: { Marketing: "acme", Development: "beta" } });
    await expect.poll(async () => (await api("/api/notifica/workspace")).lastSyncAt, { timeout: 20_000 }).toBeTruthy();
    const conversation = await remote.send(bot.id, "Denied native fixture");
    let pending: any;
    await expect.poll(async () => { pending = (await remote.approvals()).find(item => item.targetBotId === bot.id && item.status === "pending"); return pending; }, { timeout: 35_000 }).toBeTruthy();
    const tasks = (await api("/api/bots?messages=0")).bots.find((item: any) => item.id === bot.id).tasks;
    const task = tasks.find((item: any) => item.threadId !== bot.threadId);
    expect(task).toBeTruthy();
    const native = (await api(`/api/threads/${task.threadId}/messages`)).messages.find((message: any) => message.card?.tool === "Bash");
    expect(native.card.answered).toBeUndefined();
    await remote.decide(pending.id, "denied");
    await expect.poll(async () => (await remote.results(conversation)).some(item => item.text === "Native permission denied safely."), { timeout: 35_000 }).toBe(true);
    await expect.poll(async () => (await remote.approvals()).find(item => item.id === pending.id)?.status, { timeout: 10_000 }).toBe("applied");
    expect((await api(`/api/threads/${task.threadId}/messages`)).messages.find((message: any) => message.id === native.id).card.answered).toBe("deny");
    await remote.send(bot.id, "Approved native fixture");
    await expect.poll(async () => { pending = (await remote.approvals()).find(item => item.targetBotId === bot.id && item.status === "pending"); return pending; }, { timeout: 35_000 }).toBeTruthy();
    await remote.decide(pending.id, "approved");
    await expect.poll(async () => (await remote.results(conversation)).some(item => item.text === "Native permission approved precisely."), { timeout: 35_000 }).toBe(true);
    await expect.poll(async () => (await remote.results(conversation)).some(item => item.text === "Permission accepted; preparing the report."), { timeout: 10_000 }).toBe(true);
    const otherConversation = await remote.send(other.id, "Engineering only");
    await expect.poll(async () => (await remote.results(otherConversation)).some(item => item.text === "Engineering handled its own message."), { timeout: 35_000 }).toBe(true);
    await fixture.stop(); await fixture.start();
    await remote.send(bot.id, "Same task after restart");
    await expect.poll(async () => (await remote.results(conversation)).some(item => item.text === "Same remote task resumed."), { timeout: 35_000 }).toBe(true);
    await expect.poll(async () => (await remote.results(conversation)).some(item => item.text === "A mensagem segue no workspace apesar da conexão individual existente."), { timeout: 15_000 }).toBe(true);
    expect((await api(`/api/bots/${bot.id}/notifica`)).pending).toEqual([]);
    const final = (await api(`/api/threads/${task.threadId}/messages`)).messages;
    expect(final.filter((message: any) => message.role === "user" && message.text === "Same task after restart")).toHaveLength(1);
    expect(final.some((message: any) => message.text === "Engineering only")).toBe(false);
    expect((await api("/api/bots?messages=0")).bots.find((item: any) => item.id === bot.id).tasks).toHaveLength(2);
    writeFileSync(fixture.logPath + ".workspace-notifica.json", JSON.stringify({ realNotifica: Boolean(process.env.OMB_NOTIFICA_ACCEPTANCE_FIXTURE), companies, task, native, approvals: await remote.approvals(), final, results: await remote.results(conversation), status: await api("/api/notifica/workspace") }, null, 2));
    console.log("Notifica workspace acceptance evidence:", fixture.logPath);
  } finally { await fixture.close(); await remote.close(); }
}, 240_000);
