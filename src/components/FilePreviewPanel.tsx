import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ChevronLeft, ChevronRight, Download, FileText, LoaderCircle, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { closeFilePreview, useFilePreview, type FilePreviewSource, type MessageFilePreview } from "@/lib/file-preview";
import { filePreviewKind, readPreviewBlob, TEXT_PREVIEW_MAX_BYTES, type FilePreviewKind } from "@/lib/file-preview-data";
import { useMediaQuery } from "@/lib/use-media-query";
import { tableDelimiter } from "@/lib/table-data";
import { canonicalDownloadFilename, MessageFolderFiles, OutsideWorkspaceFile, requestMessageFile, saveFailureText, useLocalFileSave, type MessageFolderListing } from "./AttachmentPreview";
import { HtmlPreviewFrame } from "./HtmlFilePreview";
import { TableFileContent } from "./TableFilePreview";

const PdfFilePreview = lazy(() => import("./PdfFilePreview"));
const FOCUSABLE = 'button:not([disabled]), a[href], video, audio, [tabindex="0"]';

export function FilePreviewPanel() {
  const preview = useFilePreview();
  const mobile = useMediaQuery("(max-width: 1023px)");
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!preview || !mobile) return;
    const siblings = [...(panel.current?.parentElement?.children ?? [])]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== panel.current);
    const previous = siblings.map(element => element.inert);
    siblings.forEach(element => { element.inert = true; });
    return () => { siblings.forEach((element, index) => { element.inert = previous[index]!; }); };
  }, [Boolean(preview), mobile]);
  useEffect(() => {
    if (!preview) return;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeFilePreview(); }
      else if (mobile && event.key === "Tab") {
        const controls = [...panel.current!.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [preview?.id, mobile]);
  if (!preview) return null;
  const name = "image" in preview.source ? preview.source.image.name : preview.source.name;
  return <aside ref={panel} tabIndex={-1} role="dialog" aria-modal={mobile || undefined}
    aria-label={t("filePreview.open", { name })} data-testid="file-preview-panel"
    className="fixed inset-0 z-[60] flex min-h-0 min-w-0 flex-col overflow-hidden bg-panel text-ink shadow-2xl outline-none lg:relative lg:inset-auto lg:z-20 lg:w-[clamp(360px,46vw,760px)] lg:shrink-0 lg:border-s lg:border-hairline/50">
    <FilePreviewContent key={preview.id} source={preview.source} />
  </aside>;
}

function FilePreviewContent({ source }: { source: FilePreviewSource }) {
  const imageSource = "image" in source ? source : null;
  const file = "path" in source ? source : null;
  const images = imageSource?.images?.length ? imageSource.images : imageSource ? [imageSource.image] : [];
  const [index, setIndex] = useState(() => Math.max(0, images.findIndex(image => image.src === imageSource?.image.src)));
  const image = images[index];
  const name = file?.name ?? image!.name;
  const save = useLocalFileSave(file?.path ?? "", name, file?.message, file?.entry);
  return <>
    <header className="flex shrink-0 items-center gap-3 border-b border-hairline/50 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <FileText size={18} className="shrink-0 text-accent" aria-hidden="true" />
      <div className="min-w-0 flex-1"><h2 title={name} className="truncate text-sm font-medium">{name}</h2><p className="text-xs text-ink-secondary">{t("filePreview.title")}</p></div>
      {file ? <button type="button" disabled={save.state === "saving"} onClick={() => void save.save()}
        aria-label={t("attach.saveAria", { name })} title={t("attach.download")}
        className="ui-icon-button shrink-0 hover:bg-raised disabled:opacity-50">
        {save.state === "saving" ? <LoaderCircle size={17} className="animate-spin" /> : save.state === "saved" ? <Check size={17} className="text-success" /> : <Download size={17} />}
      </button> : image?.downloadUrl && <a href={image.downloadUrl} download={image.downloadName ?? canonicalDownloadFilename({ fallback: name, source: image.downloadUrl })}
        aria-label={t("attach.saveAria", { name })} className="ui-icon-button shrink-0 hover:bg-raised"><Download size={17} /></a>}
      <button type="button" className="ui-icon-button shrink-0 hover:bg-raised" aria-label={t("filePreview.close")} onClick={closeFilePreview}><X size={19} /></button>
    </header>
    {save.state !== "idle" && <p role={save.state === "failed" ? "alert" : "status"} className="border-b border-hairline/40 px-4 py-2 text-xs text-ink-secondary">
      {save.state === "failed" ? saveFailureText(save) : t(save.state === "saved" ? "attach.downloaded" : "attach.downloading")}
    </p>}
    {file ? <MessageFileContent file={file} /> : image && <>
      <ImageContent key={image.src} src={image.src} name={name} />
      {images.length > 1 && <div className="flex shrink-0 items-center justify-center gap-3 border-t border-hairline/40 p-3 text-xs text-ink-secondary">
        <button type="button" className="ui-icon-button" aria-label={t("attach.previous")} onClick={() => setIndex((index + images.length - 1) % images.length)}><ChevronLeft size={18} /></button>
        <span>{t("attach.position", { index: index + 1, count: images.length })}</span>
        <button type="button" className="ui-icon-button" aria-label={t("attach.next")} onClick={() => setIndex((index + 1) % images.length)}><ChevronRight size={18} /></button>
      </div>}
    </>}
  </>;
}

function MessageFileContent({ file }: { file: MessageFilePreview }) {
  const delimiter = tableDelimiter(file.name) ?? tableDelimiter(file.path);
  if (delimiter) return <div className="min-h-0 flex-1 overflow-auto"><TableFileContent {...file} delimiter={delimiter} /></div>;
  return <LoadedFileContent file={file} />;
}

type LoadedFile = { kind: FilePreviewKind; blob: Blob; url: string; text: string } | { kind: "folder"; listing: MessageFolderListing };
function LoadedFileContent({ file }: { file: MessageFilePreview }) {
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [error, setError] = useState<{ reason: string; outsideWorkspace: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setLoaded(null); setError(null);
    void (async () => {
      const response = await requestMessageFile(file.path, file.message, controller.signal, file.entry === undefined ? { list: true } : { entry: file.entry });
      if (response.headers.get("x-openmausbot-folder") === "1") {
        const listing = await response.json() as MessageFolderListing;
        controller.signal.throwIfAborted();
        setLoaded({ kind: "folder", listing }); return;
      }
      const kind = filePreviewKind(file.name, response.headers.get("content-type") ?? "");
      if (kind === "unsupported") { await response.body?.cancel(); throw new Error("unsupported"); }
      const textKind = ["markdown", "text", "html"].includes(kind);
      const blob = await readPreviewBlob(response, controller.signal, textKind ? TEXT_PREVIEW_MAX_BYTES : undefined);
      const text = textKind ? new TextDecoder("utf-8", { fatal: true }).decode(await blob.arrayBuffer()) : "";
      controller.signal.throwIfAborted();
      objectUrl = textKind || kind === "pdf" ? "" : URL.createObjectURL(blob);
      setLoaded({ kind, blob, url: objectUrl, text });
    })().catch((cause: unknown) => {
      if (!controller.signal.aborted) setError({
        reason: cause instanceof Error && cause.message === "size" ? t("filePreview.tooLarge")
          : cause instanceof Error && cause.message === "unsupported" ? t("filePreview.unsupported") : t("filePreview.failed"),
        outsideWorkspace: (cause as { code?: string })?.code === "outside_workspace",
      });
    });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file, attempt]);
  if (error) return <div className="flex flex-col items-start gap-4 overflow-auto p-6 text-sm text-ink-secondary">
    <p role="alert">{saveFailureText(error)}</p>
    {error.outsideWorkspace && <OutsideWorkspaceFile filePath={file.path} />}
    <button type="button" className="ui-button" onClick={() => setAttempt(attempt + 1)}>{t("chat.retry")}</button>
  </div>;
  if (!loaded) return <div role="status" className="flex items-center justify-center gap-2 p-10 text-sm text-ink-secondary"><LoaderCircle size={18} className="animate-spin" />{t("filePreview.loading")}</div>;
  if (loaded.kind === "folder") return <div className="overflow-auto p-4"><MessageFolderFiles folderPath={file.path} message={file.message} listing={loaded.listing} /></div>;
  if (loaded.kind === "image") return <ImageContent src={loaded.url} name={file.name} />;
  if (loaded.kind === "pdf") return <Suspense fallback={<div role="status" className="p-8 text-sm">{t("filePreview.loading")}</div>}><PdfFilePreview blob={loaded.blob} name={file.name} /></Suspense>;
  if (loaded.kind === "video" || loaded.kind === "audio") return <MediaContent kind={loaded.kind} src={loaded.url} name={file.name} />;
  if (loaded.kind === "html") return <div className="min-h-0 flex-1 overflow-auto"><HtmlPreviewFrame source={loaded.text} name={file.name} /></div>;
  if (loaded.kind === "markdown") return <FileMarkdown text={loaded.text} />;
  return <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-xs leading-relaxed">{loaded.text}</pre>;
}

export function FileMarkdown({ text }: { text: string }) {
  // Security: references inside a file are not message grants; neither local links nor remote images load here.
  return <div className="file-preview-markdown min-h-0 flex-1 overflow-auto break-words p-5 text-sm leading-7">
    <Markdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={url => /^(https?:|mailto:)/i.test(url) ? defaultUrlTransform(url) : ""}
      components={{ img: ({ alt }) => <span className="text-ink-secondary">[{alt || t("attach.image")}]</span>,
        a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent underline">{children}</a> : <span>{children}</span> }}>{text}</Markdown>
  </div>;
}

function ImageContent({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-inset p-4">
    {failed ? <p role="alert" className="text-sm text-ink-secondary">{t("filePreview.failed")}</p> : <img src={src} alt={name} onError={() => setFailed(true)} className="max-h-full max-w-full rounded object-contain" />}
  </div>;
}

function MediaContent({ kind, src, name }: { kind: "video" | "audio"; src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto bg-inset p-4">
    {failed ? <p role="alert" className="text-sm text-ink-secondary">{t(kind === "video" ? "attach.videoUnavailable" : "attach.audioUnavailable")}</p>
      : kind === "video" ? <video src={src} controls playsInline preload="metadata" aria-label={name} onError={() => setFailed(true)} className="max-h-full w-full" />
        : <audio src={src} controls preload="metadata" aria-label={name} onError={() => setFailed(true)} className="w-full" />}
  </div>;
}
