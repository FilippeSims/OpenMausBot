import { describe, expect, it } from "vitest";
import { filePreviewKind, readPreviewBlob } from "./file-preview-data";

describe("inert file previews", () => {
  it("requires the server's media type and accepts Markdown as text", () => {
    expect(filePreviewKind("report.pdf", "application/pdf")).toBe("pdf");
    expect(filePreviewKind("report.pdf", "text/html")).toBe("html");
    expect(filePreviewKind("video.mp4", "application/octet-stream")).toBe("unsupported");
    expect(filePreviewKind("readme.MD", "text/plain; charset=utf-8")).toBe("markdown");
    expect(filePreviewKind("page.html", "application/octet-stream")).toBe("html");
    expect(filePreviewKind("code.ts", "application/octet-stream")).toBe("text");
    expect(filePreviewKind("photo.svg", "image/svg+xml")).toBe("image");
  });

  it("limits both declared sizes and streamed bytes", async () => {
    const signal = new AbortController().signal;
    await expect(readPreviewBlob(new Response("small", { headers: { "content-length": "12" } }), signal, 10)).rejects.toThrow("size");
    await expect(readPreviewBlob(new Response(new Uint8Array(11)), signal, 10)).rejects.toThrow("size");
    const blob = await readPreviewBlob(new Response("hello", { headers: { "content-type": "text/plain" } }), signal, 10);
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("hello");
  });

  it("cancels a pending stream when the preview is closed", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const reading = readPreviewBlob(new Response(stream), controller.signal);
    controller.abort();
    await expect(reading).rejects.toThrow();
    expect(cancelled).toBe(true);
  });
});
