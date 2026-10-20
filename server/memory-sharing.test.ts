import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemorySharing } from "./memory-sharing.ts";
import { botMemoryScope } from "./memory-index.ts";
import { deleteMemoryDoc, readMemoryDoc, writeMemoryDoc } from "./memory-store.ts";
import { ensureWorkspace, workspaceDir } from "./workspace.ts";

let directory: string;
const author = { id: "share-scout", name: "Scout", section: "Marketing" };
const recipient = { id: "share-writer", name: "Writer", section: "Marketing" };
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "omb-memory-share-"));
  ensureWorkspace(author.id);
  ensureWorkspace(recipient.id);
  writeMemoryDoc(author.id, "memory/project.md", "The launch is on Friday.\nKeep the budget under $500.\n");
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  rmSync(workspaceDir(author.id), { recursive: true, force: true });
  rmSync(workspaceDir(recipient.id), { recursive: true, force: true });
});

describe("explicit memory sharing", () => {
  it.each(["en", "pt-br", "es"])("keeps the untouched %s memory template out of semantic recall", language => {
    rmSync(workspaceDir(recipient.id), { recursive: true, force: true });
    ensureWorkspace(recipient.id, language);
    expect(botMemoryScope(recipient.id).documents).toEqual([]);
    writeMemoryDoc(recipient.id, "memory/project.md", "The launch is on Friday.");
    expect(botMemoryScope(recipient.id).documents).toMatchObject([{ id: "memory/project.md", text: "The launch is on Friday." }]);
  });

  it("copies only the selected passage with durable provenance and no automatic synchronization", () => {
    const file = join(directory, "shares.json");
    const sharing = new MemorySharing(file);
    const result = sharing.share(author, recipient, "memory/project.md", "The launch is on Friday.", "source-thread");
    const copy = readMemoryDoc(recipient.id, result.receipt.recipientPath).text;
    expect(copy).toContain("The launch is on Friday.");
    expect(copy).not.toContain("$500");
    expect(copy).toContain("not an instruction");
    const reopened = new MemorySharing(file);
    expect(reopened.metadata(recipient.id, result.receipt.recipientPath)).toMatchObject({ origin: "shared", author_bot_id: author.id, source_thread_id: "source-thread" });
    expect(reopened.metadata(recipient.id, result.receipt.recipientPath).copy_edited).toBe("false");
    expect(reopened.share(author, recipient, "memory/project.md", "The launch is on Friday.", "another-thread").duplicate).toBe(true);
    writeMemoryDoc(author.id, "memory/project.md", "The launch is on Monday.");
    expect(readMemoryDoc(recipient.id, result.receipt.recipientPath).text).toBe(copy);
    expect(readFileSync(file, "utf8")).not.toContain("The launch is on Friday.");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(botMemoryScope(recipient.id, path => reopened.metadata(recipient.id, path)).documents).toEqual(expect.arrayContaining([expect.objectContaining({ metadata: expect.objectContaining({ origin: "shared" }) })]));
    writeMemoryDoc(recipient.id, result.receipt.recipientPath, copy + "\nRecipient correction.\n");
    expect(reopened.metadata(recipient.id, result.receipt.recipientPath).copy_edited).toBe("true");
  });

  it("rejects a different team, audience, hidden recipient, disabled memory and self-sharing", () => {
    const sharing = new MemorySharing(join(directory, "shares.json"));
    for (const target of [
      { ...recipient, section: "Sales" }, { ...recipient, visibility: "admins" },
      { ...recipient, memoryEnabled: false }, { ...recipient, hidden: true }, author,
    ]) expect(() => sharing.share(author, target, "memory/project.md", "The launch is on Friday.", "t1")).toThrow();
  });

  it("rejects invented passages, expired facts, logs and path traversal", () => {
    const sharing = new MemorySharing(join(directory, "shares.json"));
    expect(() => sharing.share(author, recipient, "memory/project.md", "Monday launch", "t1")).toThrow(/exact active passage/);
    writeMemoryDoc(author.id, "memory/project.md", "- 2020-01-01 · The launch is on Friday. · until 2020-01-02\n");
    expect(() => sharing.share(author, recipient, "memory/project.md", "The launch is on Friday.", "t1")).toThrow(/exact active passage/);
    expect(() => sharing.share(author, recipient, "memory/log/2026-10-09.md", "anything", "t1")).toThrow(/log/);
    expect(() => sharing.share(author, recipient, "../../other-bot/MEMORY.md", "anything", "t1")).toThrow(/not a memory file/);
  });

  it("does not resurrect a deleted received copy or persist secrets in its history", () => {
    const sharing = new MemorySharing(join(directory, "shares.json"));
    const result = sharing.share(author, recipient, "memory/project.md", "The launch is on Friday.", "t1");
    deleteMemoryDoc(recipient.id, result.receipt.recipientPath);
    expect(() => sharing.share(author, recipient, "memory/project.md", "The launch is on Friday.", "t1")).toThrow(/deleted/);
  });

  it("fails closed without overwriting unreadable sharing history", () => {
    const file = join(directory, "shares.json");
    writeFileSync(file, "broken");
    const sharing = new MemorySharing(file);
    expect(() => sharing.share(author, recipient, "memory/project.md", "The launch is on Friday.", "t1")).toThrow(/could not be read/);
    expect(readFileSync(file, "utf8")).toBe("broken");
  });
});
