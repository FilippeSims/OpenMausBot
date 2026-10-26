import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";
import { notificaAttachment } from "./notifica-client.ts";

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/);
export const workspaceSettings = z.object({
  enabled: z.boolean(), key: z.string().trim().min(1).max(4096).regex(/^[!-~]+$/).optional(),
  companies: z.array(z.object({ id, name: z.string().trim().min(1).max(120) }).strict()).min(1).max(30),
  teamCompanies: z.record(z.string().max(200), id),
}).strict().superRefine((value, context) => {
  const ids = new Set(value.companies.map(company => company.id));
  if (ids.size !== value.companies.length || Object.values(value.teamCompanies).some(companyId => !ids.has(companyId))) {
    context.addIssue({ code: "custom", message: "Every team must belong to an existing, unique company." });
  }
});
const origin = z.object({ botId: z.string(), threadId: z.string(), groupId: z.string().optional() });
export const workspaceInbox = z.object({ messages: z.array(z.object({
  id: z.string().min(1).max(256), conversationId: z.string().min(1).max(256), conversationKey: z.string().min(1).max(256),
  title: z.string().max(200), text: z.string().max(100_000), targetBotId: id,
  kind: z.enum(["message", "reply", "approval"]), questionId: z.string().nullable().optional(),
  approvalId: z.string().max(200).optional(), decision: z.enum(["approved", "denied"]).optional(),
  createdAt: z.string(), sequence: z.number().optional(),
})).max(20) });
export type WorkspaceInboxMessage = z.infer<typeof workspaceInbox>["messages"][number];
const approval = z.object({ id: z.string(), origin, requestId: z.string(), messageId: z.string(), title: z.string(), message: z.string(), tool: z.string(), expiresAt: z.string() });
export type WorkspaceApproval = z.infer<typeof approval>;
const binding = z.object({ origin, conversationKey: z.string(), conversationId: z.string().optional(), title: z.string(), since: z.number(), historyThrough: z.number().optional() });
export type WorkspaceBinding = z.infer<typeof binding>;
const outbox = z.object({
  id: z.string(), path: z.enum(["agentMessage", "agentTranscript", "agentApproval", "agentApprovalResolve"]), body: z.record(z.string(), z.unknown()),
  sent: z.boolean().default(false), failed: z.string().optional(), requestHash: z.string().optional(), questionId: z.string().optional(), answered: z.boolean().optional(),
});
const fileTransfer = z.object({
  id: z.string(), origin, messageId: z.string(), href: z.string(), name: z.string(), conversationKey: z.string(), title: z.string(),
  staged: z.boolean().default(false), bytes: z.number().int().min(0).optional(), attempts: z.number().default(0), nextAt: z.number().default(0),
  failed: z.string().optional(), notified: z.boolean().default(false), attachment: notificaAttachment.optional(),
});
export type WorkspaceFileTransfer = z.infer<typeof fileTransfer>;
const account = z.object({
  key: z.string(), authFailed: z.boolean().default(false), notBefore: z.number().default(0), attempts: z.number().default(0), catalogError: z.string().optional(), catalogErrorHash: z.string().optional(), error: z.string().optional(),
  lastSyncAt: z.number().optional(), catalogHash: z.string().optional(), nextPollAt: z.number().default(0),
  bindings: z.record(z.string(), binding).default({}), approvals: z.record(z.string(), approval.extend({ resolution: z.enum(["applied", "cancelled", "expired"]).optional() })).default({}),
  inbox: z.record(z.string(), z.object({ message: workspaceInbox.shape.messages.element, phase: z.enum(["received", "applying", "accepted", "acked"]), nextAt: z.number().optional(), error: z.string().optional() })).default({}),
  outbox: z.array(outbox).default([]),
  files: z.record(z.string(), fileTransfer).default({}),
});
const schema = z.object({ version: z.literal(1), enabled: z.boolean().default(false), activeCredential: z.string().default(""),
  companies: workspaceSettings.shape.companies, teamCompanies: workspaceSettings.shape.teamCompanies, teamIds: z.record(z.string(), z.string()).default({}),
  accounts: z.record(z.string(), account).default({}) });
export type WorkspaceState = z.infer<typeof schema>;
export type WorkspaceAccount = z.infer<typeof account>;

export class NotificaWorkspaceFile {
  readonly state: WorkspaceState;
  private readonly file: string;
  private readonly keyFile: string;
  private readonly filesDir: string;
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "notifica-workspace.json.enc");
    this.keyFile = join(dataDir, "notifica-workspace-key");
    this.filesDir = join(dataDir, "notifica-workspace-files");
    if (!existsSync(this.file)) {
      this.state = schema.parse({ version: 1, companies: [{ id: "company-default", name: "Minha empresa" }], teamCompanies: {} });
      return;
    }
    try {
      const bytes = Buffer.from(readFileSync(this.file, "utf8"), "base64");
      const decipher = createDecipheriv("aes-256-gcm", this.key(false), bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(-16));
      this.state = schema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString("utf8")));
    } catch { throw new Error("Notifica workspace private state cannot be opened. Restore its encrypted file and key together; pending work was preserved."); }
  }
  save(): void {
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key(true), nonce);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(this.state), "utf8"), cipher.final()]);
    writeFileAtomic(this.file, Buffer.concat([nonce, bytes, cipher.getAuthTag()]).toString("base64"), { mode: 0o600 });
  }
  stageAttachment(credential: string, id: string, bytes: Uint8Array): void {
    mkdirSync(this.filesDir, { recursive: true, mode: 0o700 });
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key(true), nonce);
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    writeFileAtomic(this.attachmentPath(credential, id), Buffer.concat([nonce, encrypted, cipher.getAuthTag()]), { mode: 0o600 });
  }
  attachmentBytes(credential: string, id: string): Buffer {
    const encrypted = readFileSync(this.attachmentPath(credential, id));
    const decipher = createDecipheriv("aes-256-gcm", this.key(false), encrypted.subarray(0, 12));
    decipher.setAuthTag(encrypted.subarray(-16));
    return Buffer.concat([decipher.update(encrypted.subarray(12, -16)), decipher.final()]);
  }
  discardAttachment(credential: string, id: string): void {
    try { unlinkSync(this.attachmentPath(credential, id)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  cleanupAttachments(): void {
    if (!existsSync(this.filesDir)) return;
    const keep = new Set(Object.entries(this.state.accounts).flatMap(([credential, account]) => Object.values(account.files)
      .filter(file => file.staged && !file.attachment && !file.failed).map(file => this.attachmentName(credential, file.id))));
    for (const name of readdirSync(this.filesDir)) if (/^[a-f0-9]{64}\.enc(?:\.\d+\.[0-9a-f-]+\.tmp)?$/.test(name) && !keep.has(name)) unlinkSync(join(this.filesDir, name));
  }
  private attachmentName(credential: string, id: string): string { return createHash("sha256").update(JSON.stringify([credential, id])).digest("hex") + ".enc"; }
  private attachmentPath(credential: string, id: string): string { return join(this.filesDir, this.attachmentName(credential, id)); }
  private key(create: boolean): Buffer {
    if (!existsSync(this.keyFile)) {
      if (!create) throw new Error("Missing private key");
      writeFileAtomic(this.keyFile, randomBytes(32).toString("hex"), { mode: 0o600 });
    }
    const hex = readFileSync(this.keyFile, "utf8").trim();
    if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error("Invalid private key");
    return Buffer.from(hex, "hex");
  }
}
