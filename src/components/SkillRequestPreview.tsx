import { t as uiText } from "@/lib/i18n";
import { reviewedSkillSha256, type SkillRequestCardData } from "../../shared/skill-request";

/**
 * Security: learned instructions render as inert plain text; the approval hash binds this exact preview to the staged
 * file.
 */
export function SkillRequestPreview({ request }: { request: SkillRequestCardData }) {
  const reviewedSha256 = reviewedSkillSha256(request);
  if (!reviewedSha256) {
    return (
      <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-[12px] leading-relaxed text-danger"> {uiText("ui.SkillRequestPreview.8e34370670")} {request.action === "update" ? uiText("ui.SkillRequestPreview.daba7cd3a8") : uiText("ui.SkillRequestPreview.4a4878b470")}
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-lg border border-hairline/40 bg-inset p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-secondary">
        <span> {uiText("ui.SkillRequestPreview.a00610243c")}{request.references?.length ? uiText("ui.SkillRequestPreview.1b19d9c51f") : ""} {uiText("ui.SkillRequestPreview.6db7d803e7")} {request.action === "update" ? uiText("ui.SkillRequestPreview.3d7bd5f23f") : uiText("ui.SkillRequestPreview.8811208d8e")}
        </span>
        <span className="font-mono" title={uiText("ui.SkillRequestPreview.5d8ae00134", { value1: String(reviewedSha256) })}> {uiText("ui.SkillRequestPreview.5d5b09f6dc")} {reviewedSha256.slice(0, 8)}
        </span>
      </div>
      <div className="mt-1 break-all text-[11px] text-ink-secondary">{uiText("ui.SkillRequestPreview.c707ee4ecc")} {request.source || uiText("ui.SkillRequestPreview.b764cdc0ea")}</div>
      <pre
        tabIndex={0}
        aria-label={uiText("ui.SkillRequestPreview.0685f6f555", { value1: String(request.name) })}
        className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink"
      >
        {request.preview}
      </pre>
      {request.references?.map((file) => (
        <div key={file.path} className="mt-3 border-t border-hairline/40 pt-2">
          <div className="font-mono text-[11px] text-ink-secondary">{file.path}</div>
          <pre
            tabIndex={0}
            aria-label={uiText("ui.SkillRequestPreview.8f9a02de61", { value1: String(file.path), value2: String(request.name) })}
            className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink"
          >
            {file.content}
          </pre>
        </div>
      ))}
    </div>
  );
}
