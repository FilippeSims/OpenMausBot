import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  type Organization,
  type Task,
  type RecordEntry,
  type Operation,
  type Result,
  type Plan,
  type Preferences,
  type Reminder,
  type Delivery,
  columns,
  column,
  localDate,
  localTime,
  weekStart,
  addDays,
  planLabel,
  periods,
  zonedInstant,
} from "./model";
import "./organizer.css";
export type OrganizerProps = {
  request: (op: Operation) => Promise<Result>;
  agents?: { id: string; name: string }[];
  initialRecord?: string;
  title?: string;
};
const labels: Record<string, string> = {
  "tasks.create": "Tarefa criada",
  "tasks.update": "Tarefa editada",
  "tasks.complete": "Tarefa concluída",
  "tasks.reopen": "Tarefa reaberta",
  "tasks.move": "Cartão movido",
  "tasks.focus": "Foco iniciado",
  "tasks.archive": "Tarefa arquivada",
  "plans.set": "Planejamento alterado",
  "plans.clear": "Planejamento removido",
  "appointments.create": "Compromisso criado",
  "appointments.update": "Compromisso editado",
  "appointments.cancel": "Compromisso cancelado",
  "blocks.create": "Bloco criado",
  "blocks.update": "Bloco atualizado",
  "blocks.cancel": "Bloco cancelado",
  "reminders.create": "Lembrete solicitado",
  "reminders.update": "Lembrete atualizado",
  "reminders.cancel": "Lembrete cancelado",
  "actions.apply": "Resposta ao lembrete",
  "reminders.dispatch": "Lembretes processados",
  "preferences.update": "Preferências alteradas",
  "access.update": "Acesso dos agentes atualizado",
};
const stateLabels = {
  open: "Aberta",
  doing: "Fazendo",
  waiting: "Aguardando",
  done: "Concluída",
};
const priorityLabels = ["Sem prioridade", "Baixa", "Normal", "Alta"];
const eventDate = (at: string, zone: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: zone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(at));
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Não foi possível salvar. Tente novamente.";
}
function dateTimeValue(at: string, zone: string) {
  return localDate(at, zone) + "T" + localTime(at, zone);
}
function toInstant(value: string, zone: string) {
  const [day, time] = value.split("T");
  return zonedInstant(day, time, zone);
}
function download(data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "minha-organizacao.json";
  a.click();
  URL.revokeObjectURL(url);
}
export function Organizer({
  request,
  agents = [],
  initialRecord,
  title = "Minha organização",
}: OrganizerProps) {
  const [state, setState] = useState<Organization>(),
    [view, setView] = useState("Hoje"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState(""),
    [priority, setPriority] = useState(""),
    [context, setContext] = useState(""),
    [taskState, setTaskState] = useState(""),
    [planPeriod, setPlanPeriod] = useState("");
  const [editor, setEditor] = useState<{
      kind: "task" | "appointment" | "block";
      record?: RecordEntry;
    }>(),
    [preferences, setPreferences] = useState(false),
    [now, setNow] = useState(Date.now());
  const mounted = useRef(true),
    knownVersion = useRef<number | undefined>(undefined),
    locked = useRef(false),
    failed = useRef<{ fingerprint: string; key: string } | undefined>(
      undefined,
    ),
    sequence = useRef(0),
    initial = useRef(initialRecord);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const value = await request({
        operation: "snapshot",
        ...(knownVersion.current !== undefined
          ? { expected_version: knownVersion.current }
          : {}),
      });
      if (value.not_modified) return;
      if (mounted.current && seq === sequence.current) {
        setState(value.organization);
        knownVersion.current = value.organization.version;
        if (initial.current) {
          const record = value.organization.records.find(
            (r) => r.id === initial.current,
          );
          if (
            record &&
            ["task", "appointment", "block"].includes(record.kind)
          ) {
            setEditor({ kind: record.kind as "task", record });
            initial.current = undefined;
          }
        }
      }
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    }
  }, [request]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => {
      setNow(Date.now());
      if (!locked.current) void refresh();
    }, 5000);
    const resume = () => void refresh();
    window.addEventListener("online", resume);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener("online", resume);
    };
  }, [refresh]);
  async function act(op: Operation): Promise<boolean> {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    sequence.current++;
    const fingerprint = JSON.stringify(op),
      key =
        failed.current?.fingerprint === fingerprint
          ? failed.current.key
          : crypto.randomUUID();
    failed.current = { fingerprint, key };
    try {
      const result = await request({ ...op, idempotency_key: key });
      if (result.not_modified)
        throw new Error(
          "Resposta de salvamento inválida. Atualize e tente novamente.",
        );
      if (mounted.current) {
        setState(result.organization);
        knownVersion.current = result.organization.version;
        setNotice(
          result.warnings?.length
            ? result.warnings.join(" ")
            : "Salvo e sincronizado.",
        );
      }
      failed.current = undefined;
      return true;
    } catch (e) {
      if (mounted.current) {
        setError(errorMessage(e));
        void refresh();
      }
      return false;
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (!state)
    return (
      <section className="org">
        <h2>{title}</h2>
        {error ? (
          <div role="alert" className="org-error">
            {error}
            <button onClick={() => void refresh()}>Tentar novamente</button>
          </div>
        ) : (
          <p role="status">Carregando sua organização…</p>
        )}
      </section>
    );
  const zone = state.preferences.timezone,
    today = localDate(now, zone),
    tasks = state.records.filter(
      (r): r is Task => r.kind === "task" && !r.archived_at,
    ),
    visible = tasks.filter(
      (t) =>
        (!filter ||
          (t.title + " " + t.next_action + " " + t.context)
            .toLocaleLowerCase("pt-BR")
            .includes(filter.toLocaleLowerCase("pt-BR"))) &&
        (!priority || String(t.priority) === priority) &&
        (!context || t.context === context) &&
        (!taskState || t.state === taskState) &&
        (!planPeriod ||
          (t.plan?.mode === "period"
            ? t.plan.period === planPeriod
            : planPeriod === "none")),
    );
  const open = (record: RecordEntry) => {
    if (["task", "appointment", "block"].includes(record.kind))
      setEditor({ kind: record.kind as "task", record });
  };
  const move = (task: Task, col: string) =>
    void act({
      operation: "tasks.move",
      id: task.id,
      expected_version: task.version,
      data: { column: col },
    });
  const planDay = (
    task: Task,
    date: string,
    period?: "morning" | "afternoon" | "evening",
  ) =>
    void act({
      operation: "plans.set",
      id: task.id,
      expected_version: task.version,
      data: period
        ? { mode: "period", date, period, timezone: zone }
        : { mode: "day", date, timezone: zone },
    });
  const due = (t: Task) =>
    t.due_date ?? (t.due_at ? eventDate(t.due_at, zone) : "");
  const taskCard = (task: Task) => (
    <article
      className="org-task"
      key={task.id}
      draggable={!busy}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
    >
      <button className="org-task-title" onClick={() => open(task)}>
        {task.title}
      </button>
      {task.next_action && <p>{task.next_action}</p>}
      <div className="org-tags">
        <span>{priorityLabels[task.priority]}</span>
        {task.context && <span>{task.context}</span>}
      </div>
      {due(task) && (
        <small
          className={
            task.state !== "done" &&
            (task.due_date
              ? task.due_date < today
              : Date.parse(task.due_at!) < now)
              ? "org-overdue"
              : ""
          }
        >
          Prazo: {due(task)}
        </small>
      )}
      <small>Planejado: {planLabel(task.plan)}</small>
      {task.plan && column(task, today) === "Entrada" && (
        <small>
          {(task.plan.mode === "week"
            ? addDays(task.plan.week_start, 6)
            : task.plan.date) < today
            ? "Replanejar"
            : "Próximas datas"}
        </small>
      )}
      {state.records.some(
        (r) =>
          r.kind === "reminder" &&
          r.target_id === task.id &&
          ["scheduled", "review"].includes(r.state),
      ) && (
        <small>
          ◷ Lembrete{" "}
          {state.records.some(
            (r) =>
              r.kind === "reminder" &&
              r.target_id === task.id &&
              r.state === "review",
          )
            ? "para revisar"
            : "agendado"}
        </small>
      )}
      <label className="org-sr">
        Mover {task.title}
        <select
          value={column(task, today)}
          disabled={busy}
          onChange={(e) => move(task, e.target.value)}
        >
          {columns.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <div className="org-card-actions">
        <select
          aria-label={`Mover ${task.title}`}
          value={column(task, today)}
          disabled={busy}
          onChange={(e) => move(task, e.target.value)}
        >
          {columns.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button
          disabled={busy}
          onClick={() => open(task)}
          aria-label={`Editar ${task.title}`}
        >
          Editar
        </button>
      </div>
    </article>
  );
  const deliveries = state.records.filter(
    (r): r is Delivery =>
      r.kind === "delivery" &&
      r.state !== "acted" &&
      state.records.some(
        (t) =>
          t.id === r.target_id &&
          t.version === r.target_version &&
          (t.kind !== "task" || (t.state !== "done" && !t.archived_at)),
      ) &&
      state.records.some(
        (m) =>
          m.kind === "reminder" && m.delivery_id === r.id && m.state === "sent",
      ),
  );
  return (
    <section className="org" aria-label="Organização pessoal">
      <header className="org-heading">
        <div>
          <small>UM PLANO, NOS DOIS APLICATIVOS</small>
          <h2>{title}</h2>
          <p>Organize o próximo passo, no seu ritmo.</p>
        </div>
        <div className="org-actions">
          <button onClick={() => setEditor({ kind: "appointment" })}>
            + Compromisso
          </button>
          <button
            className="org-primary"
            onClick={() => setEditor({ kind: "task" })}
          >
            + Tarefa
          </button>
        </div>
      </header>
      <div className="org-tabs" role="tablist" aria-label="Visualizações">
        {["Hoje", "Kanban", "Calendário"].map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
        <button onClick={() => setPreferences(true)}>Preferências</button>
        <button onClick={() => void refresh()} disabled={busy}>
          Atualizar
        </button>
      </div>
      <div role="status" className="org-status">
        {busy ? "Salvando…" : notice || `Atualização automática · ${zone}`}
      </div>
      {error && (
        <div role="alert" className="org-error">
          {error}
          <button onClick={() => setError("")}>Fechar aviso</button>
        </div>
      )}
      {deliveries.length > 0 && (
        <section className="org-reminders">
          <h3>Seus lembretes</h3>
          {deliveries.slice(-10).map((delivery) => {
            const target = state.records.find(
              (t) => t.id === delivery.target_id,
            )!;
            const op = (action: string, data: Record<string, unknown> = {}) =>
              void act({
                operation: "actions.apply",
                id: delivery.id,
                expected_version: delivery.version,
                data: { action, ...data },
              });
            return (
              <article key={delivery.id}>
                <strong>
                  {"title" in target ? target.title : "Bloco de foco"}
                </strong>
                {delivery.state === "failed" && (
                  <small>
                    Entrega ao dispositivo pendente. O lembrete está disponível
                    aqui.
                  </small>
                )}
                <div className="org-actions">
                  {target.kind === "task" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        op("start", {
                          focus_minutes: state.preferences.focus_minutes,
                        })
                      }
                    >
                      Começar · {state.preferences.focus_minutes} min
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() =>
                      op("snooze", {
                        snoozed_until: new Date(
                          Date.now() + 15 * 60000,
                        ).toISOString(),
                      })
                    }
                  >
                    Lembrar em 15 min
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      op("snooze", {
                        snoozed_until: new Date(
                          Date.now() + 3600000,
                        ).toISOString(),
                      })
                    }
                  >
                    Em 1 hora
                  </button>
                  <button onClick={() => open(target)}>
                    Reagendar / escolher horário
                  </button>
                  {target.kind === "task" && (
                    <button disabled={busy} onClick={() => op("complete")}>
                      Concluir
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}
      <div className="org-filters">
        <input
          type="search"
          aria-label="Buscar tarefas"
          placeholder="Buscar tarefa ou próximo passo…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          aria-label="Filtrar prioridade"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="">Todas as prioridades</option>
          {priorityLabels.map((label, i) => (
            <option key={label} value={i}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar contexto"
          value={context}
          onChange={(e) => setContext(e.target.value)}
        >
          <option value="">Todos os contextos</option>
          {[...new Set(tasks.map((t) => t.context).filter(Boolean))].map(
            (c) => (
              <option key={c}>{c}</option>
            ),
          )}
        </select>
      </div>
      <div className="org-filters">
        <select
          aria-label="Filtrar estado"
          value={taskState}
          onChange={(e) => setTaskState(e.target.value)}
        >
          <option value="">Todos os estados</option>
          {Object.entries(stateLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar período"
          value={planPeriod}
          onChange={(e) => setPlanPeriod(e.target.value)}
        >
          <option value="">Todos os períodos</option>
          <option value="none">Sem período definido</option>
          {Object.entries(periods).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {view === "Kanban" && (
        <div className="org-board">
          {columns.map((col) => {
            const list = visible.filter((t) => column(t, today) === col);
            return (
              <section
                key={col}
                className="org-column"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const task = tasks.find(
                    (t) => t.id === e.dataTransfer.getData("text/plain"),
                  );
                  if (task) move(task, col);
                }}
              >
                <header>
                  <h3>{col}</h3>
                  <span>{list.length}</span>
                </header>
                {col === "Entrada"
                  ? ["Sem planejamento", "Replanejar", "Próximas datas"].map(
                      (group) => {
                        const grouped = list.filter((t) =>
                          !t.plan
                            ? group === "Sem planejamento"
                            : ((t.plan.mode === "week"
                                ? addDays(t.plan.week_start, 6)
                                : t.plan.date) < today
                                ? "Replanejar"
                                : "Próximas datas") === group,
                        );
                        return (
                          grouped.length > 0 && (
                            <div key={group}>
                              <h4>{group}</h4>
                              {grouped.map(taskCard)}
                            </div>
                          )
                        );
                      },
                    )
                  : list.map(taskCard)}
                {!list.length && (
                  <p className="org-empty">
                    Solte uma tarefa aqui ou use o menu do cartão.
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
      {view === "Hoje" && (
        <>
          <div className="org-today-intro">
            <h3>
              {new Intl.DateTimeFormat("pt-BR", {
                timeZone: zone,
                weekday: "long",
                day: "numeric",
                month: "long",
              }).format(new Date(now))}
            </h3>
            <p>
              Escolha até {state.preferences.daily_priorities} prioridades como
              ponto de partida. Você pode ajustar o dia.
            </p>
            {tasks.filter((t) => column(t, today) === "Hoje").length >
              state.preferences.daily_priorities && (
              <small>
                Há mais tarefas planejadas que a sugestão diária. Vale escolher
                o próximo passo.
              </small>
            )}
          </div>
          <div className="org-today-grid">
            <section>
              <h3>Prioridades do dia</h3>
              {visible
                .filter(
                  (t) =>
                    t.state !== "done" &&
                    t.plan &&
                    t.plan.mode !== "week" &&
                    t.plan.date === today,
                )
                .sort((a, b) => b.priority - a.priority)
                .slice(0, state.preferences.daily_priorities)
                .map(taskCard)}
              <h3>Prazo hoje</h3>
              {visible
                .filter(
                  (t) =>
                    t.state !== "done" &&
                    (t.due_date === today ||
                      (t.due_at && localDate(t.due_at, zone) === today)),
                )
                .map(taskCard)}
            </section>
            <section>
              <h3>Seu planejamento</h3>
              {["day", "morning", "afternoon", "evening"].map((period) => (
                <div
                  className="org-day-period"
                  key={period}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const task = tasks.find(
                      (t) => t.id === e.dataTransfer.getData("text/plain"),
                    );
                    if (task)
                      planDay(
                        task,
                        today,
                        period === "day" ? undefined : (period as "morning"),
                      );
                  }}
                >
                  <h4>
                    {period === "day"
                      ? "Sem horário"
                      : periods[period as keyof typeof periods]}
                  </h4>
                  {visible
                    .filter(
                      (t) =>
                        t.state !== "done" &&
                        t.plan &&
                        t.plan.mode !== "week" &&
                        t.plan.date === today &&
                        (t.plan.mode === "day"
                          ? period === "day"
                          : t.plan.period === period),
                    )
                    .map(taskCard)}
                </div>
              ))}
            </section>
            <section>
              <h3>Compromissos e foco</h3>
              {state.records
                .filter(
                  (r) =>
                    (r.kind === "appointment" || r.kind === "block") &&
                    r.state !== "cancelled" &&
                    localDate(r.start_at, zone) <= today &&
                    localDate(r.end_at, zone) >= today,
                )
                .map((r) => (
                  <button
                    className="org-event"
                    key={r.id}
                    onClick={() => open(r)}
                  >
                    {r.kind === "appointment" ? r.title : "Bloco de foco"}
                    <small>
                      {"start_at" in r
                        ? `${eventDate(r.start_at, zone)} → ${eventDate(r.end_at, zone)}`
                        : ""}
                    </small>
                  </button>
                ))}
              <h3>Replanejar quando fizer sentido</h3>
              {visible
                .filter(
                  (t) =>
                    t.state !== "done" &&
                    t.plan &&
                    (t.plan.mode === "week"
                      ? addDays(t.plan.week_start, 6)
                      : t.plan.date) < today,
                )
                .map(taskCard)}
            </section>
          </div>
        </>
      )}
      {view === "Calendário" && (
        <Calendar
          state={state}
          tasks={visible}
          today={today}
          open={open}
          act={act}
          busy={busy}
          taskCard={taskCard}
        />
      )}
      <footer className="org-footer">
        Disponibilidade considera somente esta agenda local. Nenhum calendário
        externo está conectado.{" "}
        <button onClick={() => download(state)}>Exportar meus dados</button>
      </footer>
      {editor && (
        <Editor
          key={
            (editor.record?.id ?? editor.kind) +
            ":" +
            (editor.record?.version ?? 0)
          }
          kind={editor.kind}
          initial={editor.record}
          state={state}
          serverError={error}
          busy={busy}
          act={act}
          close={() => setEditor(undefined)}
          refreshRecord={() => {
            const record = state.records.find(
              (r) => r.id === editor.record?.id,
            );
            if (record) setEditor({ kind: record.kind as "task", record });
          }}
        />
      )}
      {preferences && (
        <PreferencesEditor
          state={state}
          serverError={error}
          agents={agents}
          busy={busy}
          act={act}
          close={() => setPreferences(false)}
        />
      )}
    </section>
  );
}

type Action = (op: Operation) => Promise<boolean>;
function Calendar({
  state,
  tasks,
  today,
  open,
  act,
  busy,
  taskCard,
}: {
  state: Organization;
  tasks: Task[];
  today: string;
  open: (r: RecordEntry) => void;
  act: Action;
  busy: boolean;
  taskCard: (t: Task) => React.ReactNode;
}) {
  const [mode, setMode] = useState("Semana"),
    [anchor, setAnchor] = useState(today),
    zone = state.preferences.timezone;
  const start =
      mode === "Dia"
        ? anchor
        : mode === "Semana"
          ? weekStart(anchor)
          : weekStart(anchor.slice(0, 7) + "-01"),
    days = Array.from(
      { length: mode === "Dia" ? 1 : mode === "Semana" ? 7 : 42 },
      (_, i) => addDays(start, i),
    );
  const timed = state.records.filter(
    (r) =>
      (r.kind === "block" || r.kind === "appointment") &&
      r.state !== "cancelled",
  );
  async function drop(id: string, date: string, hour?: number) {
    const r = state.records.find((item) => item.id === id);
    if (!r || busy) return;
    if (r.kind === "task") {
      await act({
        operation: "plans.set",
        id,
        expected_version: r.version,
        data: { mode: "day", date, timezone: zone },
      });
      return;
    }
    if (r.kind === "appointment" || r.kind === "block") {
      const at = zonedInstant(
        date,
        hour === undefined
          ? localTime(r.start_at, zone)
          : `${String(hour).padStart(2, "0")}:00`,
        zone,
      );
      await act({
        operation: r.kind === "block" ? "blocks.update" : "appointments.update",
        id,
        expected_version: r.version,
        data: {
          start_at: at,
          end_at: new Date(
            Date.parse(at) + Date.parse(r.end_at) - Date.parse(r.start_at),
          ).toISOString(),
        },
      });
    }
  }
  const dropArea = (date: string, hour?: number) => ({
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      void drop(e.dataTransfer.getData("text/plain"), date, hour);
    },
  });
  return (
    <div>
      <div className="org-calendar-toolbar">
        <button
          onClick={() =>
            setAnchor(
              mode === "Mês"
                ? new Date(
                    Date.UTC(
                      Number(anchor.slice(0, 4)),
                      Number(anchor.slice(5, 7)) - 2,
                      1,
                      12,
                    ),
                  )
                    .toISOString()
                    .slice(0, 10)
                : addDays(anchor, mode === "Dia" ? -1 : -7),
            )
          }
        >
          ← Anterior
        </button>
        <h3>
          {new Intl.DateTimeFormat("pt-BR", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(anchor + "T12:00Z"))}
        </h3>
        <button onClick={() => setAnchor(today)}>Hoje</button>
        <button
          onClick={() =>
            setAnchor(
              mode === "Mês"
                ? new Date(
                    Date.UTC(
                      Number(anchor.slice(0, 4)),
                      Number(anchor.slice(5, 7)),
                      1,
                      12,
                    ),
                  )
                    .toISOString()
                    .slice(0, 10)
                : addDays(anchor, mode === "Dia" ? 1 : 7),
            )
          }
        >
          Próximo →
        </button>
        <select
          aria-label="Visão do calendário"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option>Dia</option>
          <option>Semana</option>
          <option>Mês</option>
        </select>
        <input
          type="date"
          aria-label="Ir para a data"
          value={anchor}
          onChange={(e) => e.target.value && setAnchor(e.target.value)}
        />
      </div>
      <div className="org-week-plan">
        <h4>Planejadas só para a semana</h4>
        {tasks
          .filter(
            (t) =>
              t.plan?.mode === "week" &&
              addDays(t.plan.week_start, 6) >= start &&
              t.plan.week_start <= days[days.length - 1],
          )
          .map(taskCard)}
        <small>Estas tarefas ainda não têm um dia escolhido.</small>
      </div>
      <div
        className={`org-calendar ${mode === "Mês" ? "org-month" : mode === "Dia" ? "org-week org-single" : "org-week"}`}
      >
        {days.map((date) => (
          <section
            key={date}
            className={
              date === today
                ? "org-calendar-day org-current"
                : "org-calendar-day"
            }
          >
            <button
              className="org-date"
              onClick={() => {
                setAnchor(date);
                setMode("Dia");
              }}
            >
              {new Intl.DateTimeFormat("pt-BR", {
                weekday: "short",
                day: "numeric",
                timeZone: "UTC",
              }).format(new Date(date + "T12:00Z"))}
            </button>
            <div className="org-calendar-tasks" {...dropArea(date)}>
              <small>Dia / período</small>
              {tasks
                .filter(
                  (t) =>
                    t.plan && t.plan.mode !== "week" && t.plan.date === date,
                )
                .map((t) => (
                  <button
                    className="org-calendar-task"
                    key={t.id}
                    draggable={!busy}
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/plain", t.id)
                    }
                    onClick={() => open(t)}
                  >
                    <strong>{t.title}</strong>
                    <small>
                      {t.plan?.mode === "period"
                        ? periods[t.plan.period]
                        : "Sem horário"}{" "}
                      · {stateLabels[t.state]}
                    </small>
                  </button>
                ))}
              {tasks
                .filter(
                  (t) =>
                    t.due_date === date ||
                    (t.due_at && localDate(t.due_at, zone) === date),
                )
                .map((t) => (
                  <button
                    className="org-deadline"
                    key={t.id}
                    onClick={() => open(t)}
                  >
                    Prazo · {t.title}
                  </button>
                ))}
            </div>
            {mode !== "Mês" ? (
              <div className="org-hours">
                {Array.from({ length: 24 }, (_, hour) => (
                  <div
                    className="org-hour"
                    key={hour}
                    {...dropArea(date, hour)}
                  >
                    <small>{String(hour).padStart(2, "0")}:00</small>
                    {timed
                      .filter(
                        (r) =>
                          "start_at" in r &&
                          localDate(r.start_at, zone) === date &&
                          Number(localTime(r.start_at, zone).slice(0, 2)) ===
                            hour,
                      )
                      .map((r) => (
                        <button
                          className="org-event"
                          key={r.id}
                          draggable={!busy}
                          onDragStart={(e) =>
                            e.dataTransfer.setData("text/plain", r.id)
                          }
                          onClick={() => open(r)}
                        >
                          {r.kind === "appointment"
                            ? "Compromisso · " + r.title
                            : "Foco · " +
                              tasks.find(
                                (t) => r.kind === "block" && t.id === r.task_id,
                              )?.title}
                          <small>
                            {"start_at" in r
                              ? `${localTime(r.start_at, zone)} → ${eventDate(r.end_at, zone)}`
                              : ""}
                          </small>
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            ) : (
              timed
                .filter(
                  (r) =>
                    "start_at" in r &&
                    localDate(r.start_at, zone) <= date &&
                    localDate(r.end_at, zone) >= date,
                )
                .map((r) => (
                  <button
                    className="org-event"
                    key={r.id}
                    draggable={!busy}
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/plain", r.id)
                    }
                    onClick={() => open(r)}
                  >
                    {r.kind === "appointment"
                      ? "Compromisso · " + r.title
                      : "Bloco de foco"}
                    <small>
                      {"start_at" in r ? localTime(r.start_at, zone) : ""}
                    </small>
                  </button>
                ))
            )}
          </section>
        ))}
      </div>
      <p className="org-hint">
        Arraste cartões para outro dia e blocos para outro horário. Para editar
        com teclado, abra o item. Mover execução preserva o prazo.
      </p>
    </div>
  );
}

function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog className="org-modal" ref={ref} onCancel={close}>
      <div className="org-modal-heading">
        <h3>{title}</h3>
        <button type="button" onClick={close} aria-label="Fechar">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function PlanFields({
  value,
  change,
  zone,
}: {
  value: Plan | null;
  change: (p: Plan | null) => void;
  zone: string;
}) {
  const today = localDate(Date.now(), zone),
    date = value
      ? value.mode === "week"
        ? value.week_start
        : value.date
      : today;
  return (
    <fieldset>
      <legend>Quando executar</legend>
      <label>
        Planejamento
        <select
          value={value?.mode ?? "none"}
          onChange={(e) =>
            change(
              e.target.value === "none"
                ? null
                : e.target.value === "week"
                  ? {
                      mode: "week",
                      week_start: weekStart(date),
                      timezone: zone,
                    }
                  : e.target.value === "period"
                    ? {
                        mode: "period",
                        date,
                        period: "afternoon",
                        timezone: zone,
                      }
                    : { mode: "day", date, timezone: zone },
            )
          }
        >
          <option value="none">Sem planejamento</option>
          <option value="day">Um dia, sem horário</option>
          <option value="period">Um período</option>
          <option value="week">Uma semana, sem dia definido</option>
        </select>
      </label>
      {value && (
        <label>
          {value.mode === "week" ? "Segunda-feira da semana" : "Dia"}
          <input
            type="date"
            required
            value={date}
            onChange={(e) =>
              e.target.value &&
              change(
                value.mode === "week"
                  ? { ...value, week_start: weekStart(e.target.value) }
                  : { ...value, date: e.target.value },
              )
            }
          />
        </label>
      )}
      {value?.mode === "period" && (
        <label>
          Período
          <select
            value={value.period}
            onChange={(e) =>
              change({ ...value, period: e.target.value as "morning" })
            }
          >
            {Object.entries(periods).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}
      <small>Planejar não cria lembrete nem altera o prazo.</small>
    </fieldset>
  );
}
function Editor({
  kind,
  initial,
  state,
  serverError,
  busy,
  act,
  close,
  refreshRecord,
}: {
  kind: "task" | "appointment" | "block";
  initial?: RecordEntry;
  state: Organization;
  serverError: string;
  busy: boolean;
  act: Action;
  close: () => void;
  refreshRecord: () => void;
}) {
  const zone = state.preferences.timezone,
    base = initial?.kind === "task" ? initial : undefined;
  const [title, setTitle] = useState(
      initial && "title" in initial ? initial.title : "",
    ),
    [description, setDescription] = useState(base?.description ?? ""),
    [next, setNext] = useState(base?.next_action ?? ""),
    [context, setContext] = useState(base?.context ?? ""),
    [priority, setPriority] = useState(base?.priority ?? 0),
    [status, setStatus] = useState(base?.state ?? "open");
  const [plan, setPlan] = useState<Plan | null>(base?.plan ?? null),
    [dueMode, setDueMode] = useState(
      base?.due_at ? "time" : base?.due_date ? "day" : "none",
    ),
    [due, setDue] = useState(base?.due_date ?? ""),
    [dueAt, setDueAt] = useState(
      base?.due_at ? dateTimeValue(base.due_at, zone) : "",
    ),
    [estimate, setEstimate] = useState(
      base?.estimate_minutes ? String(base.estimate_minutes) : "",
    ),
    [checklist, setChecklist] = useState(base?.checklist ?? []);
  const start =
      initial && "start_at" in initial
        ? initial.start_at
        : new Date().toISOString(),
    end =
      initial && "end_at" in initial
        ? initial.end_at
        : new Date(Date.now() + 25 * 60000).toISOString();
  const [startAt, setStartAt] = useState(dateTimeValue(start, zone)),
    [endAt, setEndAt] = useState(dateTimeValue(end, zone)),
    [location, setLocation] = useState(
      initial?.kind === "appointment" ? initial.location : "",
    ),
    [notes, setNotes] = useState(
      initial?.kind === "appointment" ? initial.notes : "",
    ),
    [taskId, setTaskId] = useState(
      initial?.kind === "block" ? initial.task_id : (base?.id ?? ""),
    ),
    [confirmOverlap, setConfirmOverlap] = useState(false),
    [localError, setLocalError] = useState("");
  const current = initial
      ? state.records.find((r) => r.id === initial.id)
      : undefined,
    stale = Boolean(current && initial && current.version !== initial.version);
  async function save(e: FormEvent) {
    e.preventDefault();
    setLocalError("");
    try {
      let data: Record<string, unknown>, operation: string;
      if (kind === "task") {
        data = {
          title,
          description,
          next_action: next,
          state: status,
          priority,
          context,
          due_date: dueMode === "day" ? due : null,
          due_at: dueMode === "time" ? toInstant(dueAt, zone) : null,
          estimate_minutes: estimate ? Number(estimate) : null,
          plan,
          checklist,
        };
        operation = initial ? "tasks.update" : "tasks.create";
      } else if (kind === "appointment") {
        data = {
          title,
          start_at: toInstant(startAt, zone),
          end_at: toInstant(endAt, zone),
          timezone: zone,
          location,
          notes,
          confirm_overlap: confirmOverlap,
        };
        operation = initial ? "appointments.update" : "appointments.create";
      } else {
        data = {
          start_at: toInstant(startAt, zone),
          end_at: toInstant(endAt, zone),
          timezone: zone,
          ...(!initial ? { task_id: taskId } : {}),
        };
        operation = initial ? "blocks.update" : "blocks.create";
      }
      if (
        await act({
          operation,
          ...(initial
            ? { id: initial.id, expected_version: initial.version }
            : {}),
          data,
        })
      )
        close();
    } catch (e) {
      setLocalError(errorMessage(e));
    }
  }
  return (
    <Modal
      title={
        initial
          ? "Detalhes e planejamento"
          : kind === "task"
            ? "Nova tarefa"
            : kind === "appointment"
              ? "Novo compromisso"
              : "Novo bloco"
      }
      close={close}
    >
      {serverError && (
        <p role="alert" className="org-error">
          {serverError}
        </p>
      )}
      {stale && (
        <p className="org-error">
          Este registro mudou em outro lugar. Seu rascunho foi preservado.{" "}
          <button
            onClick={() => {
              refreshRecord();
            }}
          >
            Carregar a versão atual (descartar rascunho)
          </button>
        </p>
      )}
      {localError && (
        <p role="alert" className="org-error">
          {localError}
        </p>
      )}
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <div className="org-form-grid">
            {kind !== "block" && (
              <label className="org-wide">
                Título
                <input
                  autoFocus
                  required
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
            )}
            {kind === "task" ? (
              <>
                <label className="org-wide">
                  Próximo passo
                  <input
                    value={next}
                    maxLength={4000}
                    onChange={(e) => setNext(e.target.value)}
                  />
                </label>
                <label>
                  Estado
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Task["state"])}
                  >
                    {Object.entries(stateLabels).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Prioridade
                  <select
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value) as 0)}
                  >
                    {priorityLabels.map((v, i) => (
                      <option key={v} value={i}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Contexto / projeto
                  <input
                    maxLength={120}
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                  />
                </label>
                <label>
                  Estimativa, em minutos
                  <input
                    type="number"
                    min={1}
                    max={10080}
                    value={estimate}
                    onChange={(e) => setEstimate(e.target.value)}
                  />
                </label>
                <label className="org-wide">
                  Descrição
                  <textarea
                    value={description}
                    maxLength={4000}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <div className="org-wide">
                  <PlanFields value={plan} change={setPlan} zone={zone} />
                </div>
                <label>
                  Prazo de entrega
                  <select
                    value={dueMode}
                    onChange={(e) => setDueMode(e.target.value)}
                  >
                    <option value="none">Sem prazo</option>
                    <option value="day">Data (até o fim do dia local)</option>
                    <option value="time">Data e horário exato</option>
                  </select>
                </label>
                {dueMode === "day" && (
                  <label>
                    Data do prazo
                    <input
                      type="date"
                      value={due}
                      required
                      onChange={(e) => setDue(e.target.value)}
                    />
                  </label>
                )}
                {dueMode === "time" && (
                  <label>
                    Prazo · {zone}
                    <input
                      type="datetime-local"
                      value={dueAt}
                      required
                      onChange={(e) => setDueAt(e.target.value)}
                    />
                  </label>
                )}
                <fieldset className="org-wide">
                  <legend>Checklist</legend>
                  {checklist.map((item) => (
                    <div className="org-check" key={item.id}>
                      <input
                        type="checkbox"
                        aria-label={`Concluir ${item.title}`}
                        checked={item.done}
                        onChange={(e) =>
                          setChecklist((items) =>
                            items.map((i) =>
                              i.id === item.id
                                ? { ...i, done: e.target.checked }
                                : i,
                            ),
                          )
                        }
                      />
                      <input
                        required
                        aria-label="Item do checklist"
                        value={item.title}
                        maxLength={200}
                        onChange={(e) =>
                          setChecklist((items) =>
                            items.map((i) =>
                              i.id === item.id
                                ? { ...i, title: e.target.value }
                                : i,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label={`Remover ${item.title}`}
                        onClick={() =>
                          setChecklist((items) =>
                            items.filter((i) => i.id !== item.id),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={checklist.length >= 50}
                    onClick={() =>
                      setChecklist((items) => [
                        ...items,
                        { id: crypto.randomUUID(), title: "", done: false },
                      ])
                    }
                  >
                    + Item
                  </button>
                </fieldset>
              </>
            ) : (
              <>
                {kind === "block" && !initial && (
                  <label className="org-wide">
                    Tarefa
                    <select
                      required
                      value={taskId}
                      onChange={(e) => setTaskId(e.target.value)}
                    >
                      <option value="">Escolha uma tarefa</option>
                      {state.records
                        .filter(
                          (r): r is Task =>
                            r.kind === "task" &&
                            r.state !== "done" &&
                            !r.archived_at,
                        )
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label>
                  Início · {zone}
                  <input
                    type="datetime-local"
                    required
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                  />
                </label>
                <label>
                  Fim · {zone}
                  <input
                    type="datetime-local"
                    required
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                  />
                </label>
                {kind === "appointment" && (
                  <>
                    <label>
                      Local
                      <input
                        value={location}
                        maxLength={500}
                        onChange={(e) => setLocation(e.target.value)}
                      />
                    </label>
                    <label>
                      Notas
                      <textarea
                        value={notes}
                        maxLength={4000}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </label>
                    <label className="org-checkbox org-wide">
                      <input
                        type="checkbox"
                        checked={confirmOverlap}
                        onChange={(e) => setConfirmOverlap(e.target.checked)}
                      />{" "}
                      Confirmar mesmo se houver sobreposição na agenda local
                    </label>
                    <p>Nenhum convite será enviado.</p>
                  </>
                )}
              </>
            )}
          </div>
          <div className="org-actions">
            <button className="org-primary" disabled={stale}>
              Salvar
            </button>
            <button type="button" onClick={close}>
              Fechar
            </button>
          </div>
        </fieldset>
      </form>
      {initial && (
        <>
          <div className="org-actions">
            {initial.kind === "task" ? (
              <>
                <button
                  disabled={busy || stale || initial.state === "done"}
                  onClick={async () => {
                    if (
                      await act({
                        operation: "tasks.focus",
                        id: initial.id,
                        expected_version: initial.version,
                        data: { minutes: state.preferences.focus_minutes },
                      })
                    )
                      close();
                  }}
                >
                  Começar foco · {state.preferences.focus_minutes} min
                </button>
                <button
                  disabled={busy || stale}
                  onClick={async () => {
                    if (
                      await act({
                        operation:
                          initial.state === "done"
                            ? "tasks.reopen"
                            : "tasks.complete",
                        id: initial.id,
                        expected_version: initial.version,
                      })
                    )
                      close();
                  }}
                >
                  {initial.state === "done" ? "Reabrir" : "Concluir"}
                </button>
                <button
                  disabled={busy || stale}
                  onClick={async () => {
                    if (
                      await act({
                        operation: "tasks.archive",
                        id: initial.id,
                        expected_version: initial.version,
                      })
                    )
                      close();
                  }}
                >
                  Arquivar
                </button>
              </>
            ) : (
              <>
                <button
                  disabled={busy || stale}
                  onClick={async () => {
                    if (
                      await act({
                        operation:
                          initial.kind === "block"
                            ? "blocks.cancel"
                            : "appointments.cancel",
                        id: initial.id,
                        expected_version: initial.version,
                      })
                    )
                      close();
                  }}
                >
                  Cancelar {initial.kind === "block" ? "bloco" : "compromisso"}
                </button>
                {initial.kind === "block" && (
                  <button
                    disabled={busy || stale}
                    onClick={async () => {
                      if (
                        await act({
                          operation: "blocks.update",
                          id: initial.id,
                          expected_version: initial.version,
                          data: { state: "done" },
                        })
                      )
                        close();
                    }}
                  >
                    Encerrar bloco (manter tarefa)
                  </button>
                )}
              </>
            )}
          </div>
          {initial.kind === "task" && (
            <Blocks task={initial} state={state} busy={busy} act={act} />
          )}
          <Reminders
            target={current ?? initial}
            state={state}
            busy={busy}
            act={act}
          />
          <details className="org-history">
            <summary>Histórico de alterações</summary>
            {state.audit
              .filter((e) => e.changes.some((c) => c.id === initial.id))
              .map((e) => (
                <p key={e.id}>
                  <strong>{labels[e.action] ?? "Registro alterado"}</strong>
                  <br />
                  {e.actor_type === "bot"
                    ? "Agente " + e.actor_id
                    : e.actor_type === "worker"
                      ? "Processamento de lembretes"
                      : "Você"}{" "}
                  · {eventDate(e.occurred_at, zone)}
                  {e.changes
                    .filter(
                      (c) => c.id === initial.id && c.after.kind === "task",
                    )
                    .map((c) => (
                      <small key={c.id}>
                        {c.after.kind === "task"
                          ? `Estado: ${stateLabels[c.after.state]} · Planejamento: ${planLabel(c.after.plan)} · Prazo: ${c.after.due_date ?? c.after.due_at ?? "sem prazo"}`
                          : ""}
                      </small>
                    ))}
                </p>
              ))}
          </details>
        </>
      )}
    </Modal>
  );
}
function Blocks({
  task,
  state,
  busy,
  act,
}: {
  task: Task;
  state: Organization;
  busy: boolean;
  act: Action;
}) {
  const zone = state.preferences.timezone,
    [at, setAt] = useState(""),
    [minutes, setMinutes] = useState(state.preferences.focus_minutes),
    [error, setError] = useState("");
  return (
    <section className="org-subsection">
      <h4>Blocos de execução</h4>
      {state.records
        .filter((r) => r.kind === "block" && r.task_id === task.id)
        .map((r) => (
          <p key={r.id}>
            {r.kind === "block"
              ? `${eventDate(r.start_at, zone)} · ${Math.round((Date.parse(r.end_at) - Date.parse(r.start_at)) / 60000)} min · ${r.state === "done" ? "Encerrado" : r.state === "cancelled" ? "Cancelado" : r.state === "active" ? "Em foco" : "Planejado"}`
              : ""}
            {r.kind === "block" && !["done", "cancelled"].includes(r.state) && (
              <button
                disabled={busy}
                onClick={() =>
                  void act({
                    operation: "blocks.update",
                    id: r.id,
                    expected_version: r.version,
                    data: { state: "done" },
                  })
                }
              >
                Encerrar bloco
              </button>
            )}
          </p>
        ))}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const start = toInstant(at, zone);
            if (
              await act({
                operation: "blocks.create",
                data: {
                  task_id: task.id,
                  start_at: start,
                  end_at: new Date(
                    Date.parse(start) + minutes * 60000,
                  ).toISOString(),
                  timezone: zone,
                },
              })
            )
              setAt("");
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      >
        <div className="org-form-grid">
          <label>
            Agendar bloco
            <input
              required
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </label>
          <label>
            Minutos
            <input
              type="number"
              min={5}
              max={180}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
        </div>
        <button disabled={busy || task.state === "done"}>
          Adicionar bloco
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
function Reminders({
  target,
  state,
  busy,
  act,
}: {
  target: RecordEntry;
  state: Organization;
  busy: boolean;
  act: Action;
}) {
  const zone = state.preferences.timezone,
    [at, setAt] = useState(""),
    [rule, setRule] = useState("absolute"),
    [before, setBefore] = useState(30),
    [time, setTime] = useState("09:00"),
    [allow, setAllow] = useState(false),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<Reminder>();
  const reminders = state.records.filter(
    (r): r is Reminder => r.kind === "reminder" && r.target_id === target.id,
  );
  const status = {
    scheduled: "Agendado",
    sent: "Disponível na central",
    cancelled: "Cancelado",
    review: "Precisa de revisão",
    missed: "Não enviado: ficou mais de 6 horas atrasado",
  };
  return (
    <section className="org-subsection">
      <h4>Lembretes</h4>
      <p>
        Somente os avisos que você solicitar. Adiar um aviso preserva o prazo e
        o planejamento.
      </p>
      {reminders.map((r) => (
        <div className="org-reminder-row" key={r.id}>
          <span>
            {eventDate(r.scheduled_at, zone)} · {status[r.state]} ·{" "}
            {r.rule.type === "absolute"
              ? "Independente"
              : r.rule.type === "plan"
                ? "Ligado ao planejamento"
                : "Antes do início"}
          </span>
          {r.state !== "cancelled" && (
            <>
              <button
                disabled={busy}
                onClick={() => {
                  setEditing(r);
                  setAt(dateTimeValue(r.scheduled_at, zone));
                  setRule(r.rule.type);
                  setTime(r.rule.type === "plan" ? r.rule.time : "09:00");
                  setBefore(
                    r.rule.type === "relative" ? r.rule.minutes_before : 30,
                  );
                  setAllow(r.allow_quiet);
                }}
              >
                Editar / reagendar
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act({
                    operation: "reminders.cancel",
                    id: r.id,
                    expected_version: r.version,
                  })
                }
              >
                Cancelar aviso
              </button>
            </>
          )}
        </div>
      ))}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            let scheduled: string,
              ruleValue: Record<string, unknown> = { type: rule };
            if (rule === "absolute") scheduled = toInstant(at, zone);
            else if (rule === "relative" && "start_at" in target) {
              scheduled = new Date(
                Date.parse(target.start_at) - before * 60000,
              ).toISOString();
              ruleValue.minutes_before = before;
            } else if (
              rule === "plan" &&
              target.kind === "task" &&
              target.plan &&
              target.plan.mode !== "week"
            ) {
              scheduled = zonedInstant(
                target.plan.date,
                time,
                target.plan.timezone,
              );
              ruleValue.time = time;
            } else throw new Error("Escolha um dia de execução primeiro.");
            if (
              await act({
                operation: editing ? "reminders.update" : "reminders.create",
                ...(editing
                  ? { id: editing.id, expected_version: editing.version }
                  : {}),
                data: {
                  ...(!editing
                    ? { target_id: target.id, target_type: target.kind }
                    : {}),
                  rule: ruleValue,
                  scheduled_at: scheduled,
                  allow_quiet: allow,
                },
              })
            ) {
              setEditing(undefined);
              setAt("");
            }
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      >
        <div className="org-form-grid">
          <label>
            Regra
            <select value={rule} onChange={(e) => setRule(e.target.value)}>
              <option value="absolute">Data e hora independentes</option>
              {target.kind === "task" && (
                <option value="plan">Horário no dia planejado</option>
              )}
              {(target.kind === "block" || target.kind === "appointment") && (
                <option value="relative">Minutos antes do início</option>
              )}
            </select>
          </label>
          {rule === "absolute" ? (
            <label>
              Quando avisar · {zone}
              <input
                required
                type="datetime-local"
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />
            </label>
          ) : rule === "relative" ? (
            <label>
              Minutos antes
              <input
                required
                type="number"
                min={0}
                max={10080}
                value={before}
                onChange={(e) => setBefore(Number(e.target.value))}
              />
            </label>
          ) : (
            <label>
              Horário explícito
              <input
                type="time"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
          )}
        </div>
        <label className="org-checkbox">
          <input
            type="checkbox"
            checked={allow}
            onChange={(e) => setAllow(e.target.checked)}
          />{" "}
          Permitir este aviso durante o silêncio
        </label>
        <button disabled={busy}>
          {editing ? "Salvar lembrete" : "Agendar lembrete"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(undefined);
              setAt("");
            }}
          >
            Cancelar edição
          </button>
        )}
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
function PreferencesEditor({
  state,
  agents,
  serverError,
  busy,
  act,
  close,
}: {
  state: Organization;
  agents: { id: string; name: string }[];
  serverError: string;
  busy: boolean;
  act: Action;
  close: () => void;
}) {
  const [prefs, setPrefs] = useState<Preferences>(
      structuredClone(state.preferences),
    ),
    [botIds, setBotIds] = useState(state.allowed_bot_ids),
    [version] = useState(state.version);
  return (
    <Modal title="Preferências de organização" close={close}>
      {serverError && (
        <p role="alert" className="org-error">
          {serverError}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await act({
              operation: "preferences.update",
              expected_version: version,
              data: { ...prefs },
            })
          )
            close();
        }}
      >
        <fieldset disabled={busy}>
          <div className="org-form-grid">
            <label>
              Fuso horário
              <input
                required
                value={prefs.timezone}
                onChange={(e) =>
                  setPrefs({ ...prefs, timezone: e.target.value })
                }
              />
            </label>
            <label>
              Foco sugerido (minutos)
              <input
                type="number"
                min={5}
                max={180}
                value={prefs.focus_minutes}
                onChange={(e) =>
                  setPrefs({ ...prefs, focus_minutes: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Prioridades sugeridas por dia
              <input
                type="number"
                min={1}
                max={20}
                value={prefs.daily_priorities}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    daily_priorities: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Limite de avisos por dia
              <input
                type="number"
                min={1}
                max={30}
                value={prefs.reminder_limit}
                onChange={(e) =>
                  setPrefs({ ...prefs, reminder_limit: Number(e.target.value) })
                }
              />
            </label>
            {Object.entries(periods).map(([key, label]) => (
              <label key={key}>
                {label} começa às
                <input
                  type="time"
                  required
                  value={prefs.periods[key as keyof typeof periods]}
                  onChange={(e) =>
                    setPrefs({
                      ...prefs,
                      periods: { ...prefs.periods, [key]: e.target.value },
                    })
                  }
                />
              </label>
            ))}
            <label className="org-checkbox org-wide">
              <input
                type="checkbox"
                checked={prefs.quiet_hours.enabled}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    quiet_hours: {
                      ...prefs.quiet_hours,
                      enabled: e.target.checked,
                    },
                  })
                }
              />{" "}
              Respeitar período de silêncio
            </label>
            <label>
              Silêncio começa
              <input
                type="time"
                value={prefs.quiet_hours.start}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    quiet_hours: {
                      ...prefs.quiet_hours,
                      start: e.target.value,
                    },
                  })
                }
              />
            </label>
            <label>
              Silêncio termina
              <input
                type="time"
                value={prefs.quiet_hours.end}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    quiet_hours: { ...prefs.quiet_hours, end: e.target.value },
                  })
                }
              />
            </label>
          </div>
          <p>
            Nenhuma rotina ou repetição de avisos será ativada. Planejar um
            período não agenda notificações.
          </p>
          <button className="org-primary">Salvar preferências</button>
        </fieldset>
      </form>
      <section className="org-subsection">
        <h4>Agentes autorizados</h4>
        <p>
          Escolha quem pode consultar e alterar sua organização pessoal pelo
          chat.
        </p>
        {agents.length ? (
          agents.map((bot) => (
            <label className="org-checkbox" key={bot.id}>
              <input
                type="checkbox"
                checked={botIds.includes(bot.id)}
                onChange={(e) =>
                  setBotIds((ids) =>
                    e.target.checked
                      ? [...ids, bot.id]
                      : ids.filter((id) => id !== bot.id),
                  )
                }
              />
              {bot.name}
            </label>
          ))
        ) : (
          <p>
            Os agentes aparecem depois de sincronizar a conexão OpenMausBot.
          </p>
        )}
        <button
          disabled={busy}
          onClick={async () => {
            if (
              await act({
                operation: "access.update",
                expected_version: version,
                data: { allowed_bot_ids: botIds },
              })
            )
              close();
          }}
        >
          Salvar acesso dos agentes
        </button>
      </section>
    </Modal>
  );
}
