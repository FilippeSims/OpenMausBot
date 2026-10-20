import { t as uiText } from "@/lib/i18n";
import type { CloudBackend } from "../../shared/wire";
import { cn } from "@/lib/cn";
import { useStore } from "@/state/store";

export function CloudBackendPicker({
  value,
  compact = false,
  onChange,
}: {
  value: CloudBackend;
  compact?: boolean;
  onChange: (backend: CloudBackend) => void;
}) {
  const { state } = useStore();
  if (state.config?.cloudHome) return null;
  return (
    <div className="mt-3 rounded-lg bg-inset p-3">
      <div className="text-[12px] font-medium text-ink">{compact ? uiText("ui.CloudBackendPicker.a09b04bc25") : uiText("ui.CloudBackendPicker.c74be696f8")}</div>
      <div className="mt-0.5 text-[11.5px] text-ink-secondary">
        {compact
          ? value === "vps" ? uiText("ui.CloudBackendPicker.a61ead221c") : uiText("ui.CloudBackendPicker.d714c47261")
          : value === "vps"
          ? uiText("ui.CloudBackendPicker.45b5900b67")
          : uiText("ui.CloudBackendPicker.7bea157de6")}
      </div>
      <div className="mt-2 flex overflow-hidden rounded-lg border border-hairline/40">
        {(["box", "vps"] as const).map((backend, i) => (
          <button
            key={backend}
            onClick={() => onChange(backend)}
            className={cn(
              "flex-1 py-1.5 text-[12px]",
              i > 0 && "border-l border-hairline/40",
              value === backend ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
            )}
          >
            {backend === "vps" ? uiText("keys.vps.label") : uiText("ui.CloudBackendPicker.90406b7d67")}
          </button>
        ))}
      </div>
    </div>
  );
}
