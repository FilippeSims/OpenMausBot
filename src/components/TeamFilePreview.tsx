import { useEffect, useState } from "react";
import { Download, FileText, Loader2, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { downloadTeamFile, teamFileBlob, teamFilesProblem } from "@/lib/team-files";
import type { TeamFileEntry } from "../../shared/team-files";

export function TeamFilePreview({ section, file, onClose }: { section: string; file: TeamFileEntry; onClose: () => void }) {
  const [preview, setPreview] = useState<{ image?: string; text?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const image = /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
  const text = /\.(txt|md|json|csv|tsv|css|html?|xml|ya?ml|js|ts)$/i.test(file.name) && file.bytes <= 256_000;
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl: string | undefined;
    setPreview(null); setError(null);
    if (!image && !text) { setPreview({}); return; }
    void teamFileBlob(section, file.path, abort.signal).then(async blob => {
      if (abort.signal.aborted) return;
      if (image) {
        objectUrl = URL.createObjectURL(/\.svg$/i.test(file.name) ? new Blob([blob], { type: "image/svg+xml" }) : blob);
        setPreview({ image: objectUrl });
      } else {
        const value = await blob.text();
        if (!abort.signal.aborted) setPreview({ text: value });
      }
    }).catch(cause => { if (!abort.signal.aborted) setError(teamFilesProblem(cause)); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [section, file.path, image, text]);
  return <section aria-label={t("teamFiles.preview")} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-hairline bg-inset">
    <header className="flex items-center gap-2 border-b border-hairline px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{file.name}</span>
      <button type="button" title={t("teamFiles.download")} aria-label={t("teamFiles.download")} className="rounded-lg p-2 hover:bg-raised" onClick={() => void downloadTeamFile(section, file.path).catch(cause => setError(teamFilesProblem(cause)))}><Download size={16} /></button>
      <button type="button" title={t("teamFiles.closePreview")} aria-label={t("teamFiles.closePreview")} className="rounded-lg p-2 hover:bg-raised" onClick={onClose}><X size={16} /></button>
    </header>
    <div className="min-h-0 flex-1 overflow-auto p-4">
      {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : !preview ? <Loader2 className="mx-auto animate-spin text-ink-secondary" size={22} aria-label={t("teamFiles.loading")} />
        : preview.image ? <div className="flex min-h-[220px] items-center justify-center rounded-lg bg-white/90 p-4"><img src={preview.image} alt={file.name} className="max-h-[460px] max-w-full object-contain" /></div>
          : preview.text !== undefined ? <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed">{preview.text}</pre>
            : <p className="flex items-center gap-2 text-[13px] text-ink-secondary"><FileText size={18} />{t("teamFiles.downloadPreview")}</p>}
    </div>
  </section>;
}
