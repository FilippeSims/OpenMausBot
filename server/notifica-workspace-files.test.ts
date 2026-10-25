import { mkdtempSync, mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openWorkspaceOutputFile, workspaceOutput } from "./notifica-workspace-files.ts";
import { openMessageFile } from "./message-file.ts";
import type { Message, Store } from "./store.ts";

describe("Notifica message-scoped file boundary", () => {
  let dir: string, workspace: string, attachments: string, message: Message, store: Store;
  const origin = { botId: "bot-a", threadId: "task-a" };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omb-notifica-files-")); workspace = join(dir, "workspace"); attachments = join(dir, "attachments");
    mkdirSync(workspace); mkdirSync(attachments);
    message = { id: "output", role: "bot", kind: "text", at: Date.now(), text: "" };
    store = { bot: (id: string) => id === origin.botId ? { id } : undefined, botByThread: () => ({ id: origin.botId }),
      taskByThread: (botId: string, threadId: string) => botId === origin.botId && threadId === origin.threadId ? { threadId } : undefined,
      messagesFor: () => [message] } as unknown as Store;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const open = (href: string) => openWorkspaceOutputFile(store, origin, message.id, href, { roots: () => [workspace], attachments });
  it("collects rendered local Markdown, image and video links plus stored attachments while preserving real web links", () => {
    message.text = "[Report](./report.md) ![Picture](image.png) [Video][clip]\n\n[clip]: film.mp4\n\n[Website](https://example.test) `secret.txt` /private/plain.txt";
    message.attachments = [{ kind: "file", path: join(attachments, "saved.pdf"), name: "Review.pdf", mime: "application/pdf" }];
    const output = workspaceOutput(message);
    expect(output.files?.map(file => file.href)).toEqual(["./report.md", "image.png", "film.mp4", join(attachments, "saved.pdf")]);
    expect(output.text).toContain("[Website](https://example.test)");
    expect(output.text).not.toContain("(./report.md)"); expect(output.text).not.toContain("(image.png)"); expect(output.text).not.toContain("[clip]:");
    expect(output.files?.at(-1)?.name).toBe("Review.pdf");
  });
  it("opens only the exact message's references inside the permitted roots and rejects symlink escapes", async () => {
    writeFileSync(join(workspace, "report.md"), "authorized report"); writeFileSync(join(workspace, "secret.txt"), "not linked");
    writeFileSync(join(dir, "outside.txt"), "outside"); symlinkSync(join(dir, "outside.txt"), join(workspace, "escape.txt"));
    message.text = "[Report](report.md) [Outside](escape.txt)";
    const file = await open("report.md"); expect((await file.handle.readFile()).toString()).toBe("authorized report"); await file.handle.close();
    await expect(open("secret.txt")).rejects.toMatchObject({ status: 403 });
    await expect(open("escape.txt")).rejects.toMatchObject({ status: 403 });
    await expect(openWorkspaceOutputFile(store, { ...origin, botId: "bot-b" }, message.id, "report.md")).rejects.toMatchObject({ status: 403 });
    await expect(openWorkspaceOutputFile(store, origin, "another-message", "report.md")).rejects.toMatchObject({ status: 403 });
  });
  it("does not publish broken local preview URLs or corrupt a linked local image", () => {
    message.text = "[![Preview](./picture.png)](./picture.png) [Local app](http://localhost:4321/view)";
    const output = workspaceOutput(message);
    expect(output.text).toBe("Preview Local app (endereço local, disponível no computador de origem)");
    expect(output.files).toEqual([{ href: "./picture.png", name: "picture.png" }]);
  });
  it("opens persisted images and video without requiring text and uses the stored display name", async () => {
    const png = join(attachments, "stored.png"), video = join(attachments, "stored.mp4"); writeFileSync(png, "fixture-png"); writeFileSync(video, "fixture-video");
    message.attachments = [{ kind: "image", path: png, mime: "image/png" }, { kind: "file", path: video, name: "demo.mp4", mime: "video/mp4" }];
    const image = await open(png); expect(image.mime).toBe("image/png"); await image.handle.close();
    const clip = await open(video); expect(clip.name).toBe("demo.mp4"); expect(clip.mime).toBe("video/mp4"); await clip.handle.close();
    expect(workspaceOutput(message).files).toHaveLength(2);
  });
  it("allows up to 50 MiB only for the bridge and preserves the existing download limit", async () => {
    const path = join(workspace, "large.mp4"); writeFileSync(path, ""); truncateSync(path, 26 * 1024 * 1024); message.text = "[Video](large.mp4)";
    await expect(openMessageFile(path, [workspace])).rejects.toMatchObject({ status: 413 });
    const file = await open("large.mp4"); expect(file.bytes).toBe(26 * 1024 * 1024); await file.handle.close();
    truncateSync(path, 50 * 1024 * 1024 + 1); await expect(open("large.mp4")).rejects.toMatchObject({ status: 413 });
  });
});
