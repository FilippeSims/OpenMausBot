import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronRight, Download, FileText, Folder, FolderOpen, FolderPlus, Loader2, Pencil, RefreshCw, RotateCcw, Search, Trash2, Upload, X } from "lucide-react";
import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { downloadTeamFile, OPEN_TEAM_FILES, teamFilesProblem, teamFileUrl } from "@/lib/team-files";
import { TEAM_FILE_MAX_BYTES, TEAM_OUTPUTS_FOLDER, TEAM_REFERENCES_FOLDER, type TeamFileEntry, type TeamFilesListing, type TeamFileTrashEntry } from "../../shared/team-files";
import { cn } from "@/lib/cn";
import { TeamFilePreview } from "./TeamFilePreview";

type Listing = TeamFilesListing & { pendingDeliveries: number; deliveryProblem: boolean };
const actionClass = "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12px] text-ink-secondary hover:bg-raised disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent";
const bytesLabel = (bytes: number) => bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : bytes >= 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${bytes} B`;

export function TeamFilesHost() {
  const { state } = useStore();
  const [section, setSection] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const value = (event as CustomEvent<{ section?: unknown }>).detail?.section;
      if (typeof value === "string" && value.length <= 60) setSection(value);
    };
    window.addEventListener(OPEN_TEAM_FILES, open);
    return () => window.removeEventListener(OPEN_TEAM_FILES, open);
  }, []);
  useEffect(() => { if (section && state.connected && !state.sections?.includes(section)) setSection(null); }, [section, state.connected, state.sections]);
  return section !== null ? <TeamFilesDialog key={section} section={section} onClose={() => setSection(null)} /> : null;
}

export function TeamFilesDialog({ section, onClose }: { section: string; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const aborts = useRef(new Set<AbortController>());
  const [folder, setFolder] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [listing, setListing] = useState<Listing | null>(null);
  const [trash, setTrash] = useState<TeamFileTrashEntry[] | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TeamFileEntry | null>(null);
  const [editing, setEditing] = useState<{ entry?: TeamFileEntry; name: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const queryParams = new URLSearchParams({ section, path: folder, query, offset: String(offset) });
  const listUrl = `/api/team-files?${queryParams}`;
  useModalDialog(dialog, onClose);
  useEffect(() => () => { generation.current += 1; for (const abort of aborts.current) abort.abort(); }, []);
  const load = useCallback(async () => {
    const epoch = ++generation.current;
    try {
      if (trashOpen) {
        const value = await api<{ entries: TeamFileTrashEntry[] }>(`/api/team-files/trash?${new URLSearchParams({ section })}`);
        if (epoch === generation.current) { setTrash(value.entries); setError(null); }
      } else {
        const value = await api<Listing>(listUrl);
        if (epoch === generation.current) { setListing(value); setError(null); }
      }
    } catch (cause) { if (epoch === generation.current) setError(teamFilesProblem(cause)); }
  }, [section, listUrl, trashOpen]);
  useEffect(() => {
    setListing(null); setTrash(null); setPreview(null);
    const timer = setTimeout(() => { void load(); }, query ? 200 : 0);
    return () => { clearTimeout(timer); generation.current += 1; };
  }, [load, query]);
  useEffect(() => {
    const timer = setInterval(() => { if (!pending.current && !document.hidden) void load(); }, 5_000);
    return () => clearInterval(timer);
  }, [load]);
  const run = async (label: string, work: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true; setBusy(label); setError(null);
    const epoch = generation.current;
    try { await work(); if (generation.current === epoch) { setEditing(null); await load(); } }
    catch (cause) { if (generation.current === epoch) setError(teamFilesProblem(cause)); }
    finally { pending.current = false; setBusy(null); }
  };
  const command = (body: unknown) => api(teamFileUrl(section), { method: "POST", body: JSON.stringify(body) });
  const openFolder = (path: string) => { setFolder(path); setQuery(""); setOffset(0); setEditing(null); setPreview(null); };
  const sendFiles = (files: FileList | File[]) => {
    if (trashOpen) return;
    void run(t("teamFiles.uploading"), async () => {
      for (const file of Array.from(files)) {
        if (file.size > TEAM_FILE_MAX_BYTES) throw Object.assign(new Error("large file"), { status: 413 });
        const abort = new AbortController(); aborts.current.add(abort);
        try {
          await api(teamFileUrl(section, folder ? `${folder}/${file.name}` : file.name, true) + "&unique=1", {
            method: "PUT", body: file, headers: { "content-type": "application/octet-stream" }, signal: abort.signal,
          });
        } finally { aborts.current.delete(abort); }
      }
    });
  };
  const protectedEntry = (entry: TeamFileEntry) => [TEAM_OUTPUTS_FOLDER, TEAM_REFERENCES_FOLDER].includes(entry.path);
  const label = section || t("navigation.general");
  return createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 backdrop-blur-[2px] sm:p-6"
    onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t("teamFiles.title", { name: label })} tabIndex={-1}
      data-team-files-dialog aria-busy={Boolean(busy)} className="flex h-[min(780px,calc(100dvh-1rem))] w-full max-w-[1024px] flex-col overflow-hidden rounded-2xl border border-hairline bg-panel text-ink shadow-2xl outline-none sm:h-[min(780px,calc(100dvh-3rem))]">
      <header className="flex items-start gap-3 border-b border-hairline px-4 py-4 sm:px-6">
        <FolderOpen size={23} className="mt-1 shrink-0 text-accent" />
        <div className="min-w-0 flex-1"><h2 className="truncate text-[18px] font-semibold">{t("teamFiles.title", { name: label })}</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("teamFiles.description")}</p></div>
        <button type="button" aria-label={t("common.close")} className={actionClass} onClick={onClose}><X size={19} /></button>
      </header>
      <div className="flex flex-wrap items-center gap-1 border-b border-hairline px-3 py-2 sm:px-5">
        <button type="button" disabled={Boolean(busy)} className={cn(actionClass, !trashOpen && "bg-accent/10 text-accent")} aria-pressed={!trashOpen} onClick={() => setTrashOpen(false)}><Folder size={16} />{t("teamFiles.files")}</button>
        <button type="button" disabled={Boolean(busy)} className={cn(actionClass, trashOpen && "bg-accent/10 text-accent")} aria-pressed={trashOpen} onClick={() => setTrashOpen(true)}><Trash2 size={15} />{t("teamFiles.trash")}</button>
        <span className="flex-1" />
        {!trashOpen && <><button type="button" disabled={Boolean(busy)} className={actionClass} onClick={() => { setEditing({ name: "" }); setPreview(null); }}><FolderPlus size={16} />{t("teamFiles.newFolder")}</button>
          <button type="button" disabled={Boolean(busy)} className={cn(actionClass, "bg-accent/10 text-accent")} onClick={() => upload.current?.click()}><Upload size={16} />{t("teamFiles.upload")}</button>
          <input ref={upload} type="file" multiple aria-label={t("teamFiles.upload")} className="hidden" onChange={event => { if (event.target.files) sendFiles(event.target.files); event.target.value = ""; }} /></>}
        <button type="button" aria-label={t("teamFiles.refresh")} title={t("teamFiles.refresh")} disabled={Boolean(busy)} className={actionClass} onClick={() => void load()}><RefreshCw size={15} /></button>
      </div>
      {!trashOpen && <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2 sm:px-6">
        <nav aria-label={t("teamFiles.breadcrumb")} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-[12px]">
          <button type="button" disabled={Boolean(busy)} className="shrink-0 rounded p-1 hover:bg-raised" onClick={() => openFolder("")}>{label}</button>
          {folder.split("/").filter(Boolean).map((part, index, parts) => <span key={index} className="flex shrink-0 items-center"><ChevronRight size={13} className="text-ink-tertiary" /><button type="button" disabled={Boolean(busy)} className="rounded p-1 hover:bg-raised" onClick={() => openFolder(parts.slice(0, index + 1).join("/"))}>{part}</button></span>)}
        </nav>
        <label className="flex w-full items-center gap-2 rounded-lg bg-inset px-2.5 py-2 sm:w-[230px]"><Search size={14} className="text-ink-secondary" /><input aria-label={t("teamFiles.search")} placeholder={t("teamFiles.search")} value={query} disabled={Boolean(busy)} onChange={event => { setQuery(event.target.value); setOffset(0); }} className="min-w-0 flex-1 bg-transparent text-[12px] outline-none touch:text-[16px]" /></label>
      </div>}
      <div role="status" className="px-4 text-[12px] sm:px-6">{busy && <p className="flex items-center gap-2 py-2 text-accent"><Loader2 size={14} className="animate-spin" />{busy}</p>}</div>
      {error && <p role="alert" className="mx-4 mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger sm:mx-6">{error}</p>}
      {!trashOpen && listing?.deliveryProblem && <p role="alert" className="mx-4 mt-3 text-[12px] text-warning">{t("teamFiles.deliveryProblem")}</p>}
      {editing && <form className="mx-4 mt-3 flex gap-2 sm:mx-6" onSubmit={event => { event.preventDefault(); void run(t("teamFiles.saving"), () => command(editing.entry ? { action: "rename", path: editing.entry.path, name: editing.name.trim() } : { action: "mkdir", path: folder ? `${folder}/${editing.name.trim()}` : editing.name.trim() })); }}>
        <input aria-label={t(editing.entry ? "teamFiles.itemName" : "teamFiles.folderName")} autoFocus value={editing.name} disabled={Boolean(busy)} onChange={event => setEditing({ ...editing, name: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-hairline bg-inset px-3 py-2 text-[13px] outline-none focus:border-accent" placeholder={t("teamFiles.folderExample")} />
        <button type="submit" disabled={!editing.name.trim() || Boolean(busy)} className={cn(actionClass, "bg-accent/10 text-accent")}>{t("common.save")}</button>
        <button type="button" disabled={Boolean(busy)} className={actionClass} onClick={() => setEditing(null)}>{t("common.cancel")}</button>
      </form>}
      <div className={cn("relative flex min-h-0 flex-1 gap-3 overflow-hidden p-3 sm:p-5", dragging && "bg-accent/10 ring-2 ring-inset ring-accent")}
        onDragOver={event => { if (!trashOpen && event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={event => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) sendFiles(event.dataTransfer.files); }}>
        <div className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto", preview && "hidden sm:block sm:max-w-[45%]")}>
          {trashOpen ? !trash ? <Loader2 className="mx-auto animate-spin" size={20} aria-label={t("teamFiles.loading")} /> : trash.length === 0 ? <p className="p-5 text-center text-[13px] text-ink-secondary">{t("teamFiles.trashEmpty")}</p> : trash.map(item => <div key={item.id} className="flex items-center gap-3 border-b border-hairline/50 py-3">
            <Trash2 size={18} className="shrink-0 text-ink-tertiary" /><span className="min-w-0 flex-1 truncate text-[13px]" title={item.path}>{item.path}</span>
            <button type="button" disabled={Boolean(busy)} className={actionClass} aria-label={t("teamFiles.restoreItem", { name: item.path })} onClick={() => void run(t("teamFiles.saving"), () => command({ action: "restore", id: item.id }))}><RotateCcw size={15} />{t("teamFiles.restore")}</button>
          </div>) : !listing ? !error && <Loader2 className="mx-auto animate-spin" size={20} aria-label={t("teamFiles.loading")} /> : <>
            {folder && <button type="button" disabled={Boolean(busy)} className={cn(actionClass, "mb-2")} onClick={() => openFolder(folder.split("/").slice(0, -1).join("/"))}><ArrowLeft size={15} />{t("teamFiles.parent")}</button>}
            {listing.entries.length === 0 && <p className="rounded-xl border border-dashed border-hairline p-8 text-center text-[13px] leading-relaxed text-ink-secondary">{t(query ? "teamFiles.noResults" : "teamFiles.empty")}</p>}
            {listing.entries.map(entry => <div key={entry.path} data-team-file={entry.path} className={cn("flex items-center gap-1 rounded-xl border border-transparent px-1 py-1 hover:bg-raised/40", preview?.path === entry.path && "border-accent/30 bg-accent/10")}>
              <button type="button" disabled={Boolean(busy)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-3 text-left focus-visible:outline-2 focus-visible:outline-accent" aria-label={t(entry.kind === "directory" ? "teamFiles.openFolder" : "teamFiles.openFile", { name: entry.name })} onClick={() => entry.kind === "directory" ? openFolder(entry.path) : setPreview(entry)}>
                {entry.kind === "directory" ? <Folder size={23} className="shrink-0 text-accent" /> : <FileText size={22} className="shrink-0 text-ink-secondary" />}
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{entry.name}</span><span className="mt-0.5 block text-[11px] text-ink-secondary">{entry.kind === "directory" ? t(entry.path === TEAM_OUTPUTS_FOLDER ? "teamFiles.outputsHint" : entry.path === TEAM_REFERENCES_FOLDER ? "teamFiles.referencesHint" : "teamFiles.folder") : bytesLabel(entry.bytes)}</span></span>
              </button>
              {entry.kind === "file" && <button type="button" disabled={Boolean(busy)} className={cn(actionClass, "px-2")} title={t("teamFiles.download")} aria-label={t("teamFiles.downloadItem", { name: entry.name })} onClick={() => void run(t("teamFiles.downloading"), () => downloadTeamFile(section, entry.path))}><Download size={15} /></button>}
              {!protectedEntry(entry) && <><button type="button" disabled={Boolean(busy)} className={cn(actionClass, "px-2")} title={t("teamFiles.rename")} aria-label={t("teamFiles.renameItem", { name: entry.name })} onClick={() => { setPreview(null); setEditing({ entry, name: entry.name }); }}><Pencil size={14} /></button>
                <button type="button" disabled={Boolean(busy)} className={cn(actionClass, "px-2 hover:text-danger")} title={t("teamFiles.moveToTrash")} aria-label={t("teamFiles.trashItem", { name: entry.name })} onClick={() => void run(t("teamFiles.saving"), async () => { await command({ action: "trash", path: entry.path }); setPreview(null); })}><Trash2 size={14} /></button></>}
            </div>)}
            {(offset > 0 || offset + 200 < listing.total) && <div className="mt-4 flex items-center justify-between gap-2 text-[12px] text-ink-secondary">
              <button type="button" className={actionClass} disabled={offset === 0 || Boolean(busy)} onClick={() => setOffset(value => Math.max(0, value - 200))}>{t("teamFiles.previous")}</button>
              <span>{offset + 1}–{Math.min(offset + 200, listing.total)} / {listing.total}</span>
              <button type="button" className={actionClass} disabled={offset + 200 >= listing.total || Boolean(busy)} onClick={() => setOffset(value => value + 200)}>{t("teamFiles.next")}</button>
            </div>}
          </>}
        </div>
        {preview && !trashOpen && <TeamFilePreview section={section} file={preview} onClose={() => setPreview(null)} />}
      </div>
      <footer className="flex items-center gap-3 border-t border-hairline px-4 py-3 sm:px-6">
        <span className="min-w-0 flex-1 text-[11px] text-ink-secondary">{t("teamFiles.footer")}{Boolean(listing?.pendingDeliveries) && ` · ${t("teamFiles.collecting")}`}</span>
        {listing && !window.ogb?.remoteClient?.active && window.ogb?.revealInFolder && <button type="button" className={actionClass} onClick={() => void window.ogb?.revealInFolder?.(listing.root).catch(() => setError(t("teamFiles.failed")))}><FolderOpen size={15} /><span className="hidden sm:inline">{t("teamFiles.showFolder")}</span></button>}
      </footer>
    </div>
  </div>, document.body);
}
