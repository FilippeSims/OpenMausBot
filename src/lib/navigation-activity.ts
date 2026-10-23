import type { Bot, Group } from "@/state/store";
import { roomThreadSpeakerId, roomThreadWorking } from "./room-threads";

export type NavigationBotStatus = "working" | "waiting" | "working-waiting" | "coordinating" | "computer" | "queued" | "offline" | "idle";
export type NavigationActivityFilter = "all" | "active" | "working" | "waiting";

export function navigationBotActivity(bot: Bot, groups: Group[] = [], queued: Record<string, unknown[]> = {}) {
  const tasks = bot.tasks?.length ? bot.tasks : [bot];
  const units = tasks.some(task => task.threadId === bot.threadId) ? tasks : [bot, ...tasks];
  const waiting = units.some(task => task.activity === "waiting-on-you");
  const coordinating = units.some(task => task.waitingForTeammates);
  const computer = units.some(task => task.activity === "parked.computer");
  const pending = units.some(task => queued[task.threadId]?.length);
  const inRoom = groups.some(group => [group.threadId, ...group.tasks?.map(task => task.threadId) ?? []]
    .some(threadId => roomThreadSpeakerId(group, threadId) === bot.id && roomThreadWorking(group, threadId)));
  const working = inRoom || units.some(task => task.activity === "working" ||
    (task.busy && task.activity !== "waiting-on-you" && task.activity !== "parked.computer" && !task.waitingForTeammates));
  const active = working || waiting || coordinating || computer || pending;
  const status: NavigationBotStatus = working && waiting ? "working-waiting" : waiting ? "waiting" : working ? "working"
    : coordinating ? "coordinating" : computer ? "computer" : pending ? "queued"
      : bot.activity === "dead" || bot.activity === "no-signal" ? "offline" : "idle";
  return { status, working, waiting, active };
}

export type NavigationBotActivity = ReturnType<typeof navigationBotActivity>;

export function navigationActivityMatches(activity: NavigationBotActivity, filter: NavigationActivityFilter): boolean {
  return filter === "all" || activity[filter];
}

export function navigationActivityRank(activity: NavigationBotActivity): number {
  return activity.working ? 0 : activity.waiting ? 1 : activity.active ? 2 : 3;
}

export function navigationRoomActive(group: Group): boolean {
  return [group.threadId, ...group.tasks?.map(task => task.threadId) ?? []].some(threadId => roomThreadWorking(group, threadId)) ||
    Boolean(group.queue?.some(entry => entry.state === "queued"));
}
