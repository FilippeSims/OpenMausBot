import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificaClient, notificaRetryAt } from "./notifica-client.ts";
import { NotificaService } from "./notifica.ts";
import { NotificaStateFile, type NotificaEvent } from "./notifica-state.ts";

const question = { eventId: "question-1", title: "Proposal review", message: "Which proposal first?", suggestions: ["A", "B"] };
const origin = { botId: "bot-a", threadId: "original-task" };
const response = (body: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(body), { status, headers });

describe("Notifica durable communication", () => {
  let dir: string;
  const services: NotificaService[] = [];
  let sends: Array<{ path: string; key: string; body: any }>;
  let replies: Map<string, string>;
  let delivered: Array<{ event: NotificaEvent; sendId: string }>;
  let handle: (call: { path: string; key: string; body: any }) => Response | Promise<Response>;
  let exists: boolean;
  function service() {
    const client = new NotificaClient("http://127.0.0.1:12345", vi.fn(async (url, init) => {
      const call = { path: new URL(String(url)).pathname, key: (init!.headers as Record<string, string>).Authorization, body: JSON.parse(String(init!.body)) };
      sends.push(call); return handle(call);
    }));
    const value = new NotificaService(dir, { ready: () => true, exists: () => exists, changed: () => {},
      deliver: async (event, sendId) => { delivered.push({ event: structuredClone(event), sendId }); } }, client);
    services.push(value); return value;
  }
  const step = (ms = 5) => vi.advanceTimersByTimeAsync(ms);
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    dir = mkdtempSync(join(tmpdir(), "omb-notifica-unit-"));
    sends = []; replies = new Map(); delivered = []; exists = true;
    handle = call => {
      if (call.path === "/agentMessage") return response({ conversationId: "conv-" + call.body.conversationKey,
        messageId: "msg-" + call.body.eventId, alertId: "alert-1", duplicate: false });
      const text = replies.get(call.body.questionId);
      return response(text === undefined ? { status: "pending", reply: null } : { status: "replied", reply: {
        id: "reply-" + call.body.questionId, questionId: call.body.questionId, text, createdAt: "2026-10-24T12:00:00Z",
      } });
    };
  });
  afterEach(async () => {
    await Promise.all(services.splice(0).map(value => value.close()));
    vi.useRealTimers(); rmSync(dir, { recursive: true, force: true });
  });

  it("survives restart, preserves the original task, queues later messages and lets another task continue", async () => {
    let value = service(); value.configure(origin.botId, { key: "private-a", enabled: true }); value.start();
    const saved = value.enqueue(origin, question);
    value.enqueue(origin, { eventId: "result-2", title: "Result", message: "Done", expectsReply: false });
    value.enqueue({ ...origin, threadId: "independent-task" }, { eventId: "independent", title: "Other task", message: "Completed independently", expectsReply: false });
    await step();
    expect(sends.filter(call => call.path === "/agentMessage").map(call => call.body.eventId)).toEqual(["question-1", "independent"]);
    expect(value.waiting(origin.botId, origin.threadId)).toBe(true);
    await step(31_000);
    expect(delivered).toHaveLength(0);
    expect(sends.filter(call => call.path === "/agentReply").length).toBeGreaterThanOrEqual(2);
    await value.close();
    value = service(); value.start();
    expect(value.status(origin.botId).pending[0].conversationId).toBe("conv-" + saved.conversationKey);
    replies.set("msg-question-1", "Start with A. $(touch /tmp/never-execute-this)");
    await step(18_000);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].event.origin).toEqual(origin);
    expect(delivered[0].event.reply!.text).toBe("Start with A. $(touch /tmp/never-execute-this)");
    expect(delivered[0].sendId).toMatch(/^notifica-[a-f0-9]{48}$/);
    expect(sends.at(-1)!.body.eventId).toBe("result-2");
    expect(value.waiting(origin.botId, origin.threadId)).toBe(false);
    await value.close(); value = service(); value.start(); await step(31_000);
    expect(delivered).toHaveLength(1);
    expect(JSON.stringify(value.status(origin.botId))).not.toContain("private-a");
    expect(readFileSync(join(dir, "notifica.json.enc"), "utf8")).not.toContain("private-a");
    if (process.platform !== "win32") expect(statSync(join(dir, "notifica-key")).mode & 0o777).toBe(0o600);
  });

  it("retries a lost acknowledgement using identical eventId, content and bot key", async () => {
    const normal = handle;
    let lost = true;
    handle = call => { if (call.path === "/agentMessage" && lost) { lost = false; throw new TypeError("connection lost after receipt"); } return normal(call); };
    const value = service(); value.configure(origin.botId, { key: "private-a", enabled: true }); value.start();
    value.enqueue(origin, question); await step();
    expect(value.waiting(origin.botId, origin.threadId)).toBe(true);
    expect(value.status(origin.botId).pending[0].error).toBe("communication_failed");
    expect(delivered).toHaveLength(0);
    await step(16_000);
    expect(sends[0]).toEqual(sends[1]);
    expect(value.status(origin.botId).pending[0].status).toBe("aguardando_usuario");
  });

  it("honors Retry-After across both endpoints, manual retry and restarts", async () => {
    const normal = handle;
    let limited = true;
    handle = call => limited ? response({}, 429, { "Retry-After": "60" }) : normal(call);
    let value = service(); value.configure(origin.botId, { key: "private-a", enabled: true }); value.start(); value.enqueue(origin, question);
    await step(); value.retry(origin.botId); await step(20_000);
    expect(sends).toHaveLength(1);
    await value.close(); value = service(); value.start(); await step(39_000);
    expect(sends).toHaveLength(1);
    limited = false; await step(2_000);
    expect(sends).toHaveLength(2);
  });

  it("pauses a rejected key without blocking another bot, and explicitly replaces a pending key", async () => {
    const normal = handle;
    handle = call => call.key === "Bearer revoked" ? response({}, 401) : normal(call);
    const value = service(); value.configure(origin.botId, { key: "revoked", enabled: true });
    value.configure("bot-b", { key: "private-b", enabled: true }); value.start(); value.enqueue(origin, question);
    value.enqueue({ botId: "bot-b", threadId: "other" }, { ...question, expectsReply: false }); await step(31_000);
    expect(sends.filter(call => call.key === "Bearer revoked")).toHaveLength(1);
    expect(sends.some(call => call.key === "Bearer private-b")).toBe(true);
    expect(value.status(origin.botId).authFailed).toBe(true);
    value.configure(origin.botId, { key: "renewed-for-same-agent", enabled: true, replacePendingKey: true });
    await step(16_000);
    expect(value.status(origin.botId).pending[0].messageId).toBe("msg-question-1");
    expect(sends.at(-1)!.key).toBe("Bearer renewed-for-same-agent");
    expect(value.status(origin.botId).authFailed).toBe(false);
  });

  it("pins pending requests to their original key until an owner explicitly replaces it", async () => {
    const value = service(); value.configure(origin.botId, { key: "original", enabled: true }); value.start(); value.enqueue(origin, question);
    await step(); value.configure(origin.botId, { key: "next-key", enabled: true }); await step(16_000);
    expect(sends.at(-1)!.key).toBe("Bearer original");
    value.configure(origin.botId, { enabled: false }); const count = sends.length; await step(45_000);
    expect(sends).toHaveLength(count); expect(value.status(origin.botId).pending).toHaveLength(1);
  });

  it("rejects changed content for an eventId and more than six suggestions", () => {
    const value = service(); value.configure(origin.botId, { key: "private-a", enabled: true });
    const receipt = value.enqueue(origin, question);
    expect(value.enqueue(origin, question)).toMatchObject({ duplicate: true, conversationKey: receipt.conversationKey });
    expect(() => value.enqueue(origin, { ...question, message: "Different" })).toThrow(/different content/);
    expect(() => value.enqueue(origin, { ...question, eventId: "q2", suggestions: Array(7).fill("A") })).toThrow();
    expect(() => value.enqueue(origin, { ...question, botId: "bot-b" })).toThrow();
    expect(value.status(origin.botId).pending).toHaveLength(1);
  });

  it("rejects a reply for a different question and never reroutes a deleted task", async () => {
    const normal = handle;
    handle = call => call.path === "/agentReply" ? response({ status: "replied", reply: { id: "wrong", questionId: "another-question", text: "Do it", createdAt: "now" } }) : normal(call);
    const value = service(); value.configure(origin.botId, { key: "private-a", enabled: true }); value.start(); value.enqueue(origin, question);
    await step(16_000); expect(delivered).toHaveLength(0); expect(value.status(origin.botId).pending[0].error).toBe("communication_failed");
    exists = false; await step(31_000);
    expect(value.status(origin.botId).pending[0].error).toBe("origin_missing"); expect(delivered).toHaveLength(0);
  });

  it("deduplicates a reply by bot, remote conversation and reply.id", async () => {
    const normal = handle;
    handle = call => call.path === "/agentReply" ? response({ status: "replied", reply: { id: "same-reply", questionId: call.body.questionId, text: "Same answer", createdAt: "now" } }) : normal(call);
    const value = service(); value.configure(origin.botId, { key: "private-a", enabled: true }); value.start();
    value.enqueue(origin, question); value.enqueue(origin, { ...question, eventId: "question-2" }); await step(34_000);
    expect(delivered).toHaveLength(1); expect(value.waiting(origin.botId, origin.threadId)).toBe(false);
    value.configure("bot-b", { key: "private-b", enabled: true }); value.enqueue({ ...origin, botId: "bot-b" }, question); await step(17_000);
    expect(delivered).toHaveLength(2);
  });

  it("preserves an unreadable private state rather than resetting pending questions", () => {
    const file = join(dir, "notifica.json.enc"); writeFileSync(file, "damaged-fixture");
    expect(() => new NotificaStateFile(dir)).toThrow(/Existing questions were preserved/);
    expect(readFileSync(file, "utf8")).toBe("damaged-fixture");
  });

  it("never sends or claims a durable receipt after the outbox could not be written", async () => {
    const value = service(); value.configure(origin.botId, { key: "private-a", enabled: true }); value.start();
    const save = vi.spyOn(NotificaStateFile.prototype, "save").mockImplementationOnce(() => { throw new Error("disk full"); });
    try {
      expect(() => value.enqueue(origin, question)).toThrow("disk full");
      expect(() => value.enqueue(origin, question)).toThrow(/storage failed/);
      value.start(); await step(60_000); expect(sends).toHaveLength(0);
    } finally { save.mockRestore(); }
  });
});

it("parses both Retry-After forms and refuses non-loopback test endpoints", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  expect(notificaRetryAt("30", now)).toBe(now + 30_000);
  expect(notificaRetryAt("Sat, 24 Oct 2026 12:01:00 GMT", now)).toBe(now + 60_000);
  expect(notificaRetryAt("invalid", now)).toBeUndefined();
  expect(() => new NotificaClient("https://another-host.example")).toThrow(/loopback/);
});
