import { t as uiText } from "@/lib/i18n";
export const SKIN_IDS = [
  "midnight",
  "atelier",
  "foundry",
  "lagoon",
  "graphite",
  "linen",
  "dusk",
  "daylight",
  "meadow",
] as const;
export type SkinId = (typeof SKIN_IDS)[number];

export type Skin = {
  id: SkinId;
  name: string;
  tagline: string;
};

export const SKINS: readonly Skin[] = [
  { id: "midnight", name: "Midnight", get tagline() { return uiText("ui.skins.aec68dd852"); } },
  { id: "atelier", name: "Atelier", get tagline() { return uiText("ui.skins.1a5aafebac"); } },
  { id: "foundry", name: "Foundry", get tagline() { return uiText("ui.skins.278d978568"); } },
  { id: "lagoon", name: "Lagoon", get tagline() { return uiText("ui.skins.0df79e1400"); } },
  { id: "graphite", name: "Graphite", get tagline() { return uiText("ui.skins.6b42dd1749"); } },
  { id: "linen", name: "Linen", get tagline() { return uiText("ui.skins.1fa25a3929"); } },
  { id: "dusk", name: "Dusk", get tagline() { return uiText("ui.skins.b440656689"); } },
  { id: "daylight", name: "Daylight", get tagline() { return uiText("ui.skins.5600d23afd"); } },
  { id: "meadow", name: "Meadow", get tagline() { return uiText("ui.skins.a30f62bfd6"); } },
];

export const DEFAULT_SKIN: SkinId = "midnight";

const KEY = "omb-skin";

function isSkinId(value: unknown): value is SkinId {
  return SKIN_IDS.includes(value as SkinId);
}

// With storage blocked the localStorage getter itself throws, and `typeof` alone doesn't shield it.
function getStore(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readSkin(): SkinId {
  try {
    const stored = getStore()?.getItem(KEY);
    return isSkinId(stored) ? stored : DEFAULT_SKIN;
  } catch {
    return DEFAULT_SKIN;
  }
}

export function applySkin(id: SkinId): void {
  document.documentElement.dataset.skin = id;
  try {
    getStore()?.setItem(KEY, id);
  } catch {
  }
  // On Windows the caption buttons sit in a native overlay the main process paints, out of CSS's reach.
  try {
    void window.ogb?.applySkin?.(id)?.catch(() => undefined);
  } catch {
  }
}
