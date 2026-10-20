import { Children, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({
  values: [] as unknown[], index: 0, effects: [] as EffectCallback[], advanced: false,
  state: {} as AppState, dispatch: vi.fn(), storage: new Map<string, string>(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(fixture.values[index]) : next;
    }];
  },
  useId: () => "sidebar-fixture",
  useRef: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = { current: initial };
    return fixture.values[index];
  },
  useCallback: (callback: unknown) => callback,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: (effect: EffectCallback) => { fixture.effects.push(effect); },
  useLayoutEffect: () => {},
}));
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }));
vi.mock("./MenuMotion", () => ({
  useMenuMotion: (open: boolean) => ({ shown: open, closing: false, className: "", exitProps: {} }),
  useHeldMenuMotion: (value: unknown) => ({ shown: value !== null, value, closing: false, className: "", exitProps: {} }),
}));
vi.mock("./DesktopCapabilities", async () => {
  const { initialDesktopCapabilities } = await import("@/lib/desktop");
  return { useDesktopCapabilities: () => ({ capabilities: initialDesktopCapabilities() }) };
});
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.advanced }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }) };
});

import { initialState } from "@/state/store";
import { BOTS_SECTION_ID, CHANNELS_SECTION_ID, userSectionId } from "@/lib/sidebar-layout";
import { SIDEBAR_DENSITY_KEY, SIDEBAR_WIDTH_KEY, SIMPLE_SIDEBAR_WIDTH_KEY, setSidebarDensity } from "@/lib/sidebar-preferences";
import { SidebarNavigator } from "./SidebarNavigator";
import { Sidebar, TeamMenuItems } from "./Sidebar";
import { SidebarResizeHandle } from "./SidebarResizeHandle";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { SidebarEdgeToggle, SidebarSearchPill, SidebarSearchToggle } from "./SidebarSimpleTop";
import { SidebarRailSeparator, SimpleRailFooter } from "./SidebarSimpleRail";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name: id, title: "", description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "fake", model: "m" }, messages: [], ...extra,
});
const room: Group = {
  id: "room", threadId: "room-thread", name: "Launch room", memberIds: ["atlas"], messages: [],
  defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 1,
};

type Props = { children?: ReactNode; className?: string; style?: Record<string, string>; [key: string]: unknown };
function nodes(value: ReactNode): ReactElement<Props>[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement<Props>(child)) return [];
    if (child.type === SidebarNavigator) {
      const result = SidebarNavigator(child.props as Parameters<typeof SidebarNavigator>[0]);
      return [child, result, ...nodes(result.props.children)];
    }
    return [child, ...nodes(child.props.children)];
  });
}
function render(collapseToIcons = false) {
  fixture.index = 0;
  fixture.effects = [];
  const root = Sidebar({ open: false, onClose: () => {}, collapseToIcons }) as ReactElement<Props>;
  return { root, tree: [root, ...nodes(root.props.children)] };
}
const sectionOrder = (tree: ReactElement<Props>[]) => tree.map((node) => node.props["data-sidebar-section-id"]).filter(Boolean);
const headers = (tree: ReactElement<Props>[]) => tree.filter((node) => node.type === SidebarSectionHeader) as ReactElement<Parameters<typeof SidebarSectionHeader>[0]>[];
const listedBots = (tree: ReactElement<Props>[]) => tree.map((node) => (node.props.bot as Bot | undefined)?.id).filter(Boolean);

beforeEach(() => {
  fixture.values = [];
  fixture.advanced = false;
  fixture.storage = new Map();
  fixture.dispatch.mockClear();
  fixture.state = {
    ...initialState,
    bots: [bot("atlas"), bot("bea"), bot("dodo", { section: "Work" })],
    groups: [room],
    sections: ["Work"],
  };
  vi.stubGlobal("window", Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 800, ogb: undefined, setTimeout, clearTimeout }));
  vi.stubGlobal("document", { body: {} });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => fixture.storage.get(key) ?? null,
    setItem: (key: string, value: string) => { fixture.storage.set(key, value); },
    removeItem: (key: string) => { fixture.storage.delete(key); },
  });
});
afterEach(() => {
  setSidebarDensity("comfortable");
  vi.unstubAllGlobals();
});

describe("Focused sidebar navigation", () => {
  const click = (node: ReactElement<Props>, event?: unknown) => (node.props.onClick as (event?: unknown) => void)(event);
  const tab = (name: string) => render().tree.find(node => node.props.role === "tab" && node.props.children === name)!;
  const button = (name: string) => render().tree.find(node => node.type === "button" && node.props["aria-label"] === name)!;
  const search = (query: string) => {
    const input = render().tree.find(node => node.props["data-sidebar-navigation-search"] !== undefined)!;
    (input.props.onChange as (event: unknown) => void)({ target: { value: query } });
  };

  it("keeps global search and all three views visible beside the recent bots", () => {
    expect(button("Search team, bot or role…")).toBeUndefined();
    expect(render().tree.some(node => node.type === "input" && node.props["aria-label"] === "Search team, bot or role…")).toBe(true);
    expect(["Recent", "Teams", "Bots"].map(name => Boolean(tab(name)))).toEqual([true, true, true]);
    expect(listedBots(render().tree)).toEqual(["atlas", "bea", "dodo"]);
    expect(sectionOrder(render().tree)).toEqual([]);
  });

  it("focuses one team and goes back without expanding a tree of teams", () => {
    click(tab("Teams"));
    expect(listedBots(render().tree)).toEqual([]);
    click(button("Open Work team"));
    expect(listedBots(render().tree)).toEqual(["dodo"]);
    const back = render().tree.find(node => node.type === "button" && Children.toArray(node.props.children).includes("All teams"))!;
    click(back);
    expect(button("Open Work team")).toBeDefined();
    expect(listedBots(render().tree)).toEqual([]);
  });

  it("finds a bot by team and role from any focused team", () => {
    fixture.state.bots[1] = bot("bea", { section: "Finance", title: "Invoice reviewer" });
    click(tab("Teams")); click(button("Open Work team"));
    search("finance invoice");
    expect(listedBots(render().tree)).toEqual(["bea"]);
    search("");
    expect(listedBots(render().tree)).toEqual(["dodo"]);
  });

  it("keeps the Global Chief accessible outside the focused team", () => {
    fixture.state.bots.push(bot("boss", { globalChief: true, chiefOfStaff: true }));
    click(tab("Teams")); click(button("Open Work team"));
    expect(listedBots(render().tree)).toEqual(["boss", "dodo"]);
    expect(render().tree.some(node => node.props["data-global-chief"] === "boss")).toBe(true);
  });

  it("does not expose archived bots when searching or switching views", () => {
    fixture.state.bots.push(bot("hidden", { hidden: true, title: "private" }));
    search("hidden"); expect(listedBots(render().tree)).toEqual([]);
    click(tab("Bots")); expect(listedBots(render().tree)).not.toContain("hidden");
  });

  it("offers empty teams and keeps their management action", () => {
    fixture.state.sections = ["Work", "Empty"];
    click(tab("Teams")); click(button("Open Empty team"));
    expect(listedBots(render().tree)).toEqual([]);
    expect(render().tree.some(node => node.type === "button" && node.props.children === "Add or remove bots")).toBe(true);
  });

  it("opens the existing team menu from the focused team's actions", () => {
    click(tab("Teams")); click(button("Open Work team"));
    const currentTarget = { getBoundingClientRect: () => ({ right: 280, bottom: 300 }), focus: vi.fn(), isConnected: true };
    click(button("Actions for Work team"), { currentTarget });
    const menu = render().tree.find(node => node.props.role === "menu")!;
    expect(menu.props["aria-label"]).toBe("Work");
    expect(menu.props.style).toEqual({ left: 24, top: 304 });
    const items = render().tree.find(node => node.type === TeamMenuItems)!;
    expect(items.props.onRename).toBeTypeOf("function");
    expect(items.props.onDelete).toBeTypeOf("function");
  });

  it("favors teams in the list without moving their bots", () => {
    click(tab("Teams"));
    click(button("Favorite Work"));
    expect(button("Unfavorite Work").props["aria-pressed"]).toBe(true);
    expect(fixture.state.bots.find(bot => bot.id === "dodo")?.section).toBe("Work");
  });

  it("opens at 288px in Simple and 320px in Advanced, each remembering its own resized width", () => {
    const width = () => render().root.props.style!["--sidebar-width"];
    expect(width()).toBe("288px");
    expect(render().root.props.className).toContain("w-[288px]");
    fixture.values = [];
    fixture.advanced = true;
    expect(width()).toBe("320px");
    fixture.storage.set(SIDEBAR_WIDTH_KEY, "360");
    fixture.storage.set(SIMPLE_SIDEBAR_WIDTH_KEY, "300");
    fixture.values = [];
    expect(width()).toBe("360px");
    fixture.values = [];
    fixture.advanced = false;
    expect(width()).toBe("300px");
    const handle = render().tree.find((node) => node.type === SidebarResizeHandle)!.props as Parameters<typeof SidebarResizeHandle>[0];
    expect(handle.sizing.defaultWidth).toBe(288);
    expect(handle.sizing.valueNow).toBe(300);
    fixture.advanced = true;
    render();
    for (const effect of fixture.effects) {
      try { effect(); } catch {}
    }
    expect(width()).toBe("360px");
  });
  it("collapses to a rail from the edge bump, keeping the Simple order with a hairline between sections", () => {
    const toggle = render().tree.find((node) => node.type === SidebarEdgeToggle)!.props as Parameters<typeof SidebarEdgeToggle>[0];
    expect(toggle.collapsed).toBe(false);
    toggle.onToggle();
    expect(fixture.storage.get(SIDEBAR_DENSITY_KEY)).toBe("icons");
    const { root, tree } = render();
    expect(root.props.className).toContain("w-[92px]");
    expect(sectionOrder(tree)).toEqual([BOTS_SECTION_ID, CHANNELS_SECTION_ID, userSectionId("Work")]);
    expect(listedBots(tree)).toEqual(["atlas", "bea", "dodo"]);
    expect(headers(tree)).toEqual([]);
    expect(tree.filter((node) => node.type === SidebarRailSeparator)).toHaveLength(2);
    expect(tree.some((node) => node.type === SidebarSearchToggle)).toBe(false);
    expect((tree.find((node) => node.type === SidebarEdgeToggle)!.props as Parameters<typeof SidebarEdgeToggle>[0]).collapsed).toBe(true);
    expect(tree.some((node) => node.props["data-sidebar-top-buttons"] !== undefined)).toBe(false);
  });

  it("puts search and the same + menu at the foot of the rail, and the edge bump expands it again", () => {
    setSidebarDensity("icons");
    const footer = () => render().tree.find((node) => node.type === SimpleRailFooter)!.props as Parameters<typeof SimpleRailFooter>[0];
    const plus = () => nodes(footer().plus).find((node) => node.type === "button" && node.props["aria-label"] === "New or share")!;
    (plus().props.onClick as () => void)();
    const menu = nodes(footer().plus).find((node) => /\bw-52\b/.test(node.props.className ?? ""))!;
    expect(menu.props.className).toEqual(expect.stringContaining("bottom-0 left-full"));
    expect(nodes(footer().plus).some((node) => node.type === "button" && Children.toArray(node.props.children).includes("Create team"))).toBe(true);
    (render().tree.find((node) => node.type === SidebarEdgeToggle)!.props as Parameters<typeof SidebarEdgeToggle>[0]).onToggle();
    expect(fixture.storage.get(SIDEBAR_DENSITY_KEY)).toBe("comfortable");
    expect(render().tree.some((node) => node.type === SimpleRailFooter)).toBe(false);
  });

  it("focuses global search from the rail by expanding the sidebar", () => {
    setSidebarDensity("icons");
    expect(render().tree.some((node) => node.type === SidebarSearchPill)).toBe(false);
    (render().tree.find((node) => node.type === SimpleRailFooter)!.props as Parameters<typeof SimpleRailFooter>[0]).onSearch();
    const { tree } = render();
    expect(tree.some((node) => node.type === SimpleRailFooter)).toBe(false);
    expect(tree.some((node) => node.props["data-sidebar-navigation-search"] !== undefined)).toBe(true);
  });

  it("opens the command palette instead when a side panel holds the sidebar collapsed", () => {
    const opened = vi.fn();
    window.addEventListener("omb:open-command-palette", opened);
    const footer = render(true).tree.find((node) => node.type === SimpleRailFooter)!.props as Parameters<typeof SimpleRailFooter>[0];
    expect(render(true).tree.some((node) => node.type === SidebarEdgeToggle)).toBe(false);
    footer.onSearch();
    expect(opened).toHaveBeenCalledOnce();
    expect(render(true).tree.some((node) => node.type === SimpleRailFooter)).toBe(true);
  });
});
