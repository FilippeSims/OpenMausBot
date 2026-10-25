// @vitest-environment happy-dom
import { createElement, Fragment } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeFilePreview, openFilePreview } from "@/lib/file-preview";
import { FileMarkdown, FilePreviewPanel } from "./FilePreviewPanel";
import { AttachedFileChip } from "./AttachmentPreview";
import { ChatMarkdown } from "./ChatMarkdown";

const message = { threadId: "thread / 1", messageId: "reply / 2" };
const file = { path: "file:///workspace/report%20%231.md", name: "report #1.md", private: true };
let root: Root;
let container: HTMLDivElement;
const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.getAttribute("aria-label") === name || item.textContent === name)!;
const open = (name: string, mime: string, body: string) => {
  vi.mocked(fetch).mockResolvedValue(new Response(body, { headers: { "content-type": mime } }));
  flushSync(() => openFilePreview({ path: `/workspace/${name}`, name, message }));
};

beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  flushSync(() => root.render(createElement(FilePreviewPanel)));
});
afterEach(() => {
  flushSync(() => { closeFilePreview(); root.unmount(); });
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("file preview panel", () => {
  it("opens a filename in place, preserving the exact message authority, without downloading", async () => {
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.mocked(fetch).mockImplementation(async () => new Response("# Reviewed\n\nSafe **Markdown**.", { headers: { "content-type": "text/markdown" } }));
    flushSync(() => root.render(createElement(Fragment, null,
      createElement(AttachedFileChip, { file, message }), createElement(FilePreviewPanel))));
    expect(fetch).not.toHaveBeenCalled();
    flushSync(() => button("Preview file: report #1.md").click());
    await vi.waitFor(() => expect(container.querySelector("h1")?.textContent).toBe("Reviewed"));
    expect(fetch).toHaveBeenCalledWith("/api/threads/thread%20%2F%201/messages/reply%20%2F%202/file", expect.objectContaining({
      method: "POST", body: JSON.stringify({ path: file.path, listFolder: true }),
    }));
    expect(download).not.toHaveBeenCalled();
    container.querySelector<HTMLButtonElement>('aside button[aria-label="Save a copy of report #1.md"]')!.click();
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("opens a Markdown link with the same scope and keeps saving separate", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("read me", { headers: { "content-type": "text/plain" } }));
    flushSync(() => root.render(createElement(Fragment, null,
      createElement(ChatMarkdown, { text: `[Read report](${file.path})`, message }), createElement(FilePreviewPanel))));
    flushSync(() => button("Read report").click());
    await vi.waitFor(() => expect(container.querySelector("aside .file-preview-markdown p")?.textContent).toBe("read me"));
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: JSON.stringify({ path: file.path, listFolder: true }) }));
    expect(container.querySelector('a[href^="file:"]')).toBeNull();
    expect(container.querySelector('button[title="Save a copy"]')).not.toBeNull();
  });

  it("renders Markdown without active HTML, nested file grants or automatic remote images", () => {
    const html = renderToStaticMarkup(createElement(FileMarkdown, { text: '# Title\n\n<script>alert(1)</script>\n\n![tracking](https://example.test/pixel)\n\n[secret](/private/key) [bad](javascript:alert) [docs](https://example.test)' }));
    expect(html).toContain("<h1>Title</h1>");
    expect(html).not.toMatch(/<script|<img|src=|href="\/private|javascript:/);
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it("uses a no-script sandbox for HTML", async () => {
    open("report.html", "text/html", "<h1>Title</h1><script>alert(1)</script>");
    await vi.waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
    expect(frame.hasAttribute("src")).toBe(false);
  });

  it("loads video only on request, without autoplay, and releases its object URL", async () => {
    expect(fetch).not.toHaveBeenCalled();
    open("demo.mp4", "video/mp4", "video");
    await vi.waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    const video = container.querySelector("video")!;
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.hasAttribute("autoplay")).toBe(false);
    expect(video.getAttribute("preload")).toBe("metadata");
    flushSync(() => button("Close file preview").click());
    expect(container.querySelector("aside")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("preserves download for unsupported files and shows authorization failures", async () => {
    open("archive.zip", "application/zip", "zip");
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("not available for this format"));
    expect(button("Save a copy of archive.zip")).toBeDefined();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "outside", code: "outside_workspace" }), { status: 403 }));
    flushSync(() => openFilePreview({ ...file, message }));
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("outside this chat's working folder"));
  });

  it("aborts an old request when another file opens and rejects late results", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    flushSync(() => openFilePreview({ ...file, message }));
    const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
    open("latest.txt", "text/plain", "Latest file");
    expect(signal.aborted).toBe(true);
    finish(new Response("# Old content", { headers: { "content-type": "text/markdown" } }));
    await vi.waitFor(() => expect(container.querySelector("aside pre")?.textContent).toBe("Latest file"));
    expect(container.textContent).not.toContain("Old content");
  });

  it("keeps folder entry authorization instead of joining its path", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("entry", { headers: { "content-type": "text/plain" } }));
    flushSync(() => openFilePreview({ path: "/workspace/folder", name: "notes.txt", entry: "notes.txt", message }));
    await vi.waitFor(() => expect(container.querySelector("pre")?.textContent).toBe("entry"));
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: JSON.stringify({ path: "/workspace/folder", entry: "notes.txt" }) }));
  });

  it("makes the mobile background inert, wraps keyboard focus, and restores the trigger", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    flushSync(() => root.render(createElement(Fragment, null,
      createElement("main", null, createElement("button", null, "Open report")), createElement(FilePreviewPanel))));
    const trigger = button("Open report");
    trigger.focus();
    open("notes.txt", "text/plain", "Mobile notes");
    await vi.waitFor(() => expect(container.querySelector("main")!.inert).toBe(true));
    expect(container.querySelector("aside")?.getAttribute("aria-modal")).toBe("true");
    const close = button("Close file preview");
    close.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(button("Save a copy of notes.txt"));
    flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(container.querySelector("main")!.inert).toBe(false);
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
