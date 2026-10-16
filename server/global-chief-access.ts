import { isGlobalChief } from "../shared/global-chief.ts";
import { peerAllowed, type RosterMember } from "./peer-roster.ts";

/** Global recall must not move restricted data to a bot with a broader or different audience. */
export function globalReadBots<T extends RosterMember>(from: T, bots: readonly T[]): T[] {
  if (!isGlobalChief(from)) return [from];
  return bots.filter(bot => bot.id === from.id || (!bot.hidden && peerAllowed(from, bot)));
}

export function globalReadTeams(from: RosterMember, bots: readonly RosterMember[]): string[] {
  if (!isGlobalChief(from)) return [from.section?.trim() || ""];
  const allowed = new Set(globalReadBots(from, bots).map(bot => bot.id));
  const teams = [...new Set(bots.filter(bot => allowed.has(bot.id) && !isGlobalChief(bot)).map(bot => bot.section?.trim() || ""))];
  return teams.filter(team => bots.filter(bot => !isGlobalChief(bot) && (bot.section?.trim() || "") === team)
    .every(bot => allowed.has(bot.id) && bot.memoryEnabled !== false));
}

export async function batchedRecall<T, R>(sources: readonly T[], recall: (source: T) => Promise<R[]>): Promise<R[]> {
  const results: R[] = [];
  for (let offset = 0; offset < sources.length; offset += 4) {
    results.push(...(await Promise.all(sources.slice(offset, offset + 4).map(recall))).flat());
  }
  return results;
}
