import { useEffect, useRef, useState } from "react";
import { Building2, Plus, Radio, Trash2 } from "lucide-react";
import type { NotificaWorkspaceStatus } from "../../shared/notifica";
import { api, useStore } from "@/state/store";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { Switch } from "./SettingsPrimitives";

const field = "w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink disabled:opacity-50";
const button = "rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50";
const endpoint = "/api/notifica/workspace";

export function NotificaWorkspaceSettings() {
  const owner = useOwnerOrAdmin();
  return owner === true ? <WorkspaceEditor /> : null;
}

function WorkspaceEditor() {
  const {dispatch} = useStore();
  const [status, setStatus] = useState<NotificaWorkspaceStatus | null>(null);
  const [companies, setCompanies] = useState<NotificaWorkspaceStatus["companies"]>([]);
  const [teamCompanies, setTeamCompanies] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(false), [key, setKey] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void api<NotificaWorkspaceStatus>(endpoint).then(value => {
      if (!alive.current) return;
      setStatus(value); setEnabled(value.enabled); setCompanies(value.companies); setTeamCompanies(value.teamCompanies);
    }).catch(() => { if (alive.current) setError("Não foi possível carregar a conexão. Tente atualizar."); });
    return () => { alive.current = false; };
  }, []);
  const act = async (action: "save" | "refresh" | "retry") => {
    setBusy(true); setError(""); setSaved(false);
    try {
      const value = await api<NotificaWorkspaceStatus>(endpoint + (action === "retry" ? "/retry" : ""), action === "refresh" ? undefined : {
        method: action === "save" ? "PUT" : "POST",
        ...(action === "save" ? { body: JSON.stringify({ enabled, companies, teamCompanies, ...(key.trim() ? { key: key.trim() } : {}) }) } : {}),
      });
      if (!alive.current) return;
      setStatus(value);
      if (action === "save") { setKey(""); setSaved(true); }
      if (!status) { setCompanies(value.companies); setTeamCompanies(value.teamCompanies); setEnabled(value.enabled); }
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "Não foi possível salvar a conexão."); }
    finally { if (alive.current) setBusy(false); }
  };
  const removeCompany = (id: string) => {
    const remaining = companies.filter(company => company.id !== id);
    if (!remaining.length) return;
    setCompanies(remaining); setTeamCompanies(Object.fromEntries(Object.entries(teamCompanies).map(([team, company]) => [team, company === id ? remaining[0].id : company]))); setSaved(false);
  };
  return <section aria-label="Notifica · Empresas e times" className="flex flex-col gap-4 rounded-xl border border-hairline/50 bg-card p-4">
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3"><Radio size={22} className="text-ink-secondary" /><div><h3 className="text-[15px] font-semibold text-ink">Notifica · Empresas e times</h3>
        <p className="mt-1 text-[12px] text-ink-secondary">Converse com seus agentes e aprove ações pelo celular.</p></div></div>
      <Switch checked={enabled} disabled={busy || !status} aria-label="Ativar conexão da empresa com Notifica" onClick={() => { setEnabled(value => !value); setSaved(false); }} />
    </div>
    <p className="text-[13px] leading-relaxed text-ink-secondary">No Notifica, abra Empresas e conecte um workspace OpenMausBot. Cole a chave abaixo. Os times e agentes visíveis deste workspace serão sincronizados. O OpenMausBot precisa continuar aberto para receber mensagens e decisões.</p>
    <label className="text-[13px] text-ink-secondary">Chave privada da conexão
      <input className={field + " mt-1"} type="password" autoComplete="new-password" spellCheck={false} value={key} disabled={busy || !status}
        placeholder={status?.configured ? "Chave salva; preencha somente para trocar" : "Cole a chave de workspace do Notifica"} onChange={event => { setKey(event.target.value); setSaved(false); }} />
    </label>
    <div className="flex flex-col gap-2"><div className="flex items-center justify-between"><h4 className="flex items-center gap-2 text-[13px] font-medium text-ink"><Building2 size={16} />Suas empresas</h4>
      <button className={button + " flex items-center gap-1"} disabled={busy || !status || companies.length >= 30} onClick={() => { setCompanies(items => [...items, { id: crypto.randomUUID(), name: "Nova empresa" }]); setSaved(false); }}><Plus size={14} />Empresa</button></div>
      {companies.map((company, index) => <div key={company.id} className="flex gap-2"><input className={field} aria-label={`Nome da empresa ${index + 1}`} maxLength={120} value={company.name} disabled={busy}
        onChange={event => { setCompanies(items => items.map(item => item.id === company.id ? { ...item, name: event.target.value } : item)); setSaved(false); }} />
        <button className={button} aria-label={`Remover empresa ${company.name}`} disabled={busy || companies.length === 1} onClick={() => removeCompany(company.id)}><Trash2 size={15} /></button></div>)}
    </div>
    {Boolean(status?.teams.length) && <div className="flex flex-col gap-2"><h4 className="text-[13px] font-medium text-ink">Empresa de cada time</h4>
      {status!.teams.map(team => { const section = team.section; return <label key={team.id} className="grid grid-cols-2 items-center gap-3 text-[13px] text-ink-secondary"><span>{team.name}</span>
        <select className={field} disabled={busy} aria-label={`Empresa do time ${team.name}`} value={teamCompanies[section] ?? companies[0]?.id ?? ""}
          onChange={event => { setTeamCompanies(value => ({ ...value, [section]: event.target.value })); setSaved(false); }}>{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>; })}
    </div>}
    {Boolean(status?.conversations?.length) && <div className="flex flex-col gap-2"><h4 className="text-[13px] font-medium text-ink">Conversas sincronizadas</h4><p className="text-[12px] text-ink-secondary">As mensagens do Notifica continuam nestes tópicos. Abra o mesmo tópico para acompanhar e responder pelo computador.</p>{status!.conversations!.map(conversation => <button key={conversation.threadId} className={button + " text-left"} onClick={() => {dispatch({type: "toggleAppSettings", open: false});dispatch({type: "switchTask", botId: conversation.botId, threadId: conversation.threadId});}}>Abrir {conversation.title}</button>)}</div>}
    <p className="text-[12px] leading-relaxed text-ink-secondary">Cada mensagem segue para a conversa do agente escolhido. Aprovações de ferramentas, contatos entre agentes e envios externos exigem uma decisão explícita no Notifica; propostas de configuração continuam na tela do OpenMausBot.</p>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !status || (!status.configured && !key.trim()) || companies.some(company => !company.name.trim())} onClick={() => void act("save")}>Salvar conexão</button>
      <button className={button} disabled={busy} onClick={() => void act("refresh")}>Atualizar status</button>
      {Boolean(status?.error || status?.authFailed) && <button className={button} disabled={busy} onClick={() => void act("retry")}>Tentar novamente</button>}</div>
    <div role="status" className="text-[12px] text-ink-secondary">
      {saved && <p className="text-ink">Conexão salva.</p>}
      {status && <p>{status.enabled ? "Conexão ativada" : "Conexão desativada"} · {status.bots} agentes · {status.pending} pendências</p>}
      {status?.lastSyncAt && <p>Última sincronização: {new Date(status.lastSyncAt).toLocaleString()}</p>}
      {status?.authFailed && <p>Chave recusada. Confira a conexão no Notifica.</p>}
      {status?.error && !status.authFailed && <p>Sincronização pendente ({status.error}). As mensagens salvas serão tentadas novamente.</p>}
      {error && <p role="alert" className="mt-1 text-ink">{error}</p>}
    </div>
  </section>;
}
