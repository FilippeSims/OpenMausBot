import { FILE_MAX_BYTES } from "./composer-attachments";

export const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
export type FilePreviewKind = "markdown" | "text" | "html" | "image" | "pdf" | "video" | "audio" | "unsupported";

/** Security: content types select inert renderers; filenames alone cannot promote arbitrary bytes to media. */
export function filePreviewKind(name: string, mime: string): FilePreviewKind {
  const type = mime.split(";", 1)[0]!.trim().toLowerCase();
  if (["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/svg+xml", "image/bmp"].includes(type)) return "image";
  if (type === "application/pdf") return "pdf";
  if (["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"].includes(type)) return "video";
  if (["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/wave", "audio/ogg", "audio/opus", "audio/flac", "audio/x-flac"].includes(type)) return "audio";
  if (type === "text/html" || (type === "application/octet-stream" && /\.html?$/i.test(name))) return "html";
  if (type.startsWith("text/") || ["application/json", "application/xml", "application/javascript"].includes(type)
    || (type === "application/octet-stream" && /\.(?:md|markdown|txt|json|jsonc|ya?ml|toml|xml|css|js|jsx|ts|tsx|py|sh|sql|log)$/i.test(name))) {
    return /\.(?:md|markdown)$/i.test(name) || type === "text/markdown" ? "markdown" : "text";
  }
  return "unsupported";
}

export async function readPreviewBlob(response: Response, signal: AbortSignal, maxBytes = FILE_MAX_BYTES): Promise<Blob> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error("size");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("size");
      chunks.push(new Uint8Array(value));
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return new Blob(chunks, { type: response.headers.get("content-type") ?? "application/octet-stream" });
}
