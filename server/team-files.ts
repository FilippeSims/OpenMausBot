import { createHash, randomUUID } from "node:crypto";
import { constants, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { open } from "node:fs/promises";
import { basename, dirname, extname, join, posix } from "node:path";
import { DATA_DIR } from "./config.ts";
import { ensureSectionMemoryKey } from "./section-context.ts";
import { writeFileAtomic } from "./atomic.ts";
import { TEAM_FILE_MAX_BYTES, TEAM_FILES_MAX_BYTES, TEAM_FILES_MAX_ENTRIES, TEAM_OUTPUTS_FOLDER, TEAM_REFERENCES_FOLDER,
  type TeamFileEntry, type TeamFileReceipt, type TeamFileTrashEntry } from "../shared/team-files.ts";

export const teamFileError = (status: number, message: string) => Object.assign(new Error(message), { status });
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const reserved = (part: string) => part === ".maus" || part.startsWith(".maus-upload-");

export function teamFilePath(value: string, root = false): string {
  if (root && value === "") return "";
  if (typeof value !== "string" || value.length > 1_024 || value.split("/").length > 24 || value.split("/").some(part =>
    !part || part === "." || part === ".." || reserved(part) || Array.from(part).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || /[\\:*?"<>|]/.test(part) || /[. ]$/.test(part) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || Buffer.byteLength(part) > 240)) {
    throw teamFileError(400, "Use a relative file path with valid folder and file names.");
  }
  return value;
}

function realDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw teamFileError(403, "Symbolic links are not allowed in team files.");
}

export class TeamFiles {
  constructor(privateDirectory = join(DATA_DIR, "team-files"), identity: (section: string) => string = ensureSectionMemoryKey) {
    this.base = privateDirectory;
    this.identity = identity;
  }
  private readonly base: string;
  private readonly identity: (section: string) => string;
  private readonly queues = new Map<string, Promise<unknown>>();

  root(section: string): string {
    const root = join(this.base, hash(this.identity(section)).slice(0, 32));
    mkdirSync(this.base, { recursive: true, mode: 0o700 });
    realDirectory(this.base);
    for (const path of [root, join(root, TEAM_REFERENCES_FOLDER), join(root, TEAM_OUTPUTS_FOLDER), join(root, ".maus")]) {
      if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
      realDirectory(path);
    }
    return root;
  }

  private resolve(root: string, relative: string, allowMissing = false): string {
    teamFilePath(relative, true);
    realDirectory(root);
    let path = root;
    const parts = relative ? relative.split("/") : [];
    for (const [index, part] of parts.entries()) {
      path = join(path, part);
      let stat;
      try { stat = lstatSync(path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && allowMissing && index === parts.length - 1) return path;
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw teamFileError(404, "Team file or folder was not found.");
        throw error;
      }
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink !== 1)) {
        throw teamFileError(403, "Only regular team files and folders are available.");
      }
      if (index < parts.length - 1 && !stat.isDirectory()) throw teamFileError(400, "A parent path is not a folder.");
    }
    return path;
  }

  private async serial<T>(root: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(root) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation);
    this.queues.set(root, pending);
    try { return await pending; }
    finally { if (this.queues.get(root) === pending) this.queues.delete(root); }
  }

  list(section: string, relative = "", query = "", offset = 0): { root: string; entries: TeamFileEntry[]; total: number } {
    const root = this.root(section);
    const folder = this.resolve(root, relative);
    realDirectory(folder);
    const entries = readdirSync(folder).filter(name => !reserved(name)).flatMap(name => {
      try {
        const path = relative ? `${relative}/${name}` : name;
        const stat = lstatSync(this.resolve(root, path));
        return [{ name, path, kind: stat.isDirectory() ? "directory" as const : "file" as const, bytes: stat.size, modifiedAt: stat.mtimeMs }];
      } catch { return []; }
    }).filter(entry => entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      .sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name, undefined, { numeric: true }));
    return { root, total: entries.length, entries: entries.slice(offset, offset + 200) };
  }

  mkdir(section: string, relative: string): void {
    const root = this.root(section);
    teamFilePath(relative);
    let count = this.usage(root).count;
    let current = "";
    for (const part of relative.split("/")) {
      current = current ? `${current}/${part}` : part;
      const path = this.resolve(root, current, true);
      if (!existsSync(path)) {
        if (++count > TEAM_FILES_MAX_ENTRIES) throw teamFileError(413, "This team has reached its file and folder limit.");
        mkdirSync(path, { mode: 0o700 });
      }
      realDirectory(path);
    }
  }

  async read(section: string, relative: string, maxBytes = TEAM_FILE_MAX_BYTES): Promise<TeamFileReceipt & { data: Buffer; name: string }> {
    teamFilePath(relative);
    const root = this.root(section);
    const path = this.resolve(root, relative);
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1) throw teamFileError(403, "Only regular team files can be read.");
      if (stat.size > maxBytes) throw teamFileError(413, `This file exceeds the ${maxBytes}-byte reading limit.`);
      const data = await file.readFile();
      const fresh = lstatSync(this.resolve(root, relative));
      if (fresh.dev !== stat.dev || fresh.ino !== stat.ino || data.length > maxBytes) throw teamFileError(409, "The file changed while it was being read. Try again.");
      return { path: relative, bytes: data.length, sha256: hash(data), data, name: basename(path) };
    } finally { await file.close(); }
  }

  private usage(root: string): { bytes: number; count: number } {
    let bytes = 0, count = 0;
    const visit = (folder: string) => {
      for (const name of readdirSync(folder)) {
        if (name.startsWith(".maus-upload-")) continue;
        const path = join(folder, name), stat = lstatSync(path);
        if (stat.isSymbolicLink()) continue;
        count += 1;
        if (count > TEAM_FILES_MAX_ENTRIES) throw teamFileError(413, "This team has reached its file and folder limit.");
        if (stat.isDirectory()) visit(path); else if (stat.isFile()) bytes += stat.size;
      }
    };
    visit(root);
    return { bytes, count };
  }

  async write(section: string, relative: string, chunks: AsyncIterable<Uint8Array>, options: {
    expectedSha256?: string; unique?: boolean; valid?: () => void;
  } = {}): Promise<TeamFileReceipt> {
    teamFilePath(relative);
    const root = this.root(section);
    return this.serial(root, async () => {
      let target = relative;
      this.resolve(root, target, true);
      const temp = join(dirname(this.resolve(root, target, true)), `.maus-upload-${randomUUID()}`);
      const file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      let bytes = 0;
      const digest = createHash("sha256");
      try {
        for await (const chunk of chunks) {
          bytes += chunk.byteLength;
          if (bytes > TEAM_FILE_MAX_BYTES) throw teamFileError(413, `Each team file is limited to ${TEAM_FILE_MAX_BYTES} bytes.`);
          digest.update(chunk);
          let offset = 0;
          while (offset < chunk.byteLength) offset += (await file.write(chunk, offset)).bytesWritten;
        }
        await file.sync();
        await file.close();
        options.valid?.();
        const sha256 = digest.digest("hex");
        if (options.unique) {
          const extension = extname(relative), stem = relative.slice(0, relative.length - extension.length);
          for (let n = 2; existsSync(this.resolve(root, target, true)); n += 1) {
            const existing = await this.read(section, target);
            if (existing.sha256 === sha256) return { path: target, bytes, sha256 };
            target = `${stem} (${n})${extension}`;
          }
        }
        const destination = this.resolve(root, target, true);
        const existing = existsSync(destination) ? await this.read(section, target) : undefined;
        if ((existing && options.expectedSha256 !== existing.sha256) || (!existing && options.expectedSha256)) {
          throw teamFileError(409, "This file already exists or changed. Read its current SHA-256 before replacing it, or choose another name.");
        }
        const usage = this.usage(root);
        if (!existing && usage.count >= TEAM_FILES_MAX_ENTRIES) throw teamFileError(413, "This team has reached its file and folder limit.");
        if (usage.bytes + bytes - (existing?.bytes ?? 0) > TEAM_FILES_MAX_BYTES) throw teamFileError(413, "This team has reached its storage limit.");
        options.valid?.();
        this.resolve(root, target, true);
        if (existing) renameSync(temp, destination);
        else { linkSync(temp, destination); unlinkSync(temp); }
        return { path: target, bytes, sha256 };
      } finally {
        await file.close().catch(() => undefined);
        try { unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("team files: temporary upload cleanup failed"); }
      }
    });
  }

  async rename(section: string, relative: string, name: string): Promise<string> {
    teamFilePath(relative); teamFilePath(name);
    if (name.includes("/")) throw teamFileError(400, "Choose a name, not another folder path.");
    if ([TEAM_REFERENCES_FOLDER, TEAM_OUTPUTS_FOLDER].includes(relative)) throw teamFileError(400, "The default team folders cannot be renamed.");
    const root = this.root(section);
    return this.serial(root, async () => {
      const target = posix.join(posix.dirname(relative), name);
      const source = this.resolve(root, relative), destination = this.resolve(root, target, true);
      if (existsSync(destination)) throw teamFileError(409, "An item with that name already exists.");
      renameSync(source, destination);
      return target;
    });
  }

  async trash(section: string, relative: string): Promise<TeamFileTrashEntry> {
    teamFilePath(relative);
    if ([TEAM_REFERENCES_FOLDER, TEAM_OUTPUTS_FOLDER].includes(relative)) throw teamFileError(400, "The default team folders cannot be removed.");
    const root = this.root(section);
    return this.serial(root, async () => {
      const source = this.resolve(root, relative);
      const entry = { id: randomUUID(), path: relative, removedAt: Date.now() };
      const trash = join(root, ".maus", "trash");
      if (!existsSync(trash)) mkdirSync(trash, { mode: 0o700 });
      realDirectory(trash);
      const container = join(trash, entry.id);
      mkdirSync(container, { mode: 0o700 });
      writeFileAtomic(join(container, "entry.json"), JSON.stringify(entry), { mode: 0o600 });
      renameSync(source, join(container, "data"));
      return entry;
    });
  }

  trashEntries(section: string): TeamFileTrashEntry[] {
    const folder = join(this.root(section), ".maus", "trash");
    if (!existsSync(folder)) return [];
    realDirectory(folder);
    return readdirSync(folder).filter(id => /^[0-9a-f-]{36}$/.test(id)).slice(0, 1_000).flatMap(id => {
      try {
        realDirectory(join(folder, id));
        const path = join(folder, id, "entry.json"), stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4_096 || !existsSync(join(folder, id, "data"))) return [];
        const entry = JSON.parse(readFileSync(path, "utf8")) as TeamFileTrashEntry;
        return entry.id === id && typeof entry.removedAt === "number" && teamFilePath(entry.path) ? [entry] : [];
      } catch { return []; }
    }).sort((a, b) => b.removedAt - a.removedAt);
  }

  async restore(section: string, id: string): Promise<string> {
    const root = this.root(section);
    return this.serial(root, async () => {
      const entry = this.trashEntries(section).find(entry => entry.id === id);
      if (!entry) throw teamFileError(404, "This item is not in the team's trash.");
      const parent = posix.dirname(entry.path);
      if (parent !== ".") this.mkdir(section, parent);
      const target = this.resolve(root, entry.path, true);
      if (existsSync(target)) throw teamFileError(409, "An item with that name already exists. Rename it before restoring this copy.");
      const source = join(root, ".maus", "trash", id, "data");
      const stat = lstatSync(source);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw teamFileError(403, "Only regular files and folders can be restored.");
      renameSync(source, target);
      return entry.path;
    });
  }
}

export async function* teamFileBytes(data: Buffer): AsyncIterable<Uint8Array> { yield data; }
