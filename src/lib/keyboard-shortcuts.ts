import { t as uiText } from "@/lib/i18n";
import type { SendKey } from "./send-key";

export interface ShortcutItem {
  id: string;
  description: string;
  macKeys: string[];
  winKeys: string[];
}

export interface ShortcutGroup {
  category: string;
  items: ShortcutItem[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    category: "Navigation",
    items: [
      {
        id: "command-palette",
        get description() { return uiText("ui.keyboard-shortcuts.f29c774ad3"); },
        macKeys: ["⌘", "K"],
        winKeys: ["Ctrl", "K"],
      },
      {
        id: "new-bot",
        get description() { return uiText("ui.keyboard-shortcuts.163441c227"); },
        macKeys: ["⌘", "N"],
        winKeys: ["Ctrl", "N"],
      },
      {
        id: "jump-bot",
        get description() { return uiText("ui.keyboard-shortcuts.403908ee0b"); },
        macKeys: ["⌘", "1–9"],
        winKeys: ["Ctrl", "1–9"],
      },
      {
        id: "switch-bot",
        get description() { return uiText("ui.keyboard-shortcuts.7a255372e7"); },
        macKeys: ["⌘", "⇧", "[ / ]"],
        winKeys: ["Ctrl", "Shift", "[ / ]"],
      },
      {
        id: "find-conversation",
        get description() { return uiText("chat.find"); },
        macKeys: ["⌘", "F"],
        winKeys: ["Ctrl", "F"],
      },
    ],
  },
  {
    category: "Chat & Composer",
    items: [
      {
        id: "send-message",
        get description() { return uiText("composer.send.message"); },
        macKeys: ["Return"],
        winKeys: ["Enter"],
      },
      {
        id: "new-line",
        get description() { return uiText("ui.keyboard-shortcuts.3ac14e0db4"); },
        macKeys: ["⇧", "Return"],
        winKeys: ["Shift", "Enter"],
      },
      {
        id: "edit-last-message",
        get description() { return uiText("ui.keyboard-shortcuts.74651c7ee5"); },
        macKeys: ["↑"],
        winKeys: ["↑"],
      },
      {
        id: "close-panel",
        get description() { return uiText("ui.keyboard-shortcuts.8b1df2f04c"); },
        macKeys: ["Esc"],
        winKeys: ["Esc"],
      },
      {
        id: "shortcuts-cheat-sheet",
        get description() { return uiText("ui.keyboard-shortcuts.904ba9f337"); },
        macKeys: ["⌘", "/"],
        winKeys: ["Ctrl", "/"],
      },
    ],
  },
  {
    category: "Calls",
    items: [
      {
        id: "live-call-mute",
        get description() { return uiText("ui.keyboard-shortcuts.ecd34ed4f5"); },
        macKeys: ["⌘", "⇧", "M"],
        winKeys: ["Ctrl", "Shift", "M"],
      },
      {
        id: "live-call-hang-up",
        get description() { return uiText("ui.keyboard-shortcuts.1df22fbd09"); },
        macKeys: ["⌘", "⇧", "H"],
        winKeys: ["Ctrl", "Shift", "H"],
      },
    ],
  },
  {
    category: "Management & Groups",
    items: [
      {
        id: "save-bulletin",
        get description() { return uiText("ui.keyboard-shortcuts.4eeecdeb90"); },
        macKeys: ["⌘", "Return"],
        winKeys: ["Ctrl", "Enter"],
      },
      {
        id: "reorder-section",
        get description() { return uiText("ui.keyboard-shortcuts.19545e052b"); },
        macKeys: ["⌥", "↑ / ↓"],
        winKeys: ["Alt", "↑ / ↓"],
      },
    ],
  },
];

type Keys = Pick<ShortcutItem, "macKeys" | "winKeys">;
const ENTER: Keys = { macKeys: ["Return"], winKeys: ["Enter"] };
const SHIFT_ENTER: Keys = { macKeys: ["⇧", "Return"], winKeys: ["Shift", "Enter"] };
const SEND_ROWS: Record<Exclude<SendKey, "enter">, [Keys, Keys]> = {
  "shift-enter": [SHIFT_ENTER, ENTER],
  "mod-enter": [{ macKeys: ["⌘", "Return"], winKeys: ["Ctrl", "Enter"] }, ENTER],
};

export function shortcutGroupsFor(sendKey: SendKey): readonly ShortcutGroup[] {
  if (sendKey === "enter") return SHORTCUT_GROUPS;
  const [send, newLine] = SEND_ROWS[sendKey];
  return SHORTCUT_GROUPS.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.id === "send-message" ? { ...item, ...send }
        : item.id === "new-line" ? { ...item, ...newLine }
          : item),
  }));
}

export function shouldOpenKeyboardShortcuts(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.altKey) return false;
  const helpKey = event.key === "?" && !event.metaKey && !event.ctrlKey;
  const helpChord = event.key === "/" && (event.metaKey || event.ctrlKey) && !event.shiftKey;
  if (!helpKey && !helpChord) return false;
  const target = event.target;
  return !(target instanceof HTMLElement && (
    target.isContentEditable || target.closest("input, textarea, select, dialog, [role=dialog]")
  ));
}

export function isMacPlatform(): boolean {
  if (typeof window !== "undefined" && window.ogb?.platform) {
    return window.ogb.platform === "darwin";
  }
  if (typeof navigator !== "undefined" && navigator.userAgent) {
    return navigator.userAgent.includes("Mac");
  }
  return true;
}

export function shortcutKeysForPlatform(
  item: ShortcutItem,
  isMac: boolean = isMacPlatform(),
): string[] {
  return isMac ? item.macKeys : item.winKeys;
}

export function filterShortcutGroups(
  groups: readonly ShortcutGroup[],
  query: string,
  isMac: boolean = isMacPlatform(),
): ShortcutGroup[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...groups];

  return groups
    .map((group) => {
      const filteredItems = group.items.filter((item) => {
        const keys = shortcutKeysForPlatform(item, isMac).join(" ").toLowerCase();
        return (
          item.description.toLowerCase().includes(normalized) ||
          group.category.toLowerCase().includes(normalized) ||
          keys.includes(normalized)
        );
      });
      return { ...group, items: filteredItems };
    })
    .filter((group) => group.items.length > 0);
}
