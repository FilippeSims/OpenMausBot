import { notificaMessageReceipt, notificaReplyReceipt, type NotificaEvent } from "./notifica-state.ts";

export const NOTIFICA_API = "https://api-notifica.adapton.com.br";

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
  private async post(path: string, key: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await this.request(`${this.baseUrl}/${path}`, {
      method: "POST", redirect: "error", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
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
