import type { Bot, Group } from "@/state/store";
import { isGlobalChief } from "../../shared/global-chief";

export type NavigationTab = "recent" | "teams" | "bots";
export interface SidebarNavigationPreferences {
  tab: NavigationTab;
  team: string | null;
  favorites: string[];
  recent: string[];
}

export const SIDEBAR_TEAM_RENAMED_EVENT = "omb:sidebar-team-renamed";
export const SIDEBAR_NAVIGATION_KEY = "openmausbot.sidebarNavigation.v1";

const strings = (value: unknown, limit: number) => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length <= 256))].slice(0, limit) : [];

export function readSidebarNavigation(): SidebarNavigationPreferences {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(SIDEBAR_NAVIGATION_KEY) ?? "null");
    return {
      tab: value?.tab === "teams" || value?.tab === "bots" ? value.tab : "recent",
      team: typeof value?.team === "string" && value.team.length <= 256 ? value.team : null,
      favorites: strings(value?.favorites, 100), recent: strings(value?.recent, 40),
    };
  } catch {
    return { tab: "recent", team: null, favorites: [], recent: [] };
  }
}

export function saveSidebarNavigation(value: SidebarNavigationPreferences): void {
  try { globalThis.localStorage?.setItem(SIDEBAR_NAVIGATION_KEY, JSON.stringify(value)); } catch { /* Storage can be disabled by the browser. */ }
}

export function navigationText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function navigationMatches(query: string, values: string[]): boolean {
  const text = navigationText(values.join(" "));
  return navigationText(query).split(" ").every(word => text.includes(word));
}

export interface NavigationTeam {
  key: string;
  bots: Bot[];
  groups: Group[];
  waiting: number;
  working: number;
  unread: number;
}

export function navigationTeams(bots: Bot[], groups: Group[], sections: string[] = []): NavigationTeam[] {
  const index = new Map<string, { bots: Bot[]; groups: Group[] }>();
  const team = (key: string) => {
    let value = index.get(key);
    if (!value) { value = { bots: [], groups: [] }; index.set(key, value); }
    return value;
  };
  for (const section of sections) team(section);
  for (const bot of bots) if (!bot.hidden && !isGlobalChief(bot)) team(bot.section?.trim() ?? "").bots.push(bot);
  for (const group of groups) if (!group.dm) team(group.section?.trim() ?? "").groups.push(group);
  return [...index].map(([key, { bots: members, groups: rooms }]) => {
    const waiting = (bot: Bot) => bot.activity === "waiting-on-you" || bot.tasks?.some(task => task.activity === "waiting-on-you");
    return {
      key, bots: members, groups: rooms,
      waiting: members.filter(waiting).length,
      working: members.filter(bot => !waiting(bot) && (bot.busy || bot.tasks?.some(task => task.busy))).length,
      unread: members.filter(bot => bot.unread || bot.tasks?.some(task => task.unread)).length + rooms.filter(group => group.unread).length,
    };
  });
}

export function recentNavigationBots(bots: Bot[], visits: string[]): Bot[] {
  const recency = new Map(bots.map(bot => [bot.id, Math.max(
    bot.messages.reduce((latest, message) => Math.max(latest, message.at), 0),
    (bot.tasks ?? []).reduce((latest, task) => Math.max(latest, task.updatedAt ?? task.createdAt), 0),
  )]));
  const ranks = new Map(visits.map((id, index) => [id, index]));
  return bots.filter(bot => !bot.hidden && !isGlobalChief(bot)).sort((left, right) => {
    const a = ranks.get(left.id), b = ranks.get(right.id);
    if (a !== undefined || b !== undefined) return (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER);
    return (recency.get(right.id) ?? 0) - (recency.get(left.id) ?? 0) || left.name.localeCompare(right.name);
  });
}

export function focusSidebarNavigationSearch(): boolean {
  const input = globalThis.document?.querySelector<HTMLInputElement>("[data-sidebar-navigation-search]");
  if (!input) return false;
  const rect = input.getBoundingClientRect();
  if (rect.width === 0 || rect.right <= 0 || rect.left >= window.innerWidth) return false;
  input.focus(); input.select();
  return true;
}
