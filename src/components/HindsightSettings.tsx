import { t as uiText } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { Card, SettingRow, Switch } from "./SettingsPrimitives";
import { Select } from "./Select";

type Draft = { mode: "embedded" | "external"; enabled: boolean; url: string; recallTimeoutMs: string; retainTimeoutMs: string; maxTokens: string };
type Verdict = { ok: true; latencyMs: number } | { ok: false; reason: "http" | "malformed" | "unreachable"; status?: number };
const draftFrom = (config?: ConfigStatus | null): Draft => {
  const h = config?.memory?.hindsight;
  return { mode: h?.mode ?? "external", enabled: h?.enabled ?? false, url: h?.url ?? "http://127.0.0.1:8888",
    recallTimeoutMs: String(h?.recallTimeoutMs ?? 2000), retainTimeoutMs: String(h?.retainTimeoutMs ?? 30000), maxTokens: String(h?.maxTokens ?? 1024) };
};
const limits: Array<{ field: "recallTimeoutMs" | "retainTimeoutMs" | "maxTokens"; min: number; max: number; label: LocaleKey }> = [
  { field: "recallTimeoutMs", min: 100, max: 10000, label: "hindsight.recallTimeout" },
  { field: "retainTimeoutMs", min: 1000, max: 120000, label: "hindsight.retainTimeout" },
  { field: "maxTokens", min: 128, max: 4096, label: "hindsight.maxTokens" },
];

export function HindsightSettings() {
  const { state, dispatch } = useStore();
  const saved = state.config?.memory?.hindsight;
  const [draft, setDraft] = useState(() => draftFrom(state.config));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "refresh" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const confirmed = JSON.stringify(draftFrom(state.config));
  useEffect(() => { if (!dirty) setDraft(JSON.parse(confirmed) as Draft); }, [confirmed, dirty]);
  const available = Boolean(saved) && saved?.available !== false && state.config?.cloudHome !== true;
  const edit = <Key extends keyof Draft>(key: Key, value: Draft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true); setError(""); setNotice("");
  };
  const candidate = () => {
    if (draft.mode === "embedded") return { mode: "embedded" as const, enabled: draft.enabled };
    let url: URL;
    try { url = new URL(draft.url.trim()); } catch { throw new Error(t("hindsight.invalidUrl")); }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && local))) throw new Error(t("hindsight.invalidUrl"));
    if (!local && !saved?.keyConfigured) throw new Error(t("hindsight.remoteKey"));
    return { mode: "external" as const, enabled: draft.enabled, url: draft.url.trim() };
  };
  const run = async (action: "save" | "test" | "refresh") => {
    if (inFlight.current || !available) return;
    inFlight.current = true; setBusy(action); setError(""); setNotice("");
    try {
      if (action === "save") {
        const next = { ...candidate(), recallTimeoutMs: Number(draft.recallTimeoutMs), retainTimeoutMs: Number(draft.retainTimeoutMs), maxTokens: Number(draft.maxTokens) };
        for (const limit of limits) {
          const value = next[limit.field];
          if (!Number.isInteger(value) || value < limit.min || value > limit.max) {
            throw new Error(t("hindsight.range", { field: t(limit.label), min: String(limit.min), max: String(limit.max) }));
          }
        }
        const config = await api<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify({ memory: { hindsight: next } }) });
        dispatch({ type: "configStatus", config });
        setDraft(draftFrom(config)); setDirty(false);
        setNotice(t("hindsight.saved"));
      } else if (action === "test") {
        const next = candidate();
        if (next.mode === "embedded" && (saved?.mode !== "embedded" || !saved.enabled)) {
          throw new Error(t("hindsight.embeddedSaveFirst"));
        }
        const result = await api<Verdict>("/api/memory/hindsight/test", { method: "POST", body: JSON.stringify(next.mode === "embedded" ? { mode: "embedded" } : { url: next.url }) });
        if (!result.ok) throw new Error(result.reason === "http" ? t("hindsight.httpError", { status: String(result.status) }) :
          result.reason === "malformed" ? t("hindsight.malformed") : t("hindsight.unreachable"));
        setNotice(t("hindsight.connected", { ms: String(result.latencyMs) }));
      } else {
        dispatch({ type: "configStatus", config: await api<ConfigStatus>("/api/config") });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("hindsight.failed")); }
    finally { inFlight.current = false; setBusy(null); }
  };
  const disabled = !available || busy !== null;
  const status = !saved?.enabled ? t("hindsight.disabled") : saved.runtimeState === "starting" && saved.mode === "embedded" ? t("hindsight.starting") : saved.error ? t("hindsight.indexError") : saved.pending ? t("hindsight.indexing") : t("hindsight.enabled");
  return <Card title={uiText("ui.HindsightSettings.311f044bde")} subtitle={t("hindsight.subtitle")}>
    {!available && <p role="status" className="mb-4 text-[13px] text-ink-secondary">{state.config?.cloudHome || saved?.available === false ? t("hindsight.cloudUnavailable") : t("hindsight.unavailable")}</p>}
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      {saved?.embeddedAvailable && <div>
        <label htmlFor="hindsight-mode" className="mb-1 block text-[13px] font-medium text-ink">{t("hindsight.mode")}</label>
        <Select id="hindsight-mode" value={draft.mode} onChange={e => edit("mode", e.target.value as Draft["mode"])}
          className="w-full">
          <option value="embedded">{t("hindsight.embedded")}</option>
          <option value="external">{t("hindsight.external")}</option>
        </Select>
      </div>}
      <SettingRow title={t("hindsight.enable")} subtitle={t("hindsight.enableHelp")}>
        <Switch checked={draft.enabled} disabled={disabled} aria-label={t("hindsight.enable")} onClick={() => edit("enabled", !draft.enabled)} />
      </SettingRow>
      {draft.mode === "embedded" ? <p className="text-[12px] leading-relaxed text-ink-secondary">{t("hindsight.embeddedHelp")}</p> : <div>
        <label htmlFor="hindsight-url" className="mb-1 block text-[13px] font-medium text-ink">{t("hindsight.url")}</label>
        <input id="hindsight-url" type="url" value={draft.url} onChange={(e) => edit("url", e.target.value)} aria-describedby="hindsight-url-help"
          className="w-full min-w-0 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink focus:border-focus focus:outline-none disabled:opacity-50" />
        <p id="hindsight-url-help" className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("hindsight.urlHelp")}</p>
      </div>}
      <details>
        <summary className="cursor-pointer text-[13px] font-medium text-ink">{t("hindsight.limits")}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {limits.map((limit) => <div key={limit.field}>
            <label htmlFor={`hindsight-${limit.field}`} className="mb-1 block text-[12px] text-ink-secondary">{t(limit.label)}</label>
            <input id={`hindsight-${limit.field}`} type="number" min={limit.min} max={limit.max} step={1} value={draft[limit.field]}
              onChange={(e) => edit(limit.field, e.target.value)} className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink focus:border-focus focus:outline-none" />
          </div>)}
        </div>
        <p className="mt-2 text-[12px] text-ink-secondary">{t("hindsight.limitsHelp")}</p>
      </details>
    </fieldset>
    <div className="mt-5 flex flex-wrap gap-2">
      <button type="button" disabled={disabled || !dirty} onClick={() => void run("save")} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40">{busy === "save" ? t("hindsight.saving") : t("common.save")}</button>
      <button type="button" disabled={disabled} onClick={() => void run("test")} className="rounded-lg border border-hairline/40 px-3 py-2 text-[13px] text-ink disabled:opacity-40">{busy === "test" ? t("hindsight.testing") : t("hindsight.test")}</button>
      <button type="button" disabled={disabled} onClick={() => void run("refresh")} className="rounded-lg border border-hairline/40 px-3 py-2 text-[13px] text-ink disabled:opacity-40">{t("hindsight.refresh")}</button>
    </div>
    <div role="status" aria-live="polite" className="mt-4 space-y-1 text-[12px] text-ink-secondary">
      <p>{t("hindsight.status", { status, count: String(saved?.indexedDocuments ?? 0) })}</p>
      {saved?.enabled && saved.error && <p className="text-danger">{saved.error}</p>}
      {notice && <p className="text-success">{notice}</p>}
    </div>
    {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
  </Card>;
}
