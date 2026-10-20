import { uiCopy } from "./ui-copy.ts";
import type { RoutineCronSchedule } from "./routine-schedule.ts";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Describe familiar presets; retain the exact expression for everything else.
 * This is presentation only, never a second parser or source of scheduling truth. */
export function cronScheduleLabel(schedule: RoutineCronSchedule): string {
  const [minute, hour, day, month, weekday] = schedule.expression.trim().split(/\s+/);
  let label = uiCopy("Cron {value1}", { value1: schedule.expression });
  if (/^\d+$/.test(minute ?? "") && /^\d+$/.test(hour ?? "")) {
    const time = `${hour!.padStart(2, "0")}:${minute!.padStart(2, "0")}`;
    const monthDay = /^\d+$/.test(day ?? "") ? Number(day) : null;
    if (weekday === "*" && month === "*") {
      if (day === "*") label = uiCopy("Every day at {value1}", { value1: time });
      else if (day === "L") label = uiCopy("Monthly on the last day at {value1}", { value1: time });
      else if (monthDay !== null) label = uiCopy("Monthly on day {value1} at {value2}", { value1: monthDay, value2: time });
    } else if (weekday === "*" && /^\d+$/.test(month ?? "") && monthDay !== null) {
      const name = MONTHS[Number(month) - 1];
      if (name) label = uiCopy("Yearly on {value1} {value2} at {value3}", { value1: uiCopy(name), value2: monthDay, value3: time });
    } else if (day === "*" && month === "*") {
      if (weekday === "1-5" || weekday?.toUpperCase() === "MON-FRI") label = uiCopy("Every weekday at {value1}", { value1: time });
      else if (/^[0-7]$/.test(weekday ?? "")) label = uiCopy("Weekly on {value1} at {value2}", { value1: uiCopy(WEEKDAYS[Number(weekday) % 7]!), value2: time });
      else {
        const nth = /^([0-7])#([1-5]|L)$/i.exec(weekday ?? "");
        if (nth) {
          const order = nth[2]!.toUpperCase() === "L" ? "last" : ["", "first", "second", "third", "fourth", "fifth"][Number(nth[2])];
          label = uiCopy("Monthly on the {value1} {value2} at {value3}", { value1: uiCopy(order!), value2: uiCopy(WEEKDAYS[Number(nth[1]) % 7]!), value3: time });
        }
      }
    }
  }
  return `${label} · ${schedule.timeZone}`;
}
