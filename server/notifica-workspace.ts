import { createHash, randomUUID } from "node:crypto";
import type { NotificaWorkspaceStatus } from "../shared/notifica.ts";
import type { NotificaOrigin } from "./notifica-state.ts";
import { notificaInput, notificaMessageReceipt } from "./notifica-state.ts";
import { NOTIFICA_ATTACHMENT_MAX_BYTES, NotificaClient, NotificaHttpError } from "./notifica-client.ts";
import type { OpenedMessageFile } from "./message-file.ts";
import type { WorkspaceOutput } from "./notifica-workspace-files.ts";
import { NotificaWorkspaceFile, workspaceInbox, workspaceSettings, type WorkspaceAccount, type WorkspaceApproval, type WorkspaceBinding, type WorkspaceFileTransfer } from "./notifica-workspace-state.ts";

export type WorkspaceBot = { id: string; name: string; section?: string; role?: string; chief?: boolean };
export type WorkspaceHost = {
  ready(): boolean;
  bots(): WorkspaceBot[];
  sections(): string[];
  exists(origin: NotificaOrigin): boolean;
  createThread(botId: string, title: string): NotificaOrigin;
  deliver(origin: NotificaOrigin, text: string, sendId: string): Promise<void>;
  outputs(origin: NotificaOrigin, since: number): WorkspaceOutput[];
  openFile?(origin: NotificaOrigin, messageId: string, href: string): Promise<OpenedMessageFile>;
  approvals(): WorkspaceApproval[];
  approvalState(approval: WorkspaceApproval, decision?: "approved" | "denied"): "pending" | "applied" | "cancelled";
  decide(approval: WorkspaceApproval, decision: "approved" | "denied"): Promise<boolean>;
  changed(): void;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const originKey = (origin: NotificaOrigin) => `maus-${hash(JSON.stringify(origin)).slice(0, 48)}`;
function chunks(text: string): string[] {
  const parts: string[] = [];
  for (let index = 0; index < text.length;) {
    let end = Math.min(index + 4000, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
    parts.push(text.slice(index, end)); index = end;
  }
  return parts;
}
const safeError = (error: unknown) => error instanceof NotificaHttpError ? `http_${error.status}` : "communication_failed";

export class NotificaWorkspaceService {
  private readonly file: NotificaWorkspaceFile;
  private running = false;
  private failed = false;
  private work?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private fileWork?: Promise<void>;
  private fileController?: AbortController;
  private readonly host: WorkspaceHost;
  private readonly client: NotificaClient;
  private readonly pollMs: number;
  constructor(dataDir: string, host: WorkspaceHost, client = new NotificaClient(), pollMs = 15_000) {
    this.file = new NotificaWorkspaceFile(dataDir); this.file.cleanupAttachments(); this.host = host; this.client = client; this.pollMs = pollMs;
  }
  private get account(): WorkspaceAccount | undefined { return this.file.state.accounts[this.file.state.activeCredential]; }
  async organization(request: unknown, actor: {type: 'human'|'bot'; id: string; conversation_id: string|null}): Promise<unknown> {
    if (!this.enabled()) throw Object.assign(new Error("Conecte e ative o Notifica em Configurações → Chaves de API → Notifica · Empresas e times."), {status: 409});
    if (actor.type === 'bot' && !this.host.bots().some(bot => bot.id === actor.id)) throw Object.assign(new Error("Agente indisponível."), {status: 403});
    return this.client.post("agentOrganization", this.account!.key, {request, actor});
  }
  enabled(): boolean { return Boolean(this.file.state.enabled && this.account); }
  handlesOrigin(origin: NotificaOrigin): boolean {
    return this.enabled() && Object.values(this.account!.bindings).some(binding => binding.origin.botId === origin.botId
      && binding.origin.threadId === origin.threadId && binding.origin.groupId === origin.groupId);
  }
  status(): NotificaWorkspaceStatus {
    const account = this.account, catalog = this.catalog();
    return { configured: Boolean(account), enabled: this.file.state.enabled, authFailed: account?.authFailed ?? false,
      companies: structuredClone(this.file.state.companies), teamCompanies: { ...this.file.state.teamCompanies }, teams: catalog.teams.map(team => ({ ...team, section: team.id === `team-${hash("").slice(0, 32)}` ? "" : team.name })), bots: catalog.bots.length,
      conversations: Object.values(account?.bindings ?? {}).filter(binding => !binding.origin.groupId && this.host.exists(binding.origin)).map(binding => ({botId: binding.origin.botId, threadId: binding.origin.threadId, title: binding.title, ...(binding.conversationId ? {conversationId: binding.conversationId} : {})})),
      pending: account ? Object.values(account.inbox).filter(item => item.phase !== "acked").length + account.outbox.filter(item => !item.sent || (item.body.expectsReply === true && !item.answered)).length + Object.values(account.files).filter(file => !file.attachment && !file.failed).length : 0,
      ...(account?.catalogError || account?.error || account?.outbox.some(job => job.failed) || Object.values(account?.inbox ?? {}).some(item => item.error) || Object.values(account?.files ?? {}).some(file => file.failed || file.attempts >= 5) ? { error: account?.catalogError ?? account?.error ?? "delivery_needs_attention" } : {}), ...(account?.lastSyncAt ? { lastSyncAt: account.lastSyncAt } : {}),
      ...(account && account.notBefore > Date.now() ? { retryAt: account.notBefore } : {}) };
  }
  linkConversation(origin: NotificaOrigin): NotificaWorkspaceStatus {
    this.assertWritable();
    if (!this.enabled() || !this.host.exists(origin) || origin.groupId) throw Object.assign(new Error("Conversa ou conexão indisponível."), {status: 409});
    const existing = Object.values(this.account!.bindings).some(binding => binding.origin.botId === origin.botId && binding.origin.threadId === origin.threadId);
    const binding = this.bindingForOrigin(this.account!, origin);
    if (!existing) {binding.since = 0;binding.historyThrough = Date.now();}
    this.persist(); this.kick(); return this.status();
  }
  configure(input: unknown): NotificaWorkspaceStatus {
    this.assertWritable();
    const parsed = workspaceSettings.parse(input), state = this.file.state;
    const previousCredential = state.activeCredential;
    const catalogError = this.catalogLimit(parsed.companies.length);
    if (catalogError && parsed.enabled) throw Object.assign(new Error(catalogError), { status: 400 });
    if (!parsed.key && !this.account) throw Object.assign(new Error("Informe a chave de conexão da empresa no Notifica."), { status: 400 });
    if (parsed.key) {
      const id = hash(parsed.key);
      state.accounts[id] ??= { key: parsed.key, authFailed: false, notBefore: 0, attempts: 0, nextPollAt: 0, bindings: {}, inbox: {}, approvals: {}, outbox: [], files: {} };
      state.activeCredential = id;
      state.accounts[id].authFailed = false;
    }
    state.enabled = parsed.enabled; state.companies = parsed.companies; state.teamCompanies = parsed.teamCompanies;
    if (!parsed.enabled || previousCredential !== state.activeCredential) this.fileController?.abort();
    if (this.account) { delete this.account.catalogHash; delete this.account.catalogErrorHash; this.account.nextPollAt = 0; }
    this.persist(); this.kick(); return this.status();
  }
  retry(): NotificaWorkspaceStatus {
    this.assertWritable();
    if (this.account) { this.account.authFailed = false; this.account.nextPollAt = 0; delete this.account.error; delete this.account.catalogHash; delete this.account.catalogError; delete this.account.catalogErrorHash; for (const job of this.account.outbox) delete job.failed; }
    if (this.account) for (const file of Object.values(this.account.files)) { delete file.failed; file.attempts = 0; file.nextAt = 0; }
    this.persist(); this.kick(); return this.status();
  }
  private catalogLimit(companies = this.file.state.companies.length): string | null {
    const bots = this.host.bots(), teams = new Set([...this.host.sections(), ...bots.map(bot => bot.section ?? "")]).size;
    return teams > 100 || bots.length > 200 || companies + teams + bots.length > 240
      ? "O Notifica aceita até 100 times, 200 agentes e 240 itens no catálogo. Reduza o catálogo para sincronizar; as conversas já conectadas continuam recebendo mensagens." : null;
  }
  renameTeam(previous: string, next: string): void {
    if (previous === next) return;
    this.assertWritable();
    const state = this.file.state;
    if (state.teamCompanies[previous]) { state.teamCompanies[next] = state.teamCompanies[previous]; delete state.teamCompanies[previous]; }
    state.teamIds[next] = state.teamIds[previous] ?? `team-${hash(previous).slice(0, 32)}`;
    delete state.teamIds[previous];
    this.persist(); this.kick();
  }
  removeTeam(section: string): void {
    this.assertWritable(); delete this.file.state.teamCompanies[section]; delete this.file.state.teamIds[section]; this.persist(); this.kick();
  }
  catalog() {
    const { companies, teamCompanies } = this.file.state, bots = this.host.bots();
    const sections = [...new Set([...this.host.sections(), ...bots.map(bot => bot.section ?? "")])].sort();
    const teams = sections.map(section => ({ id: this.file.state.teamIds[section] ?? `team-${hash(section).slice(0, 32)}`, name: section || "Sem time", companyId: teamCompanies[section] ?? companies[0].id,
      ...(bots.find(bot => bot.chief && (bot.section ?? "") === section) ? { leadBotId: bots.find(bot => bot.chief && (bot.section ?? "") === section)!.id } : {}) }));
    return { companies, teams, bots: bots.map(bot => { const team = teams.find(team => team.id === (this.file.state.teamIds[bot.section ?? ""] ?? `team-${hash(bot.section ?? "").slice(0, 32)}`))!;
      return { id: bot.id, name: bot.name.slice(0, 120), companyId: team.companyId, teamId: team.id, ...(bot.role ? { role: bot.role.slice(0, 120) } : {}) }; }) };
  }
  waiting(botId: string, threadId: string): boolean {
    return Object.values(this.file.state.accounts).some(account => account.outbox.some(job => job.path === "agentMessage" && job.body.expectsReply === true && !job.answered
      && account.bindings[String(job.body.conversationKey)]?.origin.botId === botId && account.bindings[String(job.body.conversationKey)]?.origin.threadId === threadId));
  }
  waitingThread(threadId: string): boolean { return this.host.bots().some(bot => this.waiting(bot.id, threadId)); }
  prompt(): string {
    return this.enabled() ? "Use organizacao_pessoal for personal tasks, Kanban, calendar and reminders when explicitly authorized in Organização → Preferências. Read snapshot before edits; confirm persistence and never infer reminder times. Notifica connects this workspace's companies and teams. Use perguntar_usuario for questions and notifications. Wait after a question; its answer resumes this exact task. Native permission approvals go to Notifica automatically and require an explicit approval button. Never interpret chat text as a permission grant." : "";
  }
  enqueue(origin: NotificaOrigin, input: unknown) {
    this.assertWritable();
    if (!this.enabled() || !this.host.exists(origin)) throw Object.assign(new Error("Notifica workspace or original task is unavailable."), { status: 409 });
    const parsed = notificaInput.parse(input), account = this.account!, binding = this.bindingForOrigin(account, origin);
    const eventId = parsed.eventId ?? randomUUID(), requestHash = hash(JSON.stringify(parsed));
    const id = `question:${binding.conversationKey}:${eventId}`;
    const previous = account.outbox.find(job => job.id === id);
    if (previous && previous.requestHash !== requestHash) throw Object.assign(new Error("eventId already belongs to different content."), { status: 409 });
    if (!previous) {
      const parts = chunks(parsed.message);
      for (const [index, message] of parts.entries()) {
        const last = index === parts.length - 1;
        account.outbox.push({ id: last ? id : `${id}:part:${index}`, requestHash, path: "agentMessage", sent: false,
          body: { eventId: parts.length === 1 ? eventId : `part-${hash(id).slice(0, 48)}-${index}`, conversationKey: binding.conversationKey, targetBotId: origin.botId,
            title: parsed.title.slice(0, 160), message, expectsReply: last && parsed.expectsReply,
            ...(last && parsed.suggestions ? { suggestions: parsed.suggestions.map(value => value.slice(0, 120)) } : {}) } });
      }
    }
    this.persist(); this.kick();
    return { eventId, conversationKey: binding.conversationKey, state: "queued", duplicate: Boolean(previous), status: parsed.expectsReply ? "aguardando_usuario" : "queued", instruction: "Saved durably. End this turn when expecting an answer; it will arrive in this exact task." };
  }

  start(): void { if (!this.failed) { if (this.account) delete this.account.catalogHash; this.running = true; this.kick(); } }
  stop(): void { this.running = false; if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.controller?.abort(); this.fileController?.abort(); }
  async settled(): Promise<void> { await this.work; await this.fileWork; }
  async close(): Promise<void> { this.stop(); await this.settled(); }
  private assertWritable(): void { if (this.failed) throw Object.assign(new Error("Notifica workspace storage failed. Restore disk access and restart."), { status: 503 }); }
  private persist(): void {
    try { this.file.save(); } catch (error) { this.failed = true; this.stop(); throw error; }
    this.host.changed();
  }
  private kick(): void {
    if (!this.running || this.work || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined; this.controller = new AbortController();
      this.work = this.tick(this.controller.signal).catch(() => console.error("Notifica workspace: saved communication state needs attention.")).finally(() => {
        this.work = undefined; this.controller = undefined;
        if (this.running) { this.timer = setTimeout(() => { this.timer = undefined; this.kick(); }, 1_000); this.timer.unref(); }
      });
    }, 0); this.timer.unref();
  }
  private bindingForOrigin(account: WorkspaceAccount, origin: NotificaOrigin): WorkspaceBinding {
    const existing = Object.values(account.bindings).find(binding => JSON.stringify(binding.origin) === JSON.stringify(origin));
    if (existing) return existing;
    const conversationKey = originKey(origin), bot = this.host.bots().find(bot => bot.id === origin.botId);
    return account.bindings[conversationKey] = { origin: { ...origin }, conversationKey, title: (bot?.name ?? "OpenMausBot").slice(0, 120), since: Date.now() };
  }
  private collect(account: WorkspaceAccount): void {
    for (const approval of this.host.approvals()) {
      if (account.approvals[approval.id] || Date.parse(approval.expiresAt) <= Date.now()) continue;
      if (approval.message.length > 4000) {
        const id = `local-review:${approval.id}`, binding = this.bindingForOrigin(account, approval.origin);
        if (!account.outbox.some(job => job.id === id)) account.outbox.push({ id, path: "agentMessage", sent: false,
          body: { eventId: `review-${approval.id}`, targetBotId: approval.origin.botId, conversationKey: binding.conversationKey, title: "Revisão no OpenMausBot",
            message: "Há uma aprovação com detalhes extensos aguardando sua revisão. Abra a conversa deste agente no OpenMausBot para ler a solicitação completa e decidir.", expectsReply: false } });
        continue;
      }
      account.approvals[approval.id] = approval;
      const binding = this.bindingForOrigin(account, approval.origin);
      account.outbox.push({ id: `approval:${approval.id}`, path: "agentApproval", sent: false,
        body: { approvalId: approval.id, targetBotId: approval.origin.botId, conversationKey: binding.conversationKey, title: approval.title.slice(0, 160), message: approval.message, expiresAt: approval.expiresAt } });
    }
    for (const approval of Object.values(account.approvals)) {
      if (approval.resolution || Object.values(account.inbox).some(item => item.phase === "applying" && item.message.approvalId === approval.id)) continue;
      const state = this.host.approvalState(approval);
      if (state !== "pending" || Date.parse(approval.expiresAt) <= Date.now()) this.resolve(account, approval, Date.parse(approval.expiresAt) <= Date.now() ? "expired" : "cancelled");
    }
    for (const binding of Object.values(account.bindings)) {
      if (!this.host.exists(binding.origin)) continue;
      for (const message of this.host.outputs(binding.origin, binding.since)) {
        const historical = message.at !== undefined && binding.historyThrough !== undefined && message.at <= binding.historyThrough;
        for (const file of historical ? [] : message.files ?? []) {
          const id = hash(JSON.stringify([binding.conversationKey, message.id, file.href]));
          account.files[id] ??= { id, origin: { ...binding.origin }, messageId: message.id, href: file.href, name: file.name,
            conversationKey: binding.conversationKey, title: binding.title, staged: false, attempts: 0, nextAt: 0, notified: false };
        }
        for (const [index, text] of chunks(message.text).entries()) {
          if (!text.trim()) continue;
          const id = `output:${binding.conversationKey}:${message.id}:${index}`;
          if (account.outbox.some(job => job.id === id)) continue;
          const transcript = message.role === "user" || historical;
          account.outbox.push({ id, path: transcript ? "agentTranscript" : "agentMessage", sent: false, body: { eventId: `output-${hash(id).slice(0, 48)}`, conversationKey: binding.conversationKey,
            targetBotId: binding.origin.botId, title: binding.title.slice(0, 160), message: text, ...(transcript ? {role:message.role??'agent',...(message.at!==undefined?{occurredAt:new Date(message.at).toISOString()}:{})} : {expectsReply: false}) } });
        }
      }
    }
  }
  private resolve(account: WorkspaceAccount, approval: WorkspaceApproval, status: "applied" | "cancelled" | "expired"): void {
    account.approvals[approval.id].resolution = status;
    const publication = account.outbox.find(job => job.id === `approval:${approval.id}`);
    if (!publication?.sent) { if (publication) { publication.sent = true; delete publication.failed; } return; }
    const id = `resolve:${approval.id}`;
    if (!account.outbox.some(job => job.id === id)) account.outbox.push({ id, path: "agentApprovalResolve", sent: false,
      body: { approvalId: approval.id, targetBotId: approval.origin.botId, status } });
  }
  private active(account: WorkspaceAccount, signal: AbortSignal): boolean { return this.enabled() && this.account === account && this.host.ready() && !signal.aborted; }
  private async tick(signal: AbortSignal): Promise<void> {
    const account = this.account;
    if (!account || !this.active(account, signal) || account.authFailed || account.notBefore > Date.now()) return;
    try {
      const before = JSON.stringify([account.approvals, account.outbox, account.files]);
      this.collect(account);
      if (before !== JSON.stringify([account.approvals, account.outbox, account.files])) this.persist();
      const catalog = this.catalog(), catalogHash = hash(JSON.stringify(catalog));
      const catalogError = this.catalogLimit() ?? (catalogHash === account.catalogErrorHash ? account.catalogError : undefined);
      if (account.catalogError !== catalogError) { account.catalogError = catalogError; this.persist(); }
      if (!catalogError && catalogHash !== account.catalogHash) {
        try {
          await this.client.post("workspaceSync", account.key, catalog, signal);
          account.catalogHash = catalogHash; account.lastSyncAt = Date.now(); this.persist();
        } catch (error) {
          if (!(error instanceof NotificaHttpError) || ![400, 409, 413, 422].includes(error.status)) throw error;
          account.catalogError = "O catálogo foi recusado pelo Notifica. Confira empresas, times e limites. As conversas já conectadas continuam recebendo mensagens.";
          account.catalogErrorHash = catalogHash; this.persist();
        }
      }
      for (const job of account.outbox.filter(job => !job.sent && !job.failed)) {
        if (!this.active(account, signal)) return;
        if (job.path === "agentMessage" && account.outbox.slice(0, account.outbox.indexOf(job)).some(previous => previous.path === "agentMessage"
          && previous.body.conversationKey === job.body.conversationKey && previous.body.expectsReply === true && !previous.answered)) continue;
        let result: unknown;
        try { result = await this.client.post(job.path, account.key, job.body, signal); }
        catch (error) {
          if (error instanceof NotificaHttpError && [400, 404, 409, 413, 422].includes(error.status)) { job.failed = safeError(error); this.persist(); continue; }
          throw error;
        }
        if (job.path === "agentTranscript") {
          const conversationId = (result as {conversationId?: unknown})?.conversationId;
          if (typeof conversationId !== "string") throw new Error("Invalid transcript receipt");
          const binding = account.bindings[String(job.body.conversationKey)];
          if (binding) binding.conversationId = conversationId;
        }
        if (job.path === "agentMessage") {
          const remote = notificaMessageReceipt.parse(result);
          const binding = account.bindings[String(job.body.conversationKey)];
          if (binding) binding.conversationId = remote.conversationId;
          if (job.body.expectsReply === true) job.questionId = remote.messageId;
        }
        if (job.path === "agentApproval") {
          const conversationId = (result as { conversationId?: unknown })?.conversationId;
          if (typeof conversationId !== "string" || !conversationId) throw new Error("Invalid approval receipt");
          const binding = account.bindings[String(job.body.conversationKey)];
          if (binding) binding.conversationId = conversationId;
        }
        job.sent = true; this.persist();
      }
      if (account.nextPollAt <= Date.now()) {
        const inbox = workspaceInbox.parse(await this.client.post("agentInbox", account.key, { limit: 20 }, signal));
        for (const message of inbox.messages) {
          const key = `${message.conversationId}:${message.id}`;
          account.inbox[key] ??= { message, phase: "received" };
        }
        account.nextPollAt = Date.now() + this.pollMs; this.persist();
      }
      const blockedConversations = new Set<string>();
      for (const item of Object.values(account.inbox).filter(item => item.phase !== "acked")) {
        if (!this.active(account, signal)) return;
        if (blockedConversations.has(item.message.conversationId)) continue;
        if ((item.nextAt ?? 0) > Date.now()) { blockedConversations.add(item.message.conversationId); continue; }
        try { await this.receive(account, item); }
        catch (error) {
          if (this.failed) throw error;
          item.error = "resume_failed"; item.nextAt = Date.now() + this.pollMs;
          blockedConversations.add(item.message.conversationId); this.persist(); continue;
        }
        if (!this.active(account, signal)) return;
        await this.client.post("agentAck", account.key, { conversationId: item.message.conversationId, messageId: item.message.id }, signal);
        item.phase = "acked"; this.persist();
      }
      this.startFileTransfer(account);
      if (account.attempts || account.error) { account.attempts = 0; delete account.error; this.persist(); }
    } catch (error) {
      if (signal.aborted) return;
      account.error = safeError(error); account.attempts += 1;
      account.notBefore = Date.now() + Math.min(300_000, Math.max(this.pollMs, 2_000 * 2 ** Math.min(account.attempts, 8)));
      if (error instanceof NotificaHttpError) {
        if (error.status === 401 || error.status === 403) account.authFailed = true;
        if (error.retryAt) account.notBefore = Math.max(account.notBefore, error.retryAt);
      }
      this.persist();
    }
  }
  private startFileTransfer(account: WorkspaceAccount): void {
    if (this.fileWork || !this.running || account.authFailed) return;
    const controller = new AbortController(); this.fileController = controller;
    this.fileWork = this.transferFile(account, controller.signal).catch(error => {
      if (controller.signal.aborted || this.failed) return;
      account.error = safeError(error);
      if (error instanceof NotificaHttpError && [401, 403].includes(error.status)) account.authFailed = true;
      this.persist();
    }).catch(() => console.error("Notifica workspace: attachment communication state needs attention."))
      .finally(() => { this.fileWork = undefined; this.fileController = undefined; if (this.running) this.kick(); });
  }
  private fileNotice(account: WorkspaceAccount, file: WorkspaceFileTransfer, suffix: string, message: string, attachmentIds?: string[]): void {
    const id = `file:${file.id}:${suffix}`;
    if (!account.outbox.some(job => job.id === id)) account.outbox.push({ id, path: "agentMessage", sent: false,
      body: { eventId: `file-${file.id}-${suffix}`, conversationKey: file.conversationKey, targetBotId: file.origin.botId,
        title: file.title.slice(0, 160), message, expectsReply: false, ...(attachmentIds ? { attachmentIds } : {}) } });
  }
  private async transferFile(account: WorkspaceAccount, signal: AbortSignal): Promise<void> {
    const file = Object.values(account.files).find(file => !file.attachment && !file.failed && file.attempts < 5 && file.nextAt <= Date.now());
    if (!file || !this.active(account, signal)) return;
    const credential = hash(account.key);
    try {
      if (!file.staged) {
        if (!this.host.openFile) throw Object.assign(new Error("File unavailable"), { status: 404 });
        const opened = await this.host.openFile(file.origin, file.messageId, file.href);
        let bytes: Buffer;
        try {
          if (opened.bytes > NOTIFICA_ATTACHMENT_MAX_BYTES) throw Object.assign(new Error("File too large"), { status: 413 });
          const stagedBytes = Object.values(this.file.state.accounts).flatMap(value => Object.values(value.files))
            .filter(value => value.staged && !value.attachment && !value.failed).reduce((total, value) => total + (value.bytes ?? 0), 0);
          if (stagedBytes + opened.bytes > 250 * 1024 * 1024) throw Object.assign(new Error("Private attachment queue is full"), { status: 507 });
          bytes = Buffer.alloc(opened.bytes + 1);
          let offset = 0;
          while (offset < bytes.length) { const read = await opened.handle.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead; }
          if (offset !== opened.bytes) throw Object.assign(new Error("File changed during read"), { status: 409 });
          bytes = bytes.subarray(0, offset); file.name = opened.name; file.bytes = offset;
        } finally { await opened.handle.close(); }
        this.file.stageAttachment(credential, file.id, bytes); file.staged = true; this.persist();
      }
      if (!this.active(account, signal)) return;
      const bytes = this.file.attachmentBytes(credential, file.id);
      const attachment = await this.client.uploadAttachment(account.key, { eventId: `attachment-${file.id}`, name: file.name, targetBotId: file.origin.botId }, bytes, signal);
      if (attachment.bytes !== bytes.length || attachment.name !== file.name) throw new Error("Invalid attachment receipt");
      file.attachment = attachment;
      this.fileNotice(account, file, "ready", `Arquivo: ${attachment.name}`, [attachment.id]); this.persist();
      this.file.discardAttachment(credential, file.id);
    } catch (error) {
      if (signal.aborted || this.failed) throw error;
      if (error instanceof NotificaHttpError && [401, 403].includes(error.status)) throw error;
      const status = (error as { status?: number }).status;
      if (status && [400, 403, 404, 409, 413, 415, 422].includes(status)) {
        file.failed = `file_${status}`; file.staged = false; this.file.discardAttachment(credential, file.id);
        this.fileNotice(account, file, "unavailable", `Não foi possível transferir o arquivo ${file.name}: ${status === 413 ? "excede o limite de 50 MiB" : status === 403 ? "acesso não autorizado para esta mensagem" : "arquivo indisponível ou alterado"}. Confira o arquivo original no OpenMausBot.`);
      } else {
        file.attempts += 1;
        file.nextAt = Math.max(Date.now() + Math.min(300_000, 5_000 * 2 ** file.attempts), error instanceof NotificaHttpError ? error.retryAt ?? 0 : 0);
        if (!file.notified) { this.fileNotice(account, file, "pending", `A transferência do arquivo ${file.name} está pendente. O texto continua disponível; novas tentativas dependem da conexão e do espaço de armazenamento. Após cinco tentativas, use Tentar novamente na conexão do OpenMausBot.`); file.notified = true; }
      }
      this.persist();
    }
  }
  private async receive(account: WorkspaceAccount, item: WorkspaceAccount["inbox"][string]): Promise<void> {
    if (item.phase === "accepted") return;
    const message = item.message;
    delete item.error; delete item.nextAt;
    if (message.kind === "approval") {
      const approval = message.approvalId ? account.approvals[message.approvalId] : undefined;
      const binding = approval ? Object.values(account.bindings).find(candidate => JSON.stringify(candidate.origin) === JSON.stringify(approval.origin)) : undefined;
      if (!approval || approval.origin.botId !== message.targetBotId || !message.decision || !binding
        || binding.conversationKey !== message.conversationKey || binding.conversationId !== message.conversationId) {
        item.error = "approval_origin_mismatch";
      } else if (approval.resolution) {
        item.error = approval.resolution === "applied" ? undefined : "approval_closed";
      } else if (item.phase === "applying") {
        this.resolve(account, approval, this.host.approvalState(approval, message.decision) === "applied" ? "applied" : "cancelled");
      } else if (Date.parse(approval.expiresAt) <= Date.now()) {
        this.resolve(account, approval, "expired");
      } else if (this.host.approvalState(approval) !== "pending") {
        this.resolve(account, approval, "cancelled");
      } else {
        item.phase = "applying"; this.persist();
        const applied = await this.host.decide(approval, message.decision);
        this.resolve(account, approval, applied ? "applied" : "cancelled");
      }
      item.phase = "accepted"; this.persist(); return;
    }
    let binding = account.bindings[message.conversationKey];
    if (!binding) {
      if (message.kind !== "message" || !this.host.bots().some(bot => bot.id === message.targetBotId)) {
        item.error = "origin_missing"; item.phase = "accepted"; this.persist(); return;
      }
      binding = account.bindings[message.conversationKey] = { origin: this.host.createThread(message.targetBotId, message.title),
        conversationKey: message.conversationKey, conversationId: message.conversationId, title: message.title, since: Date.now() };
      this.persist();
    }
    if (binding.origin.botId !== message.targetBotId || (binding.conversationId && binding.conversationId !== message.conversationId) || !this.host.exists(binding.origin)) {
      item.error = "origin_missing"; item.phase = "accepted"; this.persist(); return;
    }
    const question = message.kind === "reply" ? account.outbox.find(job => job.questionId === message.questionId && job.body.conversationKey === message.conversationKey && job.body.targetBotId === message.targetBotId) : undefined;
    if (message.kind === "reply" && !question) { item.error = "question_missing"; item.phase = "accepted"; this.persist(); return; }
    const sendId = `notifica-${hash(JSON.stringify([hash(account.key), message.conversationId, message.id])).slice(0, 48)}`;
    await this.host.deliver(binding.origin, message.text, sendId);
    if (question) question.answered = true;
    item.phase = "accepted"; this.persist();
  }
}
