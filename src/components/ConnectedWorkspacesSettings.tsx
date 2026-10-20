import { t as uiText } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { Check, Cloud, Laptop, Loader2, Trash2 } from "lucide-react";
import { Card } from "./SettingsPrimitives";
import { ComputerSharingSettings } from "./ComputerSharingSettings";
import { CloudMoveSettings } from "./CloudMove";
import { CloudTile } from "./cloud-buy/parts";
import { cloudColor } from "@/lib/cloud-look";
import { useStore } from "@/state/store";
import { sharedComputersEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";

type SavedWorkspaces = Awaited<ReturnType<NonNullable<NonNullable<Window["ogb"]>["environments"]>["state"]>>;

export function ConnectedWorkspacesSettings() {
  const bridge = window.ogb?.environments;
  // Security: the desktop bridge alone is not enough; never offer access the server refuses.
  const { state } = useStore();
  const sharingOffered = sharedComputersEnabled(state.config) && Boolean(window.ogb?.computerSharing);
  const [saved, setSaved] = useState<SavedWorkspaces | null>(null);
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [computerId, setComputerId] = useState<string | null>(() => new URLSearchParams(window.location?.search ?? "").get("share-computer"));
  const copyOffered = Boolean(window.ogb?.cloudMove) && !window.ogb?.remoteClient?.active;
  const [copyId, setCopyId] = useState<string | null>(() => new URLSearchParams(window.location?.search ?? "").get("copy-to"));
  const [envName, setEnvName] = useState("");
  const [envDir, setEnvDir] = useState("");
  const [envForget, setEnvForget] = useState<string | null>(null);
  const [envPurge, setEnvPurge] = useState(false);
  const [envError, setEnvError] = useState("");
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    void bridge?.state().then((state) => { if (generation.current === current) setSaved(state); })
      .catch(() => { if (generation.current === current) setError(uiText("ui.ConnectedWorkspacesSettings.92412c39b6")); });
    return () => { generation.current++; };
  }, [bridge]);
  useEffect(() => {
    const consume = (id?: string | null, panel?: "copy") => {
      if (id) (panel === "copy" ? setCopyId : setComputerId)(id);
      const url = new URL(window.location.href);
      url.searchParams.delete("share-computer");
      url.searchParams.delete("copy-to");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    };
    consume();
    return bridge?.onOpenSettings?.(consume);
  }, [bridge]);
  const perform = async (action: () => Promise<unknown>, fail: (message: string) => void = setError) => {
    if (pending.current || !bridge) return;
    pending.current = true; setBusy(true); setError(""); setEnvError("");
    const current = generation.current;
    try {
      // Security: a successful switch unloads this renderer; never ask for its privileged saved list again after the
      // origin changes.
      if (await action() === true) return;
      const state = await bridge.state();
      if (generation.current === current) setSaved(state);
    } catch (nextError) {
      if (generation.current === current) fail(String((nextError as Error)?.message ?? nextError)
        .replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, ""));
    } finally {
      pending.current = false;
      if (generation.current === current) setBusy(false);
    }
  };
  if (!bridge) return <p className="text-[13px] text-ink-secondary">{uiText("ui.ConnectedWorkspacesSettings.5cd10df866")}</p>;
  const confirmAction = (message: string) => window.ogb?.confirm ? window.ogb.confirm(message) : window.confirm(message);
  const connected = saved?.environments.find(entry => entry.id === computerId);
  const computerWorkspace = connected?.origin ? { id: connected.id, name: connected.name, origin: connected.origin } : undefined;
  const locals = saved?.environments.filter(entry => entry.kind === "local") ?? [];
  const forgetEntry = locals.find(entry => entry.id === envForget);
  return <>
    <p className="text-[13px] leading-relaxed text-ink-secondary">{uiText("ui.ConnectedWorkspacesSettings.d6b72cf39e")}</p>
    {saved?.packaged && <Card title={uiText("ui.ConnectedWorkspacesSettings.7d6deafeab")} subtitle={uiText("ui.ConnectedWorkspacesSettings.d305260fe3")}>
      {envError && <p role="alert" className="text-[12px] text-danger">{envError}</p>}
      {locals.length > 0 && <ul className="divide-y divide-hairline/40">
        {locals.map((entry) => {
          const active = entry.id === saved.activeId;
          return <li key={entry.id} className="flex items-center gap-3 py-3">
            <Laptop size={18} className="shrink-0 text-ink-secondary" />
            <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-ink">{entry.name}</div>
              <div className="break-all text-[12px] text-ink-secondary">{entry.dataDir}
                {entry.missing && <span className="ml-2 rounded-md bg-inset px-1.5 py-0.5 text-[11px]">{uiText("ui.ConnectedWorkspacesSettings.ffa63583df")}</span>}</div></div>
            {active ? <span className="flex shrink-0 items-center gap-1 text-[12px] text-ink-secondary"><Check size={13} />{uiText("ui.ConnectedWorkspacesSettings.e0d1b68224")}</span> :
              <button type="button" disabled={busy} aria-label={uiText("ui.ConnectedWorkspacesSettings.429aa8abc9", { value1: String(entry.name) })}
                onClick={() => void perform(async () => {
                  if (!await confirmAction(uiText("ui.ConnectedWorkspacesSettings.d486f97d0c", { value1: String(entry.name) }))) return;
                  const result = await bridge.switch(entry.id);
                  if (result && result.ok === false) throw new Error("Couldn't switch.");
                  return true;
                }, setEnvError)}
                className="rounded-md px-2 py-1.5 text-[12px] text-ink hover:bg-control disabled:opacity-50">{uiText("ui.ConnectedWorkspacesSettings.39921a740b")}</button>}
            {!active && <button type="button" disabled={busy} aria-label={uiText("ui.ConnectedWorkspacesSettings.5492466ecf", { value1: String(entry.name) })} title={uiText("ui.ConnectedWorkspacesSettings.5492466ecf", { value1: String(entry.name) })}
              onClick={() => { setEnvForget(entry.id); setEnvPurge(false); }}
              className="rounded-md p-1.5 text-ink-secondary hover:bg-control hover:text-danger disabled:opacity-50"><Trash2 size={14} /></button>}
          </li>;
        })}
      </ul>}
      {forgetEntry && <div className="mt-3 rounded-lg border border-hairline/40 p-3">
        <label className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-secondary">
          <input type="checkbox" checked={envPurge} disabled={busy} className="mt-0.5" onChange={(event) => setEnvPurge(event.target.checked)} />{uiText("ui.ConnectedWorkspacesSettings.2a26cb5b21")}{forgetEntry.dataDir}{uiText("ui.ConnectedWorkspacesSettings.71abb36d54")}</label>
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={() => void perform(async () => {
            const result = envPurge ? await bridge.forget(forgetEntry.id, true) : await bridge.forget(forgetEntry.id);
            if (result && result.ok === false) throw new Error(uiText("ui.ConnectedWorkspacesSettings.363157dc3f"));
            setEnvForget(null);
          }, setEnvError)} className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-danger hover:bg-control disabled:opacity-50">{uiText("ui.ConnectedWorkspacesSettings.a6bd489d95")}</button>
          <button type="button" onClick={() => setEnvForget(null)} className="rounded-lg px-3 py-1.5 text-[12px] text-ink hover:bg-control">{uiText("cloudAdd.cancel")}</button>
        </div>
      </div>}
      <p className="mt-4 text-[13px] font-medium text-ink">{uiText("ui.ConnectedWorkspacesSettings.39fe4fa85d")}</p>
      <form className="flex flex-col gap-3 pt-2" onSubmit={(event) => {
        event.preventDefault();
        if (!envName.trim()) return;
        void perform(async () => {
          const created = await bridge.create(envName.trim(), envDir.trim() || undefined);
          if (!created?.ok) throw new Error(uiText("ui.ConnectedWorkspacesSettings.fcbd64308a"));
          setEnvName(""); setEnvDir("");
        }, setEnvError);
      }}>
        <label className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">{uiText("teamShare.name")} <input required value={envName} disabled={busy} maxLength={60} onChange={(event) => setEnvName(event.target.value)} placeholder={uiText("ui.ConnectedWorkspacesSettings.e283ad9425")}
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50" />
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">{uiText("ui.ConnectedWorkspacesSettings.f2ed221573")} <span className="flex gap-2">
            <input value={envDir} disabled={busy} onChange={(event) => setEnvDir(event.target.value)} placeholder={uiText("ui.ConnectedWorkspacesSettings.3c77998dca")}
              className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50" />
            <button type="button" disabled={busy} onClick={() => void perform(async () => {
              const picked = await bridge.pickDir();
              if (picked?.ok && picked.path) setEnvDir(picked.path);
            }, setEnvError)} className="shrink-0 rounded-lg border border-hairline/40 px-3 text-[12px] text-ink hover:bg-control disabled:opacity-50">{uiText("room.folder.choose")}</button>
          </span>
        </label>
        <button type="submit" disabled={busy || !envName.trim()} className="flex w-fit items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" />}{uiText("ui.ConnectedWorkspacesSettings.4759498ac2")} </button>
      </form>
    </Card>}
    <Card title={uiText("ui.ConnectedWorkspacesSettings.1d5c5de218")} subtitle={uiText("ui.ConnectedWorkspacesSettings.22f10acf81")}>
      {!saved ? <p role="status" className="text-[13px] text-ink-secondary">{error ? uiText("ui.ConnectedWorkspacesSettings.b40fb803ae") : uiText("ui.ConnectedWorkspacesSettings.d6034a7692")}</p> :
        <ul className="divide-y divide-hairline/40">
          {[{ id: "local", name: "This computer", origin: "", color: undefined }, ...saved.environments.filter((entry) => entry.kind !== "local")].map((entry) => {
            const active = entry.id === saved.activeId;
            const Icon = entry.id === "local" ? Laptop : Cloud;
            return <li key={entry.id} className="flex items-center gap-3 py-3">
              {cloudColor(entry.color) ? <CloudTile color={entry.color} size={20} /> : <Icon size={18} className="shrink-0 text-ink-secondary" />}
              <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-ink">{entry.name}</div>
                <div className="break-all text-[12px] text-ink-secondary">{entry.origin || uiText("ui.ConnectedWorkspacesSettings.c38c6013cc")}</div></div>
              {active ? <span className="flex shrink-0 items-center gap-1 text-[12px] text-ink-secondary"><Check size={13} />{uiText("ui.ConnectedWorkspacesSettings.e0d1b68224")}</span> :
                <button type="button" disabled={busy} aria-label={uiText("ui.ConnectedWorkspacesSettings.429aa8abc9", { value1: String(entry.name) })} onClick={() => void perform(async () => { await bridge.switch(entry.id); return true; })}
                  className="rounded-md px-2 py-1.5 text-[12px] text-ink hover:bg-control disabled:opacity-50">{uiText("ui.ConnectedWorkspacesSettings.39921a740b")}</button>}
              {entry.id !== "local" && copyOffered && <button type="button" disabled={busy} aria-label={uiText("ui.ConnectedWorkspacesSettings.efae3eb968", { value1: String(uiText("cloudMove.here")), value2: String(entry.name) })} onClick={() => setCopyId(entry.id)} className="rounded-md px-2 py-1.5 text-[12px] text-ink hover:bg-control">{t("cloudMove.here")}</button>}
              {entry.id !== "local" && sharingOffered && <button type="button" disabled={busy} aria-label={uiText("ui.ConnectedWorkspacesSettings.a522a14d32", { value1: String(entry.name) })} onClick={() => setComputerId(entry.id)} className="rounded-md px-2 py-1.5 text-[12px] text-ink hover:bg-control">{uiText("ui.ConnectedWorkspacesSettings.4eae04ef42")}</button>}
              {entry.id !== "local" && <button type="button" disabled={busy} aria-label={uiText("ui.ConnectedWorkspacesSettings.5492466ecf", { value1: String(entry.name) })} title={uiText("ui.ConnectedWorkspacesSettings.5492466ecf", { value1: String(entry.name) })}
                onClick={() => void perform(() => bridge.forget(entry.id))} className="rounded-md p-1.5 text-ink-secondary hover:bg-control hover:text-danger disabled:opacity-50"><Trash2 size={14} /></button>}
            </li>;
          })}
        </ul>}
    </Card>
    {copyOffered && copyId && saved?.environments.some(entry => entry.id === copyId) && <CloudMoveSettings key={copyId} destination={copyId} onClose={() => setCopyId(null)} />}
    {sharingOffered && computerWorkspace && <ComputerSharingSettings key={computerWorkspace.id} workspace={computerWorkspace} onClose={() => setComputerId(null)} />}
    <Card title={uiText("ui.ConnectedWorkspacesSettings.232ac7de45")} subtitle={uiText("ui.ConnectedWorkspacesSettings.6043a4a30d")}>
      <form className="flex flex-col gap-3" onSubmit={(event) => {
        event.preventDefault();
        if (address.trim()) void perform(() => bridge.addFromLink(address.trim(), name.trim()));
      }}>
        <label className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">{uiText("ui.ConnectedWorkspacesSettings.bba83b4de6")} <input required value={address} disabled={busy} onChange={(event) => setAddress(event.target.value)}
            placeholder="https://bots.yourcompany.com" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50" />
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">{uiText("ui.ConnectedWorkspacesSettings.e09b37bcc4")} <input value={name} disabled={busy} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder={uiText("ui.ConnectedWorkspacesSettings.42ae80318e")}
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50" />
        </label>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{uiText("ui.ConnectedWorkspacesSettings.addb31799d")}</p>
        <details className="text-[12px] text-ink-secondary"><summary className="cursor-pointer">{uiText("ui.ConnectedWorkspacesSettings.33acce46d4")}</summary>
          <p className="mt-2">{uiText("ui.ConnectedWorkspacesSettings.8f16d1a7dc")}</p>
          <code className="mt-1 block select-all break-words rounded-md bg-inset px-2 py-2 text-ink">npx openmausbot pair --label "My desktop"</code>
        </details>
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
        <button type="submit" disabled={busy || !address.trim()} className="flex w-fit items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" />}{uiText("cloudSetup.engine.action")} </button>
      </form>
    </Card>
  </>;
}
