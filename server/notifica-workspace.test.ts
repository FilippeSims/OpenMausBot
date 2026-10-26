import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificaClient } from "./notifica-client.ts";
import { NotificaWorkspaceService, type WorkspaceHost } from "./notifica-workspace.ts";
import { NotificaWorkspaceFile, type WorkspaceApproval, type WorkspaceInboxMessage } from "./notifica-workspace-state.ts";
import { openMessageFile } from "./message-file.ts";

const settings = { enabled: true, key: "fixture-secret", companies: [{ id: "company-a", name: "Acme" }, { id: "company-b", name: "Beta" }], teamCompanies: { Marketing: "company-a", Engineering: "company-b" } };
const origin = { botId: "bot-a", threadId: "task-a" };
const incoming = (extra: Partial<WorkspaceInboxMessage> = {}): WorkspaceInboxMessage => ({ id: "message-1", conversationId: "conv-1", conversationKey: "notifica:direct:bot-a", title: "Brief", text: "Review my campaign", targetBotId: "bot-a", kind: "message", createdAt: "2026-10-24T12:00:00Z", ...extra });

describe("workspace Notifica bridge", () => {
  let dir: string, host: WorkspaceHost, messages: WorkspaceInboxMessage[], calls: Array<{ path: string; body: any; query: URLSearchParams }>, approvals: WorkspaceApproval[];
  let handler: (path: string, body: any) => Response | Promise<Response>;
  const services: NotificaWorkspaceService[] = [];
  const response = (body: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(body), { status, headers });
  const service = () => {
    const value = new NotificaWorkspaceService(dir, host, new NotificaClient("http://127.0.0.1:12345", async (url, init) => {
      const target = new URL(String(url)), path = target.pathname, body = path === "/agentAttachment" ? Buffer.from(init?.body as Uint8Array) : JSON.parse(String(init?.body)); calls.push({ path, body, query: target.searchParams }); return handler(path, body);
    }), 1000); services.push(value); return value;
  };
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    dir = mkdtempSync(join(tmpdir(), "omb-workspace-unit-")); messages = []; calls = []; approvals = [];
    host = { ready: () => true, bots: () => [{ id: "bot-a", name: "Alice", section: "Marketing", chief: true }, { id: "bot-b", name: "Bob", section: "Engineering" }],
      sections: () => ["Marketing", "Engineering"], exists: () => true, createThread: vi.fn(() => origin), deliver: vi.fn(async () => {}), outputs: () => [],
      approvals: () => approvals, approvalState: () => "pending", decide: vi.fn(async () => true), changed: () => {} };
    handler = (path, body) => {
      if (path === "/agentInbox") return response({ messages });
      if (path === "/agentAck") { messages = messages.filter(message => message.id !== body.messageId); return response({ ok: true }); }
      if (path === "/agentMessage") return response({ conversationId: "conv-1", messageId: "remote-" + body.eventId, alertId: null, duplicate: false });
      if (path === "/agentTranscript") return response({conversationId:"conv-1",messageId:"mirror-"+body.eventId,duplicate:false});
      if (path === "/agentApproval") return response({ conversationId: "approval-conv", approvalId: "remote-approval", alertId: "alert", duplicate: false });
      return response({ ok: true });
    };
  });
  afterEach(async () => { await Promise.all(services.splice(0).map(value => value.close())); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });
  const step = (ms = 10) => vi.advanceTimersByTimeAsync(ms);
  it("backfills linked text without historical notifications, attachments, or repeated execution",async()=>{
    const old=Date.now()-60000;
    host.outputs=()=>[{id:'old-user',at:old,role:'user',text:'Earlier request'},{id:'old-bot',at:old+1000,text:'Earlier answer',files:[{href:'old.pdf',name:'old.pdf'}]}];
    const value=service();value.configure(settings);value.linkConversation(origin);value.start();await step(2500);
    const history=calls.filter(c=>c.path==='/agentTranscript');
    expect(history.map(c=>[c.body.role,c.body.message])).toEqual([['user','Earlier request'],['agent','Earlier answer']]);
    expect(history[0].body.occurredAt).toBe(new Date(old).toISOString());
    expect(calls.some(c=>c.path==='/agentMessage'||c.path==='/agentAttachment')).toBe(false);
    expect(host.deliver).not.toHaveBeenCalled();
    await value.close();const restarted=service();restarted.start();await step(2500);
    expect(calls.filter(c=>c.path==='/agentTranscript')).toHaveLength(2);
    host.outputs=()=>[{id:'new-bot',at:Date.now(),text:'Current answer'}];await step(2500);
    expect(calls.filter(c=>c.path==='/agentMessage').map(c=>c.body.message)).toEqual(['Current answer']);
  });
  it("syncs multiple companies, receives a new task, persists before acknowledgement and mirrors terminal replies once across restart", async () => {
    const normal = handler; let loseAck = true;
    handler = (path, body) => { if (path === "/agentAck" && loseAck) { loseAck = false; throw new TypeError("lost ack"); } return normal(path, body); };
    messages = [incoming()]; let value = service(); value.configure(settings); value.start(); await step();
    expect(calls.find(call => call.path === "/workspaceSync")?.body).toMatchObject({ companies: settings.companies,
      bots: [{ id: "bot-a", companyId: "company-a" }, { id: "bot-b", companyId: "company-b" }] });
    expect(host.deliver).toHaveBeenCalledTimes(1); expect(host.createThread).toHaveBeenCalledTimes(1);
    expect(new NotificaWorkspaceFile(dir).state.accounts).toMatchObject({ [Object.keys(new NotificaWorkspaceFile(dir).state.accounts)[0]]: { inbox: { "conv-1:message-1": { phase: "accepted" } } } });
    await value.close(); host.outputs = () => [{ id: "result", text: "Campaign reviewed" }]; value = service(); value.start(); await step(6000);
    expect(host.deliver).toHaveBeenCalledTimes(1); expect(host.createThread).toHaveBeenCalledTimes(1); expect(messages).toHaveLength(0);
    expect(calls.filter(call => call.path === "/agentMessage")).toHaveLength(1);
    expect(calls.find(call => call.path === "/agentMessage")?.body).toMatchObject({ targetBotId: "bot-a", conversationKey: "notifica:direct:bot-a", message: "Campaign reviewed" });
    expect(JSON.stringify(value.status())).not.toContain("fixture-secret"); expect(readFileSync(join(dir, "notifica-workspace.json.enc"), "utf8")).not.toContain("fixture-secret");
  });
  it("routes a structured decision to its exact approval and ignores other bots and chat text", async () => {
    approvals = [{ id: "local-approval", origin, requestId: "request-1", messageId: "card-1", title: "Permission", message: "Run command", tool: "Bash", expiresAt: new Date(Date.now() + 60_000).toISOString() }];
    const value = service(); value.configure(settings); value.start(); await step();
    const posted = calls.find(call => call.path === "/agentApproval")!.body;
    messages = [incoming({ id: "wrong-bot", kind: "approval", conversationId: "approval-conv", conversationKey: posted.conversationKey, targetBotId: "bot-b", approvalId: "local-approval", decision: "approved" }), incoming({ id: "plain", text: "approved" })];
    await step(1200); expect(host.decide).not.toHaveBeenCalled(); expect(host.deliver).toHaveBeenCalledWith(origin, "approved", expect.any(String));
    messages = [incoming({ id: "right", kind: "approval", conversationId: "approval-conv", conversationKey: posted.conversationKey, approvalId: "local-approval", decision: "denied" })];
    await step(2400); expect(host.decide).toHaveBeenCalledExactlyOnceWith(approvals[0], "denied");
    expect(calls.find(call => call.path === "/agentApprovalResolve")?.body).toMatchObject({ approvalId: "local-approval", targetBotId: "bot-a", status: "applied" });
    await value.close(); const restarted = service(); restarted.start(); await step(2400); expect(host.decide).toHaveBeenCalledTimes(1);
  });
  it("rejects stale permissions and validates question replies before freeing a waiting task", async () => {
    const value = service(); value.configure(settings); value.start();
    const question = value.enqueue(origin, { eventId: "q1", title: "Question", message: "Choose" }); await step();
    messages = [incoming({ kind: "reply", conversationKey: question.conversationKey, questionId: "wrong" })]; await step(1200);
    expect(host.deliver).not.toHaveBeenCalled(); expect(value.waiting(origin.botId, origin.threadId)).toBe(true);
    messages = [incoming({ id: "answer", kind: "reply", conversationKey: question.conversationKey, questionId: "remote-q1" })]; await step(1200);
    expect(host.deliver).toHaveBeenCalledTimes(1); expect(value.waiting(origin.botId, origin.threadId)).toBe(false);
  });
  it("keeps company membership and remote team identity through a rename", () => {
    const value = service(); value.configure(settings);
    const before = value.catalog().teams.find(team => team.name === "Engineering")!;
    host.sections = () => ["Marketing", "Development"];
    host.bots = () => [{ id: "bot-b", name: "Bob", section: "Development" }];
    value.renameTeam("Engineering", "Development");
    expect(value.catalog().teams.find(team => team.name === "Development")).toMatchObject({ id: before.id, companyId: "company-b" });
    expect(value.status().teamCompanies).toEqual({ Marketing: "company-a", Development: "company-b" });
    value.renameTeam("Development", "Development");
    expect(value.status().teams.find(team => team.section === "Development")?.companyId).toBe("company-b");
  });
  it("isolates failed tasks and invalid runtime catalogs while preserving other inbox deliveries", async () => {
    const value = service(); value.configure(settings); value.start(); await step();
    host.sections = () => Array.from({ length: 101 }, (_, index) => "team-" + index);
    host.createThread = (botId) => ({ botId, threadId: "thread-" + botId });
    host.deliver = vi.fn(async origin => { if (origin.botId === "bot-a") throw new Error("bot-a unavailable"); });
    messages = [incoming(), incoming({ id: "other", targetBotId: "bot-b", conversationId: "conv-2", conversationKey: "notifica:direct:bot-b" })];
    await step(1200);
    expect(value.status().error).toContain("100 times");
    expect(host.deliver).toHaveBeenCalledWith({ botId: "bot-b", threadId: "thread-bot-b" }, "Review my campaign", expect.any(String));
    expect(messages.map(message => message.id)).toEqual(["message-1"]);
    expect(calls.filter(call => call.path === "/workspaceSync")).toHaveLength(1);
    host.sections = () => ["Marketing", "Engineering"];
    await step(1200);
    expect(value.status().error).not.toContain("100 times");
  });
  it("splits long results without losing text and skips expired unpublished permissions", async () => {
    const value = service(); value.configure(settings); messages = [incoming()]; value.start(); await step();
    const long = "A".repeat(3999) + "🐭" + "B".repeat(5000);
    host.outputs = () => [{ id: "large-result", text: long }];
    approvals = [{ id: "expired", origin, requestId: "stale", messageId: "card", title: "Expired", message: "Do not run", tool: "Bash", expiresAt: new Date(Date.now() - 1).toISOString() }];
    await step(1200);
    const sent = calls.filter(call => call.path === "/agentMessage");
    expect(sent.map(call => call.body.message).join("")).toBe(long);
    expect(sent.every(call => call.body.message.length <= 4000)).toBe(true);
    expect(calls.some(call => call.path === "/agentApproval")).toBe(false);
    expect(new Set(sent.map(call => call.body.eventId)).size).toBe(sent.length);
    approvals.push({ ...approvals[0], id: "local-only", message: "Details".repeat(1000), expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await step(2400);
    expect(calls.filter(call => call.path === "/agentMessage" && call.body.eventId === "review-local-only")).toHaveLength(1);
    expect(calls.some(call => call.path === "/agentApproval")).toBe(false);
  });
  it("backs off after rate limits across manual retry and restart, preserving revoked credentials", async () => {
    const normal = handler; handler = () => response({}, 429, { "retry-after": "60" });
    let value = service(); value.configure(settings); value.start(); await step(); value.retry(); await step(10_000); expect(calls).toHaveLength(1);
    await value.close(); value = service(); value.start(); await step(40_000); expect(calls).toHaveLength(1);
    handler = () => response({}, 401); await step(11_000); expect(value.status().authFailed).toBe(true);
    const count = calls.length; await step(120_000); expect(calls).toHaveLength(count);
    handler = normal; value.retry(); await step(10_000); expect(value.status().authFailed).toBe(false);
  });
  it("retries an immutable private file snapshot across restart while sending text and a pending notice", async () => {
    const path = join(dir, "report.md"), original = Buffer.from("# Original report\n"); writeFileSync(path, original);
    const normal = handler; let uploads = 0;
    handler = (endpoint, body) => {
      if (endpoint !== "/agentAttachment") return normal(endpoint, body);
      if (++uploads === 1) throw new TypeError("response lost after upload");
      return response({ attachment: { id: "a".repeat(64), name: "report.md", mime: "text/markdown", bytes: body.length }, duplicate: true });
    };
    host.openFile = vi.fn(async () => openMessageFile(path, [dir]));
    messages = [incoming()]; let value = service(); value.configure(settings); value.start(); await step(); await value.settled();
    host.outputs = () => [{ id: "file-output", text: "The report is ready.", files: [{ href: path, name: "report.md" }] }];
    await step(1200); await value.settled();
    expect(calls.find(call => call.path === "/agentMessage")?.body.message).toBe("The report is ready.");
    const snapshots = readdirSync(join(dir, "notifica-workspace-files")); expect(snapshots).toHaveLength(1);
    expect(readFileSync(join(dir, "notifica-workspace-files", snapshots[0])).includes(original)).toBe(false);
    if (process.platform !== "win32") expect(statSync(join(dir, "notifica-workspace-files", snapshots[0])).mode & 0o777).toBe(0o600);
    await value.close(); writeFileSync(path, "changed after first upload");
    value = service(); value.start(); await step(12_000); await value.settled(); await step(1200); await value.settled();
    const sent = calls.filter(call => call.path === "/agentAttachment"); expect(sent).toHaveLength(2);
    expect(sent.map(call => call.body.toString())).toEqual([original.toString(), original.toString()]);
    expect(sent[0].query.toString()).toBe(sent[1].query.toString()); expect(sent[0].query.get("targetBotId")).toBe("bot-a");
    expect(host.openFile).toHaveBeenCalledTimes(1);
    expect(calls.filter(call => call.path === "/agentMessage" && call.body.attachmentIds)).toHaveLength(1);
    expect(calls.find(call => call.path === "/agentMessage" && call.body.attachmentIds)?.body).toMatchObject({ attachmentIds: ["a".repeat(64)], targetBotId: "bot-a" });
    expect(calls.filter(call => call.path === "/agentMessage" && call.body.message.includes("está pendente"))).toHaveLength(1);
    expect(readdirSync(join(dir, "notifica-workspace-files"))).toEqual([]);
  });
  it("reports refused files without blocking text, other files or later inbox messages", async () => {
    const path = join(dir, "clip.mp4"); writeFileSync(path, "fixture-video");
    const normal = handler;
    handler = (endpoint, body) => endpoint === "/agentAttachment"
      ? response({ attachment: { id: "b".repeat(64), name: "clip.mp4", mime: "video/mp4", bytes: body.length } }) : normal(endpoint, body);
    host.openFile = async (_origin, _id, href) => {
      if (href === "blocked") throw Object.assign(new Error("outside workspace"), { status: 403 });
      return openMessageFile(path, [dir]);
    };
    messages = [incoming()]; const value = service(); value.configure(settings); value.start(); await step(); await value.settled();
    host.outputs = () => [{ id: "mixed", text: "Useful text survives.", files: [{ href: "blocked", name: "blocked.md" }, { href: path, name: "clip.mp4" }] }];
    for (let i = 0; i < 4; i++) { await step(1200); await value.settled(); }
    messages = [incoming({ id: "later", text: "A later task" })]; await step(1200); await value.settled();
    expect(host.deliver).toHaveBeenCalledWith(origin, "A later task", expect.any(String));
    expect(calls.filter(call => call.path === "/agentAttachment")).toHaveLength(1);
    const texts = calls.filter(call => call.path === "/agentMessage").map(call => call.body.message);
    expect(texts).toContain("Useful text survives."); expect(texts.some(text => text.includes("blocked.md: acesso não autorizado"))).toBe(true);
    expect(calls.some(call => call.body.attachmentIds?.[0] === "b".repeat(64))).toBe(true);
  });
  it("keeps polling and delivering messages while a file upload is still in flight", async () => {
    const path = join(dir, "slow.mp4"); writeFileSync(path, "slow-file");
    let release!: (response: Response) => void;
    let started!: () => void;
    const uploadStarted = new Promise<void>(resolve => { started = resolve; });
    const uploading = new Promise<Response>(resolve => { release = resolve; }), normal = handler;
    handler = (endpoint, body) => { if (endpoint === "/agentAttachment") { started(); return uploading; } return normal(endpoint, body); };
    host.openFile = async () => openMessageFile(path, [dir]);
    messages = [incoming()]; const value = service(); value.configure(settings); value.start(); await step(); await value.settled();
    host.outputs = () => [{ id: "slow-result", text: "The upload will follow.", files: [{ href: path, name: "slow.mp4" }] }];
    try {
      await step(1200);
      await uploadStarted;
      expect(calls.filter(call => call.path === "/agentAttachment")).toHaveLength(1);
      messages = [incoming({ id: "during-upload", text: "Continue while the file uploads" })];
      await step(2400);
      expect(host.deliver).toHaveBeenCalledWith(origin, "Continue while the file uploads", expect.any(String));
      expect(messages).toEqual([]); expect(calls.filter(call => call.path === "/agentAttachment")).toHaveLength(1);
    } finally { release(response({ attachment: { id: "c".repeat(64), name: "slow.mp4", mime: "video/mp4", bytes: 9 } })); await value.settled(); }
    await step(1200); await value.settled();
    expect(calls.some(call => call.body.attachmentIds?.[0] === "c".repeat(64))).toBe(true);
  });
  it("pauses a revoked upload credential without discarding the private bytes and resumes only after retry", async () => {
    const path = join(dir, "private.md"); writeFileSync(path, "private-file");
    const normal = handler; let authorized = false;
    handler = (endpoint, body) => endpoint === "/agentAttachment" ? authorized
      ? response({ attachment: { id: "d".repeat(64), name: "private.md", mime: "text/markdown", bytes: body.length } }) : response({}, 401) : normal(endpoint, body);
    host.openFile = vi.fn(async () => openMessageFile(path, [dir]));
    messages = [incoming()]; const value = service(); value.configure(settings); value.start(); await step(); await value.settled();
    host.outputs = () => [{ id: "private-result", text: "Report ready", files: [{ href: path, name: "private.md" }] }];
    await step(1200); await value.settled(); expect(value.status().authFailed).toBe(true);
    await step(60_000); expect(calls.filter(call => call.path === "/agentAttachment")).toHaveLength(1);
    expect(readdirSync(join(dir, "notifica-workspace-files"))).toHaveLength(1);
    authorized = true; value.retry(); await step(1200); await value.settled(); await step(1200); await value.settled();
    expect(value.status().authFailed).toBe(false); expect(host.openFile).toHaveBeenCalledTimes(1);
    expect(calls.some(call => call.body.attachmentIds?.[0] === "d".repeat(64))).toBe(true);
  });
});
