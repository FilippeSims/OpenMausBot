import { activeLocale as uiLocale } from "@/lib/i18n";
import { activeLocale, t as uiText } from "@/lib/i18n";
import { atLocalTime } from "@/lib/routine-calendar";
import type { RoutineSchedule } from "@/lib/routines";
import { cronScheduleLabel } from "../../shared/cron-label";

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function dayNames(): readonly string[] {
  if (activeLocale() === "en") return DAY_NAMES;
  return DAY_NAMES.map((_, day) => new Intl.DateTimeFormat(activeLocale(), { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + day))));
}

export function niceTime(at: number): string {
  return new Date(at).toLocaleTimeString(uiLocale(), { hour: "numeric", minute: "2-digit" });
}

export function niceDate(at: number): string {
  return new Date(at).toLocaleDateString(uiLocale(), { weekday: "long", month: "long", day: "numeric" });
}

export function whenLabel(at: number): string {
  const date = new Date(at);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay ? niceTime(at) : date.toLocaleDateString(uiLocale(), { month: "short", day: "numeric" });
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 60 === 0) return uiText("schedule.durationHours", { hours: minutes / 60 });
  return uiText("schedule.durationHoursMinutes", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function intervalLabel(minutes: number): string {
  if (minutes < 60) return uiText("schedule.everyMinutes", { minutes });
  if (minutes === 60) return uiText("ui.schedule-label.a4bac4655d");
  if (minutes % 60 === 0) return uiText("schedule.everyHours", { hours: minutes / 60 });
  return uiText("schedule.everyHoursMinutes", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

function intervalRestrictions(schedule: Extract<RoutineSchedule, { type: "interval" }>): string[] {
  const details: string[] = [];
  if (schedule.weekdays && schedule.weekdays.length < 7) {
    details.push(schedule.weekdays.join(",") === "1,2,3,4,5"
      ? uiText("schedule.weekdays")
      : schedule.weekdays.map((day) => dayNames()[day]).join(", "));
  }
  if (schedule.window) {
    const wallTime = (time: string) => {
      const [hour, minute] = time.split(":").map(Number);
      return niceTime(new Date(2000, 0, 1, hour, minute).getTime());
    };
    details.push(`${wallTime(schedule.window.start)}–${wallTime(schedule.window.end)}`);
  }
  if (schedule.endsAt != null) {
    details.push(uiText("schedule.until", { date: new Date(schedule.endsAt).toLocaleDateString(activeLocale(), { month: "short", day: "numeric", year: "numeric" }) }));
  }
  return details;
}

export function scheduleLabel(schedule: RoutineSchedule | { type: "once"; at: number } | { type: "daily"; time: string; weekdays: number[] }): string {
  if (schedule.type === "cron") return cronScheduleLabel(schedule);
  if (schedule.type === "once") return `${niceDate(schedule.at)}, ${niceTime(schedule.at)}`;
  if (schedule.type === "interval") {
    return [intervalLabel(schedule.everyMinutes), ...intervalRestrictions(schedule)].join(" · ");
  }
  const days = schedule.weekdays;
  const label = days.length === 7
    ? uiText("computer.routine.everyDay")
    : days.join(",") === "1,2,3,4,5"
      ? uiText("ui.schedule-label.88bbcc6677")
      : days.length === 1
        ? uiText("ui.schedule-label.d6b28e1a9c", { value1: String(dayNames()[days[0]!]) })
        : days.map((day) => dayNames()[day]).join(", ");
  return uiText("schedule.labelAtTime", { label, time: niceTime(atLocalTime(Date.now(), schedule.time)) });
}

export function scheduleSentence(schedule: RoutineSchedule): string {
  if (schedule.type === "cron") return cronScheduleLabel(schedule);
  if (schedule.type === "interval") {
    const label = intervalLabel(schedule.everyMinutes);
    const lowercase = label.replace(/^Every /, "every ");
    const withMinutes = lowercase.replace(/(\d+) min(?!ute)/g, "$1 minutes");
    const cadence = withMinutes.replace(/(\d+) hr(?!our)/g, (_match, num) => {
      return num === "1" ? "1 hour" : `${num} hours`;
    });
    return [cadence, ...intervalRestrictions(schedule)].join(" · ");
  }
  if (schedule.type === "once") {
    return uiText("ui.schedule-label.92f25ab6b2", { value1: String(niceDate(schedule.at)), value2: String(niceTime(schedule.at)) });
  }
  const days = schedule.weekdays;
  const timeStr = niceTime(atLocalTime(Date.now(), schedule.time));

  if (days.length === 7) {
    return uiText("ui.schedule-label.bf1bf96e9b", { value1: String(timeStr) });
  }
  if (days.join(",") === "1,2,3,4,5") {
    return uiText("ui.schedule-label.1fde2eeac2", { value1: String(timeStr) });
  }
  if (days.length === 1) {
    return uiText("ui.schedule-label.0cdd9543a4", { value1: String(dayNames()[days[0]!]), value2: String(timeStr) });
  }

  return uiText("schedule.labelAtTime", { label: days.map((day) => dayNames()[day]).join(", "), time: timeStr });
}
