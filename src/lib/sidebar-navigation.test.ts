import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import { navigationMatches, navigationTeams, readSidebarNavigation, recentNavigationBots, saveSidebarNavigation, SIDEBAR_NAVIGATION_KEY } from "./sidebar-navigation";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, name: id, title: "", description: "", threadId: id + "-thread", messages: [],
  modelSelection: { instanceId: "fake", model: "test" }, color: "green", notifications: false, unread: false, ...extra,
});
const room = (id: string, extra: Partial<Group> = {}): Group => ({
  id, name: id, threadId: id + "-thread", memberIds: [], messages: [], createdAt: 1,
  defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, ...extra,
});
afterEach(() => vi.unstubAllGlobals());

describe("global sidebar navigation", () => {
  it("finds words across a bot's name, team and role without case or accent differences", () => {
    expect(navigationMatches(" REDACAO  marketing ", ["Nina", "Marketing", "Redação"])).toBe(true);
    expect(navigationMatches("financeiro luna", ["Luna", "Financeiro", "Contas a pagar"])).toBe(true);
    expect(navigationMatches("financeiro luna", ["Luna", "Marketing", "Chefe do time"])).toBe(false);
  });

  it("indexes only visible members, keeps empty teams and leaves the Global Chief outside General", () => {
    const teams = navigationTeams([
      bot("chief", { globalChief: true, chiefOfStaff: true }), bot("general"),
      bot("Nina", { section: "Marketing" }), bot("hidden", { section: "Private", hidden: true }),
    ], [room("Public", { section: "Marketing" }), room("DM", { dm: true })], ["Marketing", "Empty"]);
    expect(teams.map(team => team.key)).toEqual(["Marketing", "Empty", ""]);
    expect(teams.flatMap(team => team.bots).map(bot => bot.id)).toEqual(["Nina", "general"]);
    expect(teams.find(team => team.key === "Marketing")!.groups.map(group => group.id)).toEqual(["Public"]);
    expect(teams.find(team => team.key === "Empty")!.bots).toEqual([]);
  });

  it("counts a bot waiting on any thread once, ahead of its simultaneous work", () => {
    const teams = navigationTeams([bot("multi", { section: "Work", busy: true, tasks: [
      { threadId: "one", title: "Approval", createdAt: 1, activity: "waiting-on-you" },
      { threadId: "two", title: "Approval too", createdAt: 2, activity: "waiting-on-you" },
    ] }), bot("worker", { section: "Work", busy: true }), bot("unread", { section: "Work", unread: true })], []);
    expect(teams[0]).toMatchObject({ waiting: 1, working: 1, unread: 1 });
  });

  it("prioritizes actual visits then the latest thread activity and omits archived/global bots", () => {
    const bots = [bot("visited"), bot("older", { messages: [{ id: "m", role: "user", kind: "text", text: "hello", at: 5 }] }),
      bot("newer", { tasks: [{ threadId: "t", title: "Latest", createdAt: 1, updatedAt: 50 }] }),
      bot("hidden", { hidden: true }), bot("global", { globalChief: true, chiefOfStaff: true })];
    expect(recentNavigationBots(bots, ["missing", "visited", "hidden"]).map(bot => bot.id)).toEqual(["visited", "newer", "older"]);
    expect(bots.map(bot => bot.id)).toEqual(["visited", "older", "newer", "hidden", "global"]);
  });

  it("restores General's empty key and bounds malformed, duplicate or oversized preference arrays", () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ tab: "teams", team: "", favorites: ["Marketing", "Marketing", 9], recent: Array.from({ length: 100 }, (_, n) => "bot-" + n) }) });
    expect(readSidebarNavigation()).toMatchObject({ tab: "teams", team: "", favorites: ["Marketing"] });
    expect(readSidebarNavigation().recent).toHaveLength(40);
  });

  it("uses Recent when storage is absent, invalid or unavailable", () => {
    for (const getItem of [() => "broken", () => null, () => { throw new Error("denied"); }]) {
      vi.stubGlobal("localStorage", { getItem });
      expect(readSidebarNavigation()).toEqual({ tab: "recent", team: null, favorites: [], recent: [] });
    }
  });

  it("saves presentation preferences without depending on writable storage", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    const value = { tab: "bots" as const, team: null, favorites: ["Marketing"], recent: ["nina"] };
    saveSidebarNavigation(value);
    expect(setItem).toHaveBeenCalledWith(SIDEBAR_NAVIGATION_KEY, JSON.stringify(value));
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("denied"); } });
    expect(() => saveSidebarNavigation(value)).not.toThrow();
  });
});
