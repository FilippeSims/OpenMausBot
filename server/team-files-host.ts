import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, posix } from "node:path";
import { TeamFiles, teamFileBytes, teamFileError } from "./team-files.ts";
import { ATTACHMENTS_DIR } from "./attachments.ts";
import { openMessageFile } from "./message-file.ts";
import { sameAudience, roomFeeds } from "./bot-visibility.ts";
import { canAccessTeam, peerAllowed, type RosterMember } from "./peer-roster.ts";
import { sectionContextKey } from "./section-context.ts";
import { isGlobalChief } from "../shared/global-chief.ts";
import { writeFileAtomic } from "./atomic.ts";
import { TEAM_FILE_MAX_BYTES, TEAM_OUTPUTS_FOLDER } from "../shared/team-files.ts";
import type { Message, Store } from "./store.ts";

export type TeamFileStore = Pick<Store, "bots" | "sections" | "groups" | "bot" | "botByThread" | "groupByThread" | "onChange">;

export function teamFileTeams(from: RosterMember, bots: readonly RosterMember[], sections: readonly string[]): string[] {
  const own = sectionContextKey(from.section);
  const teams = [...new Set(["", ...sections, ...bots.filter(bot => !isGlobalChief(bot)).map(bot => sectionContextKey(bot.section))])];
  return teams.filter(team => {
    if (!isGlobalChief(from) && own === team) return true;
    if (!from.chiefOfStaff) return false;
    return canAccessTeam(from, team) && bots.filter(bot => !bot.hidden && !isGlobalChief(bot) && sectionContextKey(bot.section) === team)
      .every(bot => bot.id === from.id || peerAllowed(from, bot));
  });
}

export class TeamFilesHost {
  readonly files = new TeamFiles();
  private readonly store: TeamFileStore;
  private readonly jobs = new Set<Promise<unknown>>();
  private readonly pending = new Map<string, number>();
  private readonly problems = new Map<string, string>();
  private readonly active = new Set<string>();
  private readonly unsubscribe: () => void;
  private readonly beginWrite: () => () => void;

  constructor(store: TeamFileStore, beginWrite: () => () => void = () => () => {}) {
    this.store = store;
    this.beginWrite = beginWrite;
    this.unsubscribe = store.onChange(change => {
      if ((change.type === "message" || change.type === "message.patch") && change.message.role === "bot" && change.message.attachments?.length) {
        this.collect(change.threadId, change.message);
      }
    });
  }

  exists(section: string): boolean { return section === "" || this.store.sections.includes(section); }
  sections(from: RosterMember): string[] { return teamFileTeams(from, this.store.bots, this.store.sections); }

  authorize(from: RosterMember, section: string, write = false): void {
    const fresh = this.store.bot(from.id);
    if (!fresh) throw teamFileError(403, "This bot is no longer available.");
    from = fresh;
    if (!this.exists(section)) throw teamFileError(404, "No such team.");
    if (from.hidden || !this.sections(from).includes(section)) throw teamFileError(403, "This bot cannot access that team's files.");
    if (write && this.store.bots.some(bot => !bot.hidden && !isGlobalChief(bot) && sectionContextKey(bot.section) === section && !sameAudience(from.visibility, bot.visibility))) {
      throw teamFileError(403, "Files cannot be shared with a team whose bots have different audiences. Ask the owner to review team visibility.");
    }
  }

  status(section: string) { return { pendingDeliveries: this.pending.get(section) ?? 0, deliveryProblem: this.problems.has(section) }; }

  private collect(threadId: string, message: Message): void {
    const group = this.store.groupByThread(threadId);
    const bot = message.from ? this.store.bot(message.from.botId) : this.store.botByThread(threadId);
    if (!bot || isGlobalChief(bot)) return;
    const section = sectionContextKey(bot.section);
    if (group && (!group.memberIds.includes(bot.id) || !roomFeeds([group.audienceFloor, ...group.memberIds.map(id => this.store.bot(id)?.visibility)], bot.visibility))) return;
    for (const attachment of message.attachments ?? []) {
      if (attachment.kind === "audio") continue;
      const key = createHash("sha256").update(JSON.stringify([threadId, message.id, attachment.path])).digest("hex");
      if (this.active.has(key)) continue;
      let release: () => void;
      try { this.authorize(bot, section, true); release = this.beginWrite(); }
      catch { continue; }
      this.active.add(key);
      this.pending.set(section, (this.pending.get(section) ?? 0) + 1);
      const job = (async () => {
        const root = this.files.root(section);
        const record = join(root, ".maus", `delivery-${key}.json`);
        if (existsSync(record)) return;
        const sourcePath = attachment.path.startsWith("/api/attachments/") ? join(ATTACHMENTS_DIR, posix.basename(attachment.path)) : attachment.path;
        const source = await openMessageFile(sourcePath, [ATTACHMENTS_DIR]);
        let data: Buffer;
        try {
          if ((await source.handle.stat()).size > TEAM_FILE_MAX_BYTES) throw teamFileError(413, "The delivered file exceeds the team file limit.");
          data = await source.handle.readFile();
        } finally { await source.handle.close(); }
        const portableName = (value: string) => Array.from(value).map(char => char.charCodeAt(0) < 32 || /[\\/:*?"<>|]/.test(char) ? "_" : char).join("");
        const rawFolder = portableName(bot.name).replace(/^[. ]+|[. ]+$/g, "").slice(0, 60) || "Bot";
        const folderName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(rawFolder) ? `Bot ${rawFolder}` : rawFolder;
        const folder = `${TEAM_OUTPUTS_FOLDER}/${folderName}`;
        this.files.mkdir(section, folder);
        const name = portableName(posix.basename((attachment.name || attachment.path).replaceAll("\\", "/"))).slice(-180);
        const receipt = await this.files.write(section, `${folder}/${name}`, teamFileBytes(data), { unique: true, valid: () => {
          const fresh = this.store.bot(bot.id);
          if (!fresh || sectionContextKey(fresh.section) !== section || this.files.root(section) !== root) throw teamFileError(409, "The bot changed teams before this file was saved.");
          this.authorize(fresh, section, true);
        } });
        writeFileAtomic(record, JSON.stringify({ ...receipt, botId: bot.id, botName: bot.name, threadId, messageId: message.id, at: message.at }), { mode: 0o600 });
        this.problems.delete(section);
      })().catch(error => {
        this.problems.set(section, error instanceof Error ? error.message : "Could not save team delivery.");
        console.warn("team files: could not archive a delivered attachment", error instanceof Error ? error.message : String(error));
      }).finally(() => {
        release(); this.active.delete(key); this.pending.set(section, Math.max(0, (this.pending.get(section) ?? 1) - 1)); this.jobs.delete(job);
      });
      this.jobs.add(job);
    }
  }

  async settled(): Promise<void> { while (this.jobs.size) await Promise.allSettled(this.jobs); }
  async close(): Promise<void> { this.unsubscribe(); await this.settled(); }
}
