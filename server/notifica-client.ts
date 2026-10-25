import { notificaMessageReceipt, notificaReplyReceipt, type NotificaEvent } from "./notifica-state.ts";
import { z } from "zod";

export const NOTIFICA_API = "https://api-notifica.adapton.com.br";
export const NOTIFICA_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
export const notificaAttachment = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().min(1).max(240), mime: z.string().min(1).max(200), bytes: z.number().int().min(0).max(NOTIFICA_ATTACHMENT_MAX_BYTES) });

export class NotificaHttpError extends Error {
  readonly status: number;
  readonly retryAt?: number;
  constructor(status: number, retryAt?: number) {
    super(`Notifica HTTP ${status}`);
    this.status = status;
    this.retryAt = retryAt;
  }
}

export function notificaRetryAt(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const at = Number.isFinite(seconds) ? now + seconds * 1_000 : Date.parse(value);
  return Number.isFinite(at) ? Math.max(now, at) : undefined;
}

export class NotificaClient {
  private readonly baseUrl: string;
  private readonly request: typeof fetch;
  constructor(baseUrl = NOTIFICA_API, request: typeof fetch = fetch) {
    if (baseUrl !== NOTIFICA_API && !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(baseUrl)) throw new Error("Notifica test endpoint must be loopback");
    this.baseUrl = baseUrl;
    this.request = request;
  }
  async send(key: string, event: NotificaEvent, signal?: AbortSignal) {
    return notificaMessageReceipt.parse(await this.post("agentMessage", key, event.payload, signal));
  }
  async poll(key: string, event: NotificaEvent, signal?: AbortSignal) {
    if (!event.remote) throw new Error("Missing Notifica receipt");
    return notificaReplyReceipt.parse(await this.post("agentReply", key, {
      conversationId: event.remote.conversationId, questionId: event.remote.messageId,
    }, signal));
  }
  async post(path: string, key: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await this.request(`${this.baseUrl}/${path}`, {
      method: "POST", redirect: "error", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    return this.readResponse(response);
  }
  async uploadAttachment(key: string, metadata: { eventId: string; name: string; targetBotId: string }, bytes: Uint8Array, signal?: AbortSignal) {
    if (bytes.byteLength > NOTIFICA_ATTACHMENT_MAX_BYTES) throw new NotificaHttpError(413);
    const response = await this.request(`${this.baseUrl}/agentAttachment?${new URLSearchParams(metadata)}`, {
      method: "POST", redirect: "error", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/octet-stream" },
      body: new Uint8Array(bytes), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
    });
    return z.object({ attachment: notificaAttachment }).parse(await this.readResponse(response)).attachment;
  }
  private async readResponse(response: Response): Promise<unknown> {
    if (!response.ok) {
      await response.body?.cancel();
      throw new NotificaHttpError(response.status, notificaRetryAt(response.headers.get("retry-after"), Date.now()));
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty Notifica response");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 512_000) throw new Error("Notifica response too large");
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally { await reader.cancel().catch(() => {}); }
  }
}
