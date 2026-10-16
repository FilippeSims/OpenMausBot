export interface ChiefRole {
  globalChief?: boolean;
  chiefOfStaff?: boolean;
  section?: string;
}

/** Global authority is explicit and belongs to an independent Chief, never to a team member. */
export function isGlobalChief(bot: ChiefRole | null | undefined): boolean {
  return bot?.globalChief === true && bot.chiefOfStaff === true && !bot.section?.trim();
}

export function sameChiefOffice(left: ChiefRole, right: ChiefRole): boolean {
  return isGlobalChief(left) === isGlobalChief(right) &&
    (isGlobalChief(left) || (left.section?.trim() || "") === (right.section?.trim() || ""));
}
