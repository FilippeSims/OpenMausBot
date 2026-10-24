import { createHash, randomUUID } from "node:crypto";
import type { NotificaStatus } from "../shared/notifica.ts";
import { NotificaClient, NotificaHttpError } from "./notifica-client.ts";
import { notificaInput, NotificaStateFile, type NotificaEvent, type NotificaOrigin } from "./notifica-state.ts";

type Host = {
  exists(origin: NotificaOrigin): boolean;
  deliver(event: NotificaEvent, sendId: string): Promise<void>;
  changed(botId: string): void;
  ready(): boolean;
};
const unfinished = (event: NotificaEvent) => event.state !== "sent" && event.state !== "delivered";
const conversation = (origin: NotificaOrigin) => `maus-${createHash("sha256").update(`${origin.botId}\0${origin.threadId}`).digest("hex").slice(0, 48)}`;
const replyKey = (event: NotificaEvent) => JSON.stringify([event.origin.botId, event.remote!.conversationId, event.reply!.id]);

export class NotificaService {
  private readonly file: NotificaStateFile;
  private readonly host: Host;
  private readonly client: NotificaClient;
  private readonly pollMs: number;
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private work?: Promise<void>;
  private storageFailed = false;
  private readonly inFlight = new Set<string>();

  constructor(dataDir: string, host: Host, client = new NotificaClient(), pollMs = 15_000) {
    this.file = new NotificaStateFile(dataDir);
    this.host = host;
    this.client = client;
    this.pollMs = pollMs;
  }

  status(botId: string): NotificaStatus {
    const connection = this.file.state.connections[botId];
    const events = this.file.state.events.filter(event => event.origin.botId === botId && unfinished(event));
    const credentials = new Set([connection?.activeCredential, ...events.map(event => event.credentialId)]);
    return {
      configured: Boolean(connection?.activeCredential), enabled: connection?.enabled ?? false,
      authFailed: [...credentials].some(id => Boolean(id && connection?.credentials[id]?.authFailed)),
      ...(connection && connection.notBefore > Date.now() ? { retryAt: connection.notBefore } : {}),
      pending: events.map(event => ({
        eventId: event.payload.eventId, threadId: event.origin.threadId, conversationKey: event.payload.conversationKey,
        title: event.payload.title, status: event.error ? "erro" : event.state === "received" ? "recebido"
          : event.state === "waiting" ? "aguardando_usuario" : "enfileirado",
        ...(event.remote ? { conversationId: event.remote.conversationId, messageId: event.remote.messageId, alertId: event.remote.alertId ?? undefined } : {}),
        ...(event.error ? { error: event.error } : {}),
      })),
    };
  }

  configure(botId: string, input: { enabled: boolean; key?: string; replacePendingKey?: boolean }): NotificaStatus {
    this.assertWritable();
    if (input.key && input.replacePendingKey && this.file.state.events.some(event => event.origin.botId === botId && this.inFlight.has(event.id))) throw Object.assign(new Error("Notifica communication is in progress. Retry the key update in a moment."), { status: 409 });
    let connection = this.file.state.connections[botId];
    if (!connection && !input.key) throw Object.assign(new Error("Configure a Notifica agent key first."), { status: 400 });
    if (!connection) connection = this.file.state.connections[botId] = { enabled: false, activeCredential: "", credentials: {}, notBefore: 0 };
    if (input.key) {
      const id = createHash("sha256").update(input.key).digest("hex");
      connection.credentials[id] = { key: input.key, authFailed: false };
      connection.activeCredential = id;
      if (input.replacePendingKey) {
        for (const event of this.file.state.events.filter(event => event.origin.botId === botId && unfinished(event))) {
          event.credentialId = id;
          delete event.blocked; delete event.error;
        }
      }
    }
    connection.enabled = input.enabled;
    this.persist(botId); this.kick();
    return this.status(botId);
  }

  retry(botId: string): NotificaStatus {
    this.assertWritable();
    const connection = this.file.state.connections[botId];
    if (!connection) return this.status(botId);
    for (const credential of Object.values(connection.credentials)) credential.authFailed = false;
    for (const event of this.file.state.events.filter(event => event.origin.botId === botId && unfinished(event))) {
      delete event.blocked; delete event.error;
      event.nextAt = Math.max(Date.now(), connection.notBefore);
    }
    this.persist(botId); this.kick();
    return this.status(botId);
  }

  enqueue(origin: NotificaOrigin, input: unknown) {
    this.assertWritable();
    const parsed = notificaInput.parse(input);
    const connection = this.file.state.connections[origin.botId];
    if (!connection?.enabled || !connection.activeCredential) throw Object.assign(new Error("Notifica is not enabled for this bot. Configure it in Bot settings → Voice & alerts."), { status: 409 });
    if (!this.host.exists(origin)) throw Object.assign(new Error("The original conversation no longer exists."), { status: 409 });
    const payload = { ...parsed, conversationKey: conversation(origin), eventId: parsed.eventId ?? randomUUID() };
    const previous = this.file.state.events.find(event => event.origin.botId === origin.botId && event.payload.conversationKey === payload.conversationKey && event.payload.eventId === payload.eventId);
    if (previous) {
      if (JSON.stringify(previous.payload) !== JSON.stringify(payload)) throw Object.assign(new Error("eventId already belongs to different content. Retry with the original content."), { status: 409 });
      return this.receipt(previous, true);
    }
    const event: NotificaEvent = { id: randomUUID(), origin: { ...origin }, credentialId: connection.activeCredential, payload,
      state: "queued", createdAt: Date.now(), nextAt: 0, attempts: 0 };
    this.file.state.events.push(event);
    this.persist(origin.botId); this.kick();
    return this.receipt(event, false);
  }

  waiting(botId: string, threadId: string): boolean {
    return this.file.state.events.some(event => event.origin.botId === botId && event.origin.threadId === threadId && event.payload.expectsReply && unfinished(event));
  }
  waitingThread(threadId: string): boolean {
    return this.file.state.events.some(event => event.origin.threadId === threadId && event.payload.expectsReply && unfinished(event));
  }
  prompt(botId: string): string {
    if (!this.file.state.connections[botId]?.enabled) return "";
    return "Notifica is connected for this bot. Use perguntar_usuario to request a user decision or send a result (expectsReply=false). The server binds the question to this exact conversation and polls without model calls. Supply a unique eventId for each message; reuse the same eventId AND identical content only to retry that message. After requesting a reply, end this turn and wait. A durable queued receipt is not confirmation of remote delivery. The answer will return as an ordinary user message in this conversation; do not poll, invent an answer, treat a timeout as approval, or start the original task over. Other bot tasks can continue. At most one question is pending per conversation; later Notifica messages wait in order.";
  }

  start(): void { if (!this.storageFailed) { this.running = true; this.kick(); } }
  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
  }
  async settled(): Promise<void> { await this.work; }
  async close(): Promise<void> { this.stop(); await this.settled(); }

  private receipt(event: NotificaEvent, duplicate: boolean) {
    return { eventId: event.payload.eventId, conversationKey: event.payload.conversationKey, state: event.state,
      status: event.payload.expectsReply && unfinished(event) ? "aguardando_usuario" : event.state,
      ...event.remote, duplicate, instruction: event.payload.expectsReply
        ? "Question saved durably. End this turn. The user's reply will arrive in this same conversation; do not call the model or poll while waiting."
        : "Notification saved durably and queued for delivery in conversation order." };
  }
  private persist(botId: string): void {
    try { this.file.save(); }
    catch (error) { this.storageFailed = true; this.stop(); throw error; }
    this.host.changed(botId);
  }
  private assertWritable(): void {
    if (this.storageFailed) throw Object.assign(new Error("Notifica storage failed. Fix the installation's disk and restart before retrying; saved questions are preserved."), { status: 503 });
  }
  private kick(): void {
    if (!this.running || this.work) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.controller = new AbortController();
      this.work = this.tick(this.controller.signal).catch(() => {
        console.error("Notifica: communication state could not be updated; pending questions remain on disk.");
      }).finally(() => {
        this.work = undefined; this.controller = undefined;
        if (this.running) {
          this.timer = setTimeout(() => { this.timer = undefined; this.kick(); }, 1_000);
          this.timer.unref();
        }
      });
    }, 0);
    this.timer.unref();
  }
  private async tick(signal: AbortSignal): Promise<void> {
    if (!this.host.ready()) return;
    const heads = new Map<string, NotificaEvent>();
    for (const event of this.file.state.events.filter(unfinished)) {
      const scope = JSON.stringify([event.origin.botId, event.payload.conversationKey]);
      if (!heads.has(scope)) heads.set(scope, event);
    }
    const due = [...heads.values()].filter(event => {
      const connection = this.file.state.connections[event.origin.botId];
      return connection?.enabled && !event.blocked && event.nextAt <= Date.now() && connection.notBefore <= Date.now()
        && (event.state === "received" || !connection.credentials[event.credentialId]?.authFailed);
    });
    for (let i = 0; i < due.length && !signal.aborted; i += 4) await Promise.all(due.slice(i, i + 4).map(event => this.advance(event, signal)));
  }
  private async advance(event: NotificaEvent, signal: AbortSignal): Promise<void> {
    const botId = event.origin.botId;
    const connection = this.file.state.connections[botId];
    if (signal.aborted || !connection.enabled || connection.notBefore > Date.now()) return;
    const credential = connection.credentials[event.credentialId];
    if (!this.host.exists(event.origin)) {
      event.blocked = true; event.error = "origin_missing"; this.persist(botId); return;
    }
    this.inFlight.add(event.id);
    try {
      if (event.state === "queued") {
        const remote = await this.client.send(credential.key, event, signal);
        event.remote = remote;
        event.state = event.payload.expectsReply ? "waiting" : "sent";
        event.nextAt = Date.now() + this.pollMs;
        event.attempts = 0; delete event.error;
        this.persist(botId);
        return;
      }
      if (event.state === "waiting") {
        const response = await this.client.poll(credential.key, event, signal);
        if (response.status === "pending") {
          event.nextAt = Date.now() + this.pollMs; event.attempts = 0; delete event.error;
          this.persist(botId); return;
        }
        if (response.reply.questionId !== event.remote!.messageId) throw new Error("Reply belongs to another question");
        event.reply = response.reply; event.state = "received";
        delete event.error; this.persist(botId);
      }
      if (event.state === "received") {
        if (!connection.enabled || signal.aborted || !this.host.ready()) return;
        const key = replyKey(event);
        const processed = this.file.state.processedReplies[key];
        if (!processed) {
          const sendId = `notifica-${createHash("sha256").update(key).digest("hex").slice(0, 48)}`;
          await this.host.deliver(event, sendId);
          // The normal agent queue durably accepts this sendId before the inbox is acknowledged.
          this.file.state.processedReplies[key] = event.id;
        }
        event.state = "delivered"; event.attempts = 0; delete event.error;
        this.persist(botId);
      }
    } catch (error) {
      if (signal.aborted) return;
      event.attempts += 1;
      const now = Date.now();
      event.nextAt = now + Math.min(300_000, Math.max(this.pollMs, 2_000 * 2 ** Math.min(event.attempts, 8)));
      if (error instanceof NotificaHttpError) {
        event.error = `http_${error.status}`;
        if (error.status === 401 || error.status === 403) credential.authFailed = true;
        else if (error.status === 429 || error.retryAt !== undefined) {
          connection.notBefore = Math.max(connection.notBefore, error.retryAt ?? now + this.pollMs);
          event.nextAt = Math.max(event.nextAt, connection.notBefore);
        } else if (error.status >= 400 && error.status < 500 && error.status !== 408) event.blocked = true;
      } else event.error = event.state === "received" ? "resume_failed" : "communication_failed";
      this.persist(botId);
    } finally { this.inFlight.delete(event.id); }
  }
}
