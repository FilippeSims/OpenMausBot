import { expect, it } from "vitest";
import { isGlobalChief, sameChiefOffice } from "../shared/global-chief.ts";
import { globalReadBots, globalReadTeams, batchedRecall } from "./global-chief-access.ts";
import { canAccessTeam, coordinatorSupervises, type RosterMember } from "./peer-roster.ts";
import { chiefOfStaffSystemPrompt } from "./chief-of-staff.ts";
import { chiefForBot } from "./incidents.ts";
import { catalogProfileFromEnv, availableTools } from "./drivers/agents-catalog.ts";

const chief: RosterMember = { id: "global", name: "Director", globalChief: true, chiefOfStaff: true };
const normal: RosterMember = { id: "normal", name: "General Chief", chiefOfStaff: true };
const lead: RosterMember = { id: "lead", name: "Engineering Chief", section: "Engineering", chiefOfStaff: true };
const worker: RosterMember = { id: "worker", name: "Developer", section: "Engineering" };

it("requires an explicit independent role and keeps the General office separate", () => {
  expect(isGlobalChief(chief)).toBe(true);
  for (const bot of [normal, { ...chief, section: "Engineering" }, { ...chief, chiefOfStaff: false }]) expect(isGlobalChief(bot)).toBe(false);
  expect(sameChiefOffice(chief, normal)).toBe(false);
  const replacement = { ...chief, id: "replacement" };
  expect(sameChiefOffice(chief, replacement)).toBe(true);
  expect(canAccessTeam(chief, "Future team")).toBe(true);
  expect(canAccessTeam(worker, "Future team")).toBe(false);
  expect(coordinatorSupervises(chief, normal)).toBe(true);
  expect(coordinatorSupervises(chief, lead)).toBe(true);
});

it("limits global recall by audience, hidden bots, peer lists and team memory settings", () => {
  const privateBot = { id: "private", name: "Private", section: "Finance", visibility: "admins" };
  const archived = { id: "archived", name: "Archived", section: "Old", hidden: true };
  const disabled = { id: "disabled", name: "Off", section: "No notes", memoryEnabled: false };
  const bots = [chief, normal, lead, worker, privateBot, archived, disabled];
  expect(globalReadBots(chief, bots).map(bot => bot.id)).toEqual(["global", "normal", "lead", "worker", "disabled"]);
  expect(globalReadTeams(chief, bots)).toEqual(["", "Engineering"]);
  expect(globalReadBots({ ...chief, peers: [lead.id] }, bots).map(bot => bot.id)).toEqual([chief.id, lead.id]);
  expect(globalReadTeams({ ...chief, peers: [lead.id] }, bots)).toEqual([]);
  expect(globalReadBots(worker, bots)).toEqual([worker]);
});

it("uses team chiefs first and routes their incidents upward without moving restricted context", () => {
  const bots = [chief, normal, lead, worker];
  const prompt = chiefOfStaffSystemPrompt(chief.id, bots, true);
  expect(prompt).toContain("You belong to no team or group");
  expect(prompt).toContain("through its Chief of Staff");
  expect(prompt).toContain("[team: Engineering]");
  expect(prompt).toContain("session_read");
  expect(chiefForBot(bots, worker)?.id).toBe(lead.id);
  expect(chiefForBot(bots, lead)?.id).toBe(chief.id);
  expect(chiefForBot(bots, { ...lead, visibility: "admins" })).toBeNull();
});

it("bounds recall concurrency while retaining all sources", async () => {
  let running = 0;
  let peak = 0;
  const result = await batchedRecall(Array.from({ length: 11 }, (_, i) => i), async source => {
    peak = Math.max(peak, ++running);
    await Promise.resolve();
    running--;
    return [source];
  });
  expect(peak).toBe(4);
  expect(result).toEqual(Array.from({ length: 11 }, (_, i) => i));
});

it("advertises workspace recall only for an explicitly mounted global Chief", () => {
  const global = catalogProfileFromEnv({ OMB_GLOBAL_CHIEF: "1", OMB_CHIEF_OF_STAFF: "1" });
  const ordinary = catalogProfileFromEnv({ OMB_GLOBAL_CHIEF: "1" });
  expect(global.globalChief).toBe(true);
  expect(ordinary.globalChief).toBe(false);
  expect(catalogProfileFromEnv({ OMB_GLOBAL_CHIEF: "1", OMB_CHIEF_OF_STAFF: "1", OMB_CLOUD_HOME: "1" }).globalChief).toBe(false);
  expect(availableTools(global).find(tool => tool.name === "session_search")?.description).toContain("authorized workspace");
  expect(availableTools(ordinary).find(tool => tool.name === "session_search")?.description).toContain("OWN");
});
