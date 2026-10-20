import { t as uiText } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { Card } from "./SettingsPrimitives";
import { useStore } from "@/state/store";
import { sharedComputersEnabled } from "@/lib/feature-flags";
import { LendingActivityList } from "./LendingActivity";

/** Security: grants are edited locally and confirmed by a native dialog, never by the hosted page. */
export function ComputerSharingSettings({ workspace, onClose }: { workspace: { id: string; name: string; origin: string }; onClose: () => void }) {
  const { state: appState } = useStore();
  const offered = sharedComputersEnabled(appState.config);
  const bridge = offered ? window.ogb?.computerSharing : undefined;
  const [state, setState] = useState<DesktopComputerSharing | null>(null);
  const [folders, setFolders] = useState<DesktopSharedFolder[]>([]);
  const [terminal, setTerminal] = useState(false);
  const [computer, setComputer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<DesktopLendingActivity[] | null>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const apply = (next: DesktopComputerSharing) => {
    setState(next); setFolders(next.folders); setTerminal(next.terminal); setComputer(next.computer);
  };
  useEffect(() => {
    mounted.current = true;
    panel.current?.scrollIntoView({ block: "start" });
    void bridge?.state(workspace.id).then(next => { if (mounted.current) apply(next); })
      .catch(() => { if (mounted.current) setError(uiText("ui.ComputerSharingSettings.3157c3da00")); });
    const refresh = () => {
      void bridge?.state(workspace.id).then(next => { if (mounted.current) setState(next); }).catch(() => {});
      void bridge?.activity?.(workspace.id).then(next => { if (mounted.current) setActivity(next); }).catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [bridge, workspace.id]);
  const perform = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (failure) { if (mounted.current) setError(String((failure as Error)?.message ?? failure).replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, "")); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  if (!bridge) return null;
  return <div ref={panel}><Card title={uiText("ui.ComputerSharingSettings.2bf0bb49b9", { value1: String(workspace.name) })} subtitle={workspace.origin}>
    <div className="flex flex-col gap-4 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <p role="status" className="text-ink-secondary">{!state ? uiText("ui.ComputerSharingSettings.a55b4d69fc") : !state.enabled ? uiText("computer.files.notShared") : state.connected ? uiText("ui.ComputerSharingSettings.c57371cf39") : uiText("ui.ComputerSharingSettings.e9a0f5a0c4")}</p>
        <button type="button" aria-label={uiText("ui.ComputerSharingSettings.a2f4e04165")} onClick={onClose} className="rounded p-1 text-ink-secondary hover:bg-control"><X size={16} /></button>
      </div>
      <p className="text-ink-secondary">{uiText("ui.ComputerSharingSettings.845066bbf8")}</p>
      <fieldset disabled={busy || !state} className="flex flex-col gap-3 disabled:opacity-50">
        <legend className="mb-2 font-medium text-ink">{uiText("ui.ComputerSharingSettings.083a92bbb2")}</legend>
        {folders.length === 0 && <p className="text-[12px] text-ink-secondary">{uiText("ui.ComputerSharingSettings.c8f17f307a")}</p>}
        {folders.map(folder => <div key={folder.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline/40 p-3">
          <div className="min-w-0 flex-1"><p className="font-medium text-ink">{folder.name}</p><p className="break-all text-[12px] text-ink-secondary">{folder.path}</p></div>
          <label className="flex items-center gap-2 text-[12px] text-ink-secondary"><input type="checkbox" checked={folder.write} onChange={event => setFolders(current => current.map(entry => entry.id === folder.id ? { ...entry, write: event.target.checked } : entry))} />{uiText("ui.ComputerSharingSettings.a8fa19f863")}</label>
          <button type="button" aria-label={uiText("ui.ComputerSharingSettings.0ab4d0cee3", { value1: String(folder.name) })} onClick={() => setFolders(current => current.filter(entry => entry.id !== folder.id))} className="rounded p-1 text-ink-secondary hover:bg-control"><X size={14} /></button>
        </div>)}
        <button type="button" disabled={folders.length >= 20} onClick={() => void perform(async () => {
          const folder = await bridge.chooseFolder();
          if (mounted.current && folder) setFolders(current => current.some(entry => entry.path === folder.path) ? current : [...current, folder]);
        })} className="flex w-fit items-center gap-2 rounded-lg border border-hairline/40 px-3 py-2 text-ink hover:bg-control"><FolderPlus size={14} />{uiText("ui.ComputerSharingSettings.3db741003e")}</button>
        <p className="text-[12px] text-ink-secondary">{uiText("ui.ComputerSharingSettings.3e79e516a5")}</p>
      </fieldset>
      <fieldset disabled={busy || !state} className="flex flex-col gap-3 border-t border-hairline/40 pt-3 disabled:opacity-50">
        <legend className="font-medium text-ink">{uiText("ui.ComputerSharingSettings.1a9f0371e4")}</legend>
        <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={terminal} onChange={event => setTerminal(event.target.checked)} /><span className="text-ink">{uiText("ui.ComputerSharingSettings.0f282abaab")}<span className="mt-1 block text-[12px] text-ink-secondary">{uiText("ui.ComputerSharingSettings.e12f39eaad")}</span></span></label>
        <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={computer} onChange={event => setComputer(event.target.checked)} /><span className="text-ink">{uiText("ui.ComputerSharingSettings.e07e323577")}<span className="mt-1 block text-[12px] text-ink-secondary">{uiText("ui.ComputerSharingSettings.6998cdc8f4")}</span></span></label>
      </fieldset>
      {(error || state?.error) && <p role="alert" className="text-[12px] text-danger">{error || state?.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !state || (!folders.length && !terminal && !computer)} onClick={() => void perform(async () => {
          const next = await bridge.save(workspace.id, { folders, terminal, computer });
          if (mounted.current && next) apply(next);
        })} className="rounded-lg bg-accent px-3 py-2 font-medium text-accent-ink disabled:opacity-50">{state?.enabled ? uiText("ui.ComputerSharingSettings.0f586dd30b") : uiText("ui.ComputerSharingSettings.6b1b6eeb1b")}</button>
        {state?.enabled && <button type="button" disabled={busy} onClick={() => void perform(async () => {
          const next = await bridge.revoke(workspace.id); if (mounted.current) apply(next);
        })} className="rounded-lg border border-hairline/40 px-3 py-2 text-danger disabled:opacity-50">{uiText("files.stop")}</button>}
      </div>
      {state?.enabled && <p className="text-[12px] text-ink-secondary">{uiText("ui.ComputerSharingSettings.5baabaec0b")}</p>}
      <div className="border-t border-hairline/40 pt-3"><LendingActivityList entries={activity} /></div>
    </div>
  </Card></div>;
}
