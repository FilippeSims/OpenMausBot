export type Plan =
  | { mode: "day"; date: string; timezone: string }
  | {
      mode: "period";
      date: string;
      period: "morning" | "afternoon" | "evening";
      timezone: string;
    }
  | { mode: "week"; week_start: string; timezone: string };
export type Meta = {
  id: string;
  version: number;
  created_at: string;
  updated_at: string;
};
export type Task = Meta & {
  kind: "task";
  title: string;
  description: string;
  next_action: string;
  state: "open" | "doing" | "waiting" | "done";
  priority: 0 | 1 | 2 | 3;
  context: string;
  due_date: string | null;
  due_at: string | null;
  estimate_minutes: number | null;
  plan: Plan | null;
  checklist: { id: string; title: string; done: boolean }[];
  completed_at: string | null;
  archived_at: string | null;
};
export type Block = Meta & {
  kind: "block";
  task_id: string;
  start_at: string;
  end_at: string;
  timezone: string;
  state: "planned" | "active" | "done" | "cancelled";
};
export type Appointment = Meta & {
  kind: "appointment";
  title: string;
  start_at: string;
  end_at: string;
  timezone: string;
  location: string;
  notes: string;
  state: "confirmed" | "cancelled";
};
export type Reminder = Meta & {
  kind: "reminder";
  target_type: "task" | "block" | "appointment";
  target_id: string;
  rule:
    | { type: "absolute" }
    | { type: "relative"; minutes_before: number }
    | { type: "plan"; time: string };
  scheduled_at: string;
  state: "scheduled" | "sent" | "cancelled" | "review" | "missed";
  allow_quiet: boolean;
  snoozed_until: string | null;
  delivery_id: string | null;
};
export type Delivery = Meta & {
  kind: "delivery";
  reminder_id: string;
  target_id: string;
  target_type: Reminder["target_type"];
  target_version: number;
  state: "queued" | "sent" | "failed" | "acted";
  attempt: number;
  sent_at: string | null;
  last_error: string | null;
  action: string | null;
};
export type RecordEntry = Task | Block | Appointment | Reminder | Delivery;
export type Preferences = {
  timezone: string;
  focus_minutes: number;
  daily_priorities: number;
  periods: { morning: string; afternoon: string; evening: string };
  quiet_hours: { enabled: boolean; start: string; end: string };
  reminder_limit: number;
};
export type Audit = {
  id: string;
  actor_type: "human" | "bot" | "worker";
  actor_id: string;
  conversation_id: string | null;
  action: string;
  occurred_at: string;
  correlation_id: string;
  changes: { id: string; before: RecordEntry | null; after: RecordEntry }[];
  settings?: {
    before: { preferences: Preferences; allowed_bot_ids: string[] };
    after: { preferences: Preferences; allowed_bot_ids: string[] };
  };
};
export type Organization = {
  schema_version: 1;
  version: number;
  allowed_bot_ids: string[];
  preferences: Preferences;
  records: RecordEntry[];
  audit: Audit[];
};
export type Operation = {
  operation: string;
  idempotency_key?: string;
  id?: string;
  expected_version?: number;
  data?: Record<string, unknown>;
};
export type Result =
  | {
      not_modified?: false;
      organization: Organization;
      record?: RecordEntry;
      duplicate?: boolean;
      warnings?: string[];
      link?: string;
    }
  | { not_modified: true };
export const defaults: Preferences = {
  timezone: "America/Sao_Paulo",
  focus_minutes: 25,
  daily_priorities: 3,
  periods: { morning: "06:00", afternoon: "12:00", evening: "18:00" },
  quiet_hours: { enabled: false, start: "22:00", end: "08:00" },
  reminder_limit: 5,
};
export const columns = [
  "Entrada",
  "Esta semana",
  "Hoje",
  "Fazendo",
  "Aguardando",
  "Concluído",
] as const;
export const periods = {
  morning: "Manhã",
  afternoon: "Tarde",
  evening: "Noite",
};
export function localDate(at: number | string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(at));
  return ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k)!.value)
    .join("-");
}
export function localTime(at: number | string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
}
export function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekStart(date: string): string {
  return addDays(date, -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7));
}
export function column(task: Task, today: string): (typeof columns)[number] {
  if (task.state === "done") return "Concluído";
  if (task.state === "waiting") return "Aguardando";
  if (task.state === "doing") return "Fazendo";
  const plan = task.plan;
  if (!plan) return "Entrada";
  if (plan.mode !== "week" && plan.date === today) return "Hoje";
  const start = weekStart(today),
    date = plan.mode === "week" ? plan.week_start : plan.date;
  return date >= start && date <= addDays(start, 6) ? "Esta semana" : "Entrada";
}
export function planLabel(plan: Plan | null): string {
  return !plan
    ? "Sem planejamento"
    : plan.mode === "week"
      ? `Semana de ${plan.week_start}`
      : `${plan.date}${plan.mode === "period" ? " · " + periods[plan.period] : ""}`;
}
export function zonedInstant(
  date: string,
  time: string,
  timezone: string,
): string {
  const nominal = Date.parse(date + "T" + time + ":00Z");
  let instant = nominal;
  for (let i = 0; i < 4; i++) {
    const observed = Date.parse(
      localDate(instant, timezone) +
        "T" +
        localTime(instant, timezone) +
        ":00Z",
    );
    const delta = nominal - observed;
    if (!delta) break;
    instant += delta;
  }
  if (
    localDate(instant, timezone) !== date ||
    localTime(instant, timezone) !== time
  )
    throw new Error("Esse horário não existe no fuso escolhido.");
  return new Date(instant).toISOString();
}
export function inQuiet(at: number, prefs: Preferences): boolean {
  if (!prefs.quiet_hours.enabled) return false;
  const time = localTime(at, prefs.timezone),
    { start, end } = prefs.quiet_hours;
  return start < end
    ? time >= start && time < end
    : time >= start || time < end;
}
