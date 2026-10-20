import { t as uiText } from "@/lib/i18n";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/cn";

export interface PromptPreviewData {
  sections: Array<{ id: string; label: string; text: string; bytes: number }>;
  totalBytes: number;
  approxTokens: number;
  note: string;
}

export function PromptPreview({
  data,
  error,
  open,
  onToggle,
}: {
  data: PromptPreviewData | null;
  error?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-xl bg-card p-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-[15px] font-medium text-ink">
          {data
            ? uiText("ui.PromptPreview.cda9f6aa70", { value1: String(data.totalBytes.toLocaleString()), value2: String(data.approxTokens.toLocaleString()) })
            : uiText("ui.PromptPreview.eae5513df7")}
        </span>
        <ChevronDown size={16} className={cn("shrink-0 text-ink-secondary transition-transform", open && "rotate-180")} />
      </button>

      {open && !data && error && (
        <div className="mt-3 text-[13px] text-ink-secondary">{uiText("ui.PromptPreview.36fcc8e4c7")}</div>
      )}

      {open && !data && !error && <div className="mt-3 text-[13px] text-ink-secondary">{uiText("skills.library.loading")}</div>}

      {open && data && (
        <div className="mt-3 flex flex-col gap-2">
          {data.sections.map((section) => (
            <details key={section.id} className="rounded-lg border border-hairline/40 bg-inset px-3 py-2">
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-[13px] text-ink">
                <span>{section.label}</span>
                <span className="shrink-0 tabular-nums text-ink-secondary">{section.bytes.toLocaleString()} {uiText("ui.PromptPreview.277089d91c")}</span>
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink">
                {section.text}
              </pre>
            </details>
          ))}
          {data.note && <div className="text-[11px] text-ink-secondary">{data.note}</div>}
        </div>
      )}
    </div>
  );
}
