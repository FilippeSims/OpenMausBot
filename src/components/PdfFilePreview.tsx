import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, Minus, Plus } from "lucide-react";
import { AnnotationMode, GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { t } from "@/lib/i18n";

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfFilePreview({ blob, name }: { blob: Blob; name: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof getDocument> | undefined;
    void blob.arrayBuffer().then(async (data) => {
      if (!active) return;
      // Security: render only PDF drawing operations, never annotations, embedded actions, forms or scripting.
      task = getDocument({ data, enableXfa: false, useWasm: false,
        useSystemFonts: true, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 64_000_000 });
      const document = await task.promise;
      if (active) setPdf(document);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; void task?.destroy(); };
  }, [blob]);
  if (error) return <p role="alert" className="p-6 text-sm text-ink-secondary">{t("filePreview.pdfFailed")}</p>;
  if (!pdf) return <div role="status" className="flex justify-center p-10"><LoaderCircle className="animate-spin text-ink-secondary" size={20} /></div>;
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-hairline/40 px-3 py-2 text-xs text-ink-secondary">
      <div className="flex items-center gap-1">
        <button className="ui-icon-button" aria-label={t("filePreview.previousPage")} disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button>
        <span aria-live="polite">{t("filePreview.page", { page, count: pdf.numPages })}</span>
        <button className="ui-icon-button" aria-label={t("filePreview.nextPage")} disabled={page >= pdf.numPages} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button>
      </div>
      <div className="flex items-center gap-1">
        <button className="ui-icon-button" aria-label={t("filePreview.zoomOut")} disabled={zoom <= 0.5} onClick={() => setZoom(zoom - 0.25)}><Minus size={15} /></button>
        <button className="rounded px-2 py-1 hover:bg-raised" onClick={() => setZoom(1)}>{t("filePreview.fit")}</button>
        <button className="ui-icon-button" aria-label={t("filePreview.zoomIn")} disabled={zoom >= 3} onClick={() => setZoom(zoom + 0.25)}><Plus size={15} /></button>
      </div>
    </div>
    <PdfPage key={`${page}:${zoom}`} pdf={pdf} page={page} zoom={zoom} name={name} />
  </div>;
}

function PdfPage({ pdf, page, zoom, name }: { pdf: PDFDocumentProxy; page: number; zoom: number; name: string }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  useEffect(() => {
    const element = wrapper.current!;
    const resize = () => setWidth(Math.max(160, element.clientWidth - 32));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!width) return;
    let active = true;
    let render: RenderTask | undefined;
    setLoading(true); setError(false);
    void (async () => {
      const documentPage = await pdf.getPage(page);
      if (!active) return;
      const base = documentPage.getViewport({ scale: 1 });
      const scale = Math.min(width / base.width * zoom, Math.sqrt(4_000_000 / (base.width * base.height)));
      const viewport = documentPage.getViewport({ scale });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (viewport.width * viewport.height)));
      const element = canvas.current!;
      element.width = Math.ceil(viewport.width * outputScale);
      element.height = Math.ceil(viewport.height * outputScale);
      element.style.width = `${viewport.width}px`;
      element.style.height = `${viewport.height}px`;
      render = documentPage.render({ canvas: element, viewport, transform: [outputScale, 0, 0, outputScale, 0, 0], annotationMode: AnnotationMode.DISABLE });
      await render.promise;
      const content = await documentPage.getTextContent();
      if (active) { setText(content.items.flatMap(item => "str" in item ? [item.str] : []).join(" ")); setLoading(false); }
    })().catch(() => { if (active) { setError(true); setLoading(false); } });
    return () => { active = false; render?.cancel(); };
  }, [pdf, page, zoom, width]);
  return <div ref={wrapper} className="relative min-h-0 flex-1 overflow-auto bg-inset p-4">
    {loading && <div role="status" className="absolute left-1/2 top-8"><LoaderCircle size={20} className="animate-spin text-ink-secondary" /></div>}
    {error && <p role="alert" className="text-sm text-ink-secondary">{t("filePreview.pdfFailed")}</p>}
    <canvas ref={canvas} role="img" aria-label={`${name} · ${t("filePreview.page", { page, count: pdf.numPages })}`} className="mx-auto bg-white shadow-lg" />
    <p className="sr-only">{text}</p>
  </div>;
}
