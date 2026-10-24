import { useEffect, useRef, useState } from "react";
import type { NotificaStatus } from "../../../shared/notifica";
import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { Switch } from "../SettingsPrimitives";
import { useBotEditor } from "./BotEditorContext";
import { inputCls } from "./field";

const buttonCls = "rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50";

export function NotificaSettings({ botId }: { botId: string }) {
  const { draft, request } = useBotEditor();
  const owner = useOwnerOrAdmin();
  if (owner !== true) return null;
  if (draft) return <p className="text-[13px] text-ink-secondary">{t("notifica.saveBotFirst")}</p>;
  return <NotificaEditor key={botId} botId={botId} request={request} />;
}

function NotificaEditor({ botId, request }: { botId: string; request: ReturnType<typeof useBotEditor>["request"] }) {
  const [status, setStatus] = useState<NotificaStatus | null>(null);
  const [key, setKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [replacePendingKey, setReplacePendingKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);
  const endpoint = `/api/bots/${encodeURIComponent(botId)}/notifica`;
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void request<NotificaStatus>(endpoint, { signal: controller.signal }).then(value => {
      if (alive.current) { setStatus(value); setEnabled(value.enabled); }
    }, () => { if (alive.current && !controller.signal.aborted) setError(true); });
    return () => { alive.current = false; controller.abort(); };
  }, [endpoint, request]);
  const act = async (action: "save" | "refresh" | "retry") => {
    setBusy(true); setError(false); setSaved(false);
    try {
      const value = await request<NotificaStatus>(endpoint + (action === "retry" ? "/retry" : ""), action === "refresh" ? undefined : {
        method: action === "save" ? "PUT" : "POST",
        ...(action === "save" ? { body: JSON.stringify({ enabled, ...(key.trim() ? { key: key.trim(), replacePendingKey } : {}) }) } : {}),
      });
      if (!alive.current) return;
      setStatus(value);
      if (action === "save") { setKey(""); setReplacePendingKey(false); setSaved(true); }
    } catch { if (alive.current) setError(true); }
    finally { if (alive.current) setBusy(false); }
  };
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-card p-4" aria-label="Notifica">
      <div className="flex items-center justify-between gap-4">
        <div><h3 className="text-[15px] font-medium text-ink">Notifica</h3><p className="mt-1 text-[13px] text-ink-secondary">{t("notifica.help")}</p></div>
        <Switch checked={enabled} disabled={busy || !status} aria-label={t("notifica.enable")} onClick={() => { setEnabled(value => !value); setSaved(false); }} />
      </div>
      <p className="text-[13px] leading-relaxed text-ink-secondary">{t("notifica.setup")}</p>
      <label className="text-[13px] text-ink-secondary">{t("notifica.key")}
        <input type="password" autoComplete="new-password" spellCheck={false} value={key} disabled={busy || !status}
          placeholder={status?.configured ? t("notifica.keyConfigured") : t("notifica.keyPlaceholder")} className={inputCls + " mt-1"}
          onChange={event => { setKey(event.target.value); setSaved(false); }} />
      </label>
      {status?.pending.length && key.trim() ? <label className="flex gap-2 text-[13px] text-ink-secondary">
        <input type="checkbox" checked={replacePendingKey} disabled={busy} onChange={event => setReplacePendingKey(event.target.checked)} />
        {t("notifica.replacePendingKey")}
      </label> : null}
      <p className="text-[12px] text-ink-secondary">{t("notifica.private")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonCls} disabled={busy || !status || (!status.configured && !key.trim())} onClick={() => void act("save")}>{t("notifica.save")}</button>
        <button type="button" className={buttonCls} disabled={busy} onClick={() => void act("refresh")}>{t("notifica.refresh")}</button>
        {!!status?.pending.some(item => item.error) && <button type="button" className={buttonCls} disabled={busy || !status.enabled} onClick={() => void act("retry")}>{t("notifica.retry")}</button>}
      </div>
      <div role="status" className="text-[13px] text-ink-secondary">
        {saved && <p className="text-ink">{t("notifica.saved")}</p>}
        {status && <p>{t(status.enabled ? "notifica.enabled" : "notifica.disabled")} · {t("notifica.pendingCount", { count: status.pending.length })}</p>}
        {status?.authFailed && <p className="mt-1 text-ink">{t("notifica.authFailed")}</p>}
        {status?.retryAt && <p className="mt-1">{t("notifica.rateLimited", { when: new Date(status.retryAt).toLocaleTimeString() })}</p>}
        {error && <p role="alert" className="mt-1 text-ink">{t("notifica.error")}</p>}
      </div>
      {Boolean(status?.pending.length) && <ul className="flex flex-col gap-2 text-[13px]">
        {status!.pending.map(item => <li key={item.conversationKey + item.eventId} className="rounded-lg bg-inset p-3">
          <div className="font-medium text-ink">{item.title}</div>
          <div className="text-ink-secondary">{t(item.status === "aguardando_usuario" ? "notifica.waiting" : item.status === "recebido" ? "notifica.received" : item.status === "erro" ? "notifica.deliveryError" : "notifica.queued")}</div>
          {item.error === "origin_missing" && <p className="mt-1 text-ink-secondary">{t("notifica.originMissing")}</p>}
        </li>)}
      </ul>}
    </section>
  );
}
