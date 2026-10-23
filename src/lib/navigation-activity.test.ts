import { describe, expect, it } from "vitest";
import type { Bot, Group } from "@/state/store";
import { navigationActivityMatches, navigationBotActivity } from "./navigation-activity";
import { navigationTeams } from "./sidebar-navigation";

const bot = (extra: Partial<Bot> = {}): Bot => ({ id: "designer", name: "Luna", threadId: "main", title: "Designer", description: "", color: "green",
  messages: [], notifications: false, unread: false, modelSelection: { instanceId: "test", model: "test" }, section: "Estúdio", ...extra });
const room = (extra: Partial<Group> = {}): Group => ({ id: "room", threadId: "room-main", name: "Campaign", memberIds: ["designer"], createdAt: 1,
  defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, messages: [], section: "Campanhas", ...extra });

describe("live navigation activity", () => {
  it("shows a waiting conversation and a second working conversation on the same bot", () => {
    const activity = navigationBotActivity(bot({ activity: "waiting-on-you", busy: true, tasks: [
      { threadId: "main", title: "Approval", createdAt: 1, activity: "waiting-on-you", busy: true },
      { threadId: "second", title: "Drawing", createdAt: 2, activity: "working", busy: true },
    ] }));
    expect(activity).toEqual({ status: "working-waiting", working: true, waiting: true, active: true });
    expect(navigationActivityMatches(activity, "waiting")).toBe(true);
    expect(navigationActivityMatches(activity, "working")).toBe(true);
  });

  it("does not label an approval, computer wait or teammate wait as working", () => {
    for (const extra of [{ activity: "waiting-on-you" as const }, { activity: "parked.computer" as const }, { waitingForTeammates: true }]) {
      const activity = navigationBotActivity(bot({ busy: true, ...extra }));
      expect(activity.active).toBe(true); expect(activity.working).toBe(false);
    }
    expect(navigationBotActivity(bot({ activity: "waiting-on-you", busy: true })).status).toBe("waiting");
  });

  it("includes work in another group thread and returns to available after it settles", () => {
    const member = bot();
    const group = room({ tasks: [{ threadId: "room-other", title: "Other thread", createdAt: 1, working: true, busyBotId: member.id }] });
    expect(navigationBotActivity(member, [group]).status).toBe("working");
    const teams = navigationTeams([member], [group]);
    expect(teams.find(team => team.key === "Estúdio")).toMatchObject({ active: true, working: 1 });
    expect(teams.find(team => team.key === "Campanhas")).toMatchObject({ active: true, activeRooms: 1 });
    expect(navigationBotActivity(member, [room()]).status).toBe("idle");
  });

  it("keeps queued work visible without counting unread messages as running work", () => {
    const member = bot({ unread: true });
    expect(navigationBotActivity(member)).toMatchObject({ active: false, status: "idle" });
    const queued = { main: [{}] };
    expect(navigationBotActivity(member, [], queued)).toMatchObject({ active: true, status: "queued", working: false });
    expect(navigationTeams([member], [], [], queued)[0]).toMatchObject({ active: true, working: 0 });
    expect(navigationBotActivity(bot({ activity: "dead" })).status).toBe("offline");
  });

  it("omits archived bots and the independent Global Chief from team activity counts", () => {
    const teams = navigationTeams([bot({ hidden: true, busy: true }), bot({ id: "boss", section: undefined, globalChief: true, chiefOfStaff: true, busy: true })], [], ["Estúdio"]);
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ active: false, activeBots: [], working: 0 });
  });
});
