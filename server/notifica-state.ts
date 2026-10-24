import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";

export const notificaInput = z.object({
  eventId: z.string().min(1).max(128).regex(/^[\w.:-]+$/).optional(),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(20_000),
  expectsReply: z.boolean().default(true),
  suggestions: z.array(z.string().trim().min(1).max(200)).max(6).optional(),
}).strict();

const payloadSchema = notificaInput.omit({ eventId: true }).extend({ eventId: z.string(), conversationKey: z.string() });
const replySchema = z.object({ id: z.string().min(1).max(256), questionId: z.string().min(1).max(256), text: z.string().max(100_000), createdAt: z.string() });
export const notificaMessageReceipt = z.object({ conversationId: z.string().min(1).max(256), messageId: z.string().min(1).max(256),
  alertId: z.string().max(256).nullable(), duplicate: z.boolean() });
export const notificaReplyReceipt = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending"), reply: z.null() }),
  z.object({ status: z.literal("replied"), reply: replySchema }),
]);

const originSchema = z.object({ botId: z.string(), threadId: z.string(), groupId: z.string().optional() });
const eventSchema = z.object({
  id: z.string(), origin: originSchema, credentialId: z.string(), payload: payloadSchema,
  state: z.enum(["queued", "waiting", "received", "delivered", "sent"]),
  remote: notificaMessageReceipt.optional(), reply: replySchema.optional(),
  createdAt: z.number(), nextAt: z.number(), attempts: z.number(), error: z.string().optional(), blocked: z.boolean().optional(),
});
const connectionSchema = z.object({ enabled: z.boolean(), activeCredential: z.string(), notBefore: z.number(),
  credentials: z.record(z.string(), z.object({ key: z.string(), authFailed: z.boolean() })) });
const stateSchema = z.object({ version: z.literal(1), connections: z.record(z.string(), connectionSchema), events: z.array(eventSchema),
  processedReplies: z.record(z.string(), z.string()) });

export type NotificaOrigin = z.infer<typeof originSchema>;
export type NotificaEvent = z.infer<typeof eventSchema>;
export type NotificaState = z.infer<typeof stateSchema>;

/** Both files are installation-private: exporting them could make two installations resume the same reply. */
export class NotificaStateFile {
  private readonly file: string;
  private readonly keyFile: string;
  private key?: Buffer;
  readonly state: NotificaState;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "notifica.json.enc");
    this.keyFile = join(dataDir, "notifica-key");
    if (!existsSync(this.file)) {
      this.state = { version: 1, connections: {}, events: [], processedReplies: {} };
      return;
    }
    try {
      const bytes = Buffer.from(readFileSync(this.file, "utf8"), "base64");
      const decipher = createDecipheriv("aes-256-gcm", this.sealKey(false), bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(bytes.length - 16));
      const plain = Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]);
      this.state = stateSchema.parse(JSON.parse(plain.toString("utf8")));
    } catch {
      throw new Error("Notifica: private state cannot be opened; restore notifica-key and notifica.json.enc from the same installation. Existing questions were preserved.");
    }
  }

  save(): void {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.sealKey(true), nonce);
    const body = Buffer.concat([cipher.update(JSON.stringify(this.state), "utf8"), cipher.final()]);
    writeFileAtomic(this.file, Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64"), { mode: 0o600 });
  }

  private sealKey(create: boolean): Buffer {
    if (this.key) return this.key;
    if (existsSync(this.keyFile)) {
      const hex = readFileSync(this.keyFile, "utf8").trim();
      if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error("Invalid Notifica sealing key");
      return this.key = Buffer.from(hex, "hex");
    }
    if (!create) throw new Error("Missing Notifica sealing key");
    const key = randomBytes(32);
    writeFileAtomic(this.keyFile, key.toString("hex"), { mode: 0o600 });
    return this.key = key;
  }
}
