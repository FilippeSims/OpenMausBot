import { t as uiText } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { Loader2, PackageOpen, RefreshCw, Sparkles, X } from "lucide-react";
import { useUpdaterState } from "@/lib/updater";
import { brand } from "../lib/brand";

const primaryAction =
  "flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent py-1.5 text-[13px] font-medium text-white transition-colors disabled:cursor-default disabled:bg-control disabled:text-ink-secondary";

// electron-updater surfaces failures as a whole HTTP dump (status line, every header, stack trace).
function friendlyError(message?: string): string {
  if (!message) return uiText("ui.UpdateBanner.0c953ab32c");
  if (/cannot find .*\.yml|404/i.test(message))
    return uiText("ui.UpdateBanner.d756fe605d");
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::/i.test(message))
    return uiText("ui.UpdateBanner.74b104febe");
  return message.split("\n")[0].slice(0, 140);
}

type UpdateBannerProps = {
  sidebarIndicator?: boolean;
};

export function UpdateBanner({ sidebarIndicator = false }: UpdateBannerProps) {
  const s = useUpdaterState();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [pending, setPending] = useState<"install" | "check" | null>(null);
  const status = s?.status;
  useEffect(() => setPending(null), [status]);

  if (!s || s.status === "idle" || s.status === "checking" || s.status === "downloading" || s.status === "preparing") return null;
  if (sidebarIndicator && (s.status === "downloaded" || s.status === "installing")) return null;
  const key = `${s.status}:${s.version ?? ""}`;
  if (dismissed === key) return null;
  const updater = window.ogb!.updater!;

  const installing = s.status === "installing";
  // Ubuntu system packages can't be swapped under a running app: the command is copied and a terminal opens.
  const handoff = s.installMode === "handoff";

  const title =
    s.status === "downloaded"
      ? uiText("ui.UpdateBanner.2b3acef2e9", { value1: String(brand().name), value2: String(s.version) })
      : installing
        ? handoff
          ? "Opening a terminal…"
          : uiText("settings.updates.restarting")
        : s.status === "handed-off"
          ? uiText("ui.UpdateBanner.3149d8dc76")
          : uiText("ui.UpdateBanner.e58282fd73");
  const subtitle =
    s.status === "downloaded"
      ? handoff
        ? uiText("ui.UpdateBanner.4d1652ff91")
        : uiText("ui.UpdateBanner.d287d2c255")
      : installing
        ? handoff
          ? uiText("ui.UpdateBanner.eb1b96371d")
          : s.message || uiText("ui.UpdateBanner.eddb0fc1d0", { value1: String(brand().name) })
        : s.status === "handed-off"
          ? s.terminalOpened
            ? uiText("ui.UpdateBanner.3c510a77a4")
            : uiText("ui.UpdateBanner.6207545468")
          : s.retryable === false
            ? uiText("ui.UpdateBanner.a61176b5ef", { value1: String(friendlyError(s.message?.split(" Quit and reopen ")[0])), value2: String(brand().name) })
            : friendlyError(s.message);

  return (
    <div className="animate-panel-in fixed bottom-4 left-4 z-50 w-[300px] rounded-xl border border-hairline/40 bg-panel p-3.5 shadow-2xl shadow-black/50">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Sparkles size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-ink">{title}</div>
          <div className="mt-0.5 text-[12.5px] text-ink-secondary" title={subtitle}>
            {subtitle}
          </div>
        </div>
        {!installing && (
          <button
            onClick={() => setDismissed(key)}
            className="shrink-0 rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink"
            title={uiText("chat.error.dismiss")}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {s.status === "handed-off" && s.command && (
        <code className="mt-2.5 block overflow-x-auto rounded-lg bg-control px-2 py-1.5 font-mono text-[11.5px] whitespace-pre text-ink-secondary">
          {s.command}
        </code>
      )}

      {installing && (
        <div className="mt-2.5 flex gap-2">
          <button
            disabled
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-control py-1.5 text-[13px] font-medium text-ink-secondary"
          >
            <Loader2 size={13} className="animate-spin" /> {handoff ? uiText("settings.updates.opening") : uiText("settings.updates.restartingShort")}
          </button>
        </div>
      )}

      {!installing && (
        <div className="mt-2.5 flex gap-2">
          {s.status === "downloaded" && (
            <button
              onClick={() => {
                setPending("install");
                void updater.install();
              }}
              disabled={pending !== null}
              className={primaryAction}
            >
              {pending === "install" ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> {handoff ? uiText("settings.updates.opening") : uiText("settings.updates.restartingShort")}
                </>
              ) : handoff ? (
                <>
                  <PackageOpen size={13} />{uiText("settings.updates.install")}</>
              ) : (
                <>
                  <RefreshCw size={13} />{uiText("update.card.restart")}</>
              )}
            </button>
          )}
          {s.status === "error" && s.retryable !== false && (
            <button
              onClick={() => {
                setPending("check");
                void updater.check();
              }}
              disabled={pending !== null}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-control py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:text-ink-secondary disabled:hover:bg-control"
            >
              {pending === "check" ? (
                <>
                  <Loader2 size={13} className="animate-spin" />{uiText("common.checking")}</>
              ) : (
                uiText("cloudAdd.tryAgain")
              )}
            </button>
          )}
          <button
            onClick={() => setDismissed(key)}
            disabled={pending !== null}
            className="rounded-lg px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50 disabled:hover:bg-transparent"
          >
            {s.status === "handed-off" || s.retryable === false ? uiText("chat.error.dismiss") : uiText("update.card.later")}
          </button>
        </div>
      )}
    </div>
  );
}
