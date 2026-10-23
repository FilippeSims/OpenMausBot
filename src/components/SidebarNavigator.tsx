import { openTeamFiles } from "@/lib/team-files";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, FolderOpen, MoreHorizontal, Search, Star, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { SIDEBAR_TEAM_RENAMED_EVENT, navigationMatches, navigationTeams, readSidebarNavigation, recentNavigationBots, saveSidebarNavigation, type NavigationTab, type NavigationTeam } from "@/lib/sidebar-navigation";
import type { AppState, Bot, Group } from "@/state/store";
import { isGlobalChief } from "../../shared/global-chief";
import { GlassBar, GlassScrollFrame, GlassScroller } from "./GlassScrollFrame";
import { SearchResults } from "./SearchResults";
import { NavigationActivitySummary } from "./NavigationActivitySummary";
import { NavigationTeamCard } from "./NavigationTeamCard";
import { navigationActivityMatches, navigationActivityRank, navigationBotActivity, type NavigationActivityFilter, type NavigationBotStatus } from "@/lib/navigation-activity";

export interface NavigationBotOptions {
  query: string;
  subtitle: string;
  status: NavigationBotStatus;
}

export function navigationBotSubtitle(bot: Bot, includeTeam: boolean): string {
  const role = isGlobalChief(bot) ? t("globalChief.title") : bot.title.trim() || (bot.chiefOfStaff ? t("sidebar.bot.chiefOfStaff") : t("navigation.agent"));
  const team = bot.section?.trim() || t("navigation.general");
  return includeTeam && !isGlobalChief(bot) ? `${team} · ${role}` : role;
}

const tabs = ["recent", "teams", "bots"] as const;
const tabLabel = { recent: "navigation.recent", teams: "navigation.teams", bots: "navigation.bots" } as const;

export function SidebarNavigator({ state, chrome, footer, panels, resize, renderBot, renderGroup, onTeamMenu, onManageTeam, onSearchFocused, autoFocusSearch = false }: {
  state: AppState;
  chrome: ReactNode;
  footer: ReactNode;
  panels?: ReactNode;
  resize?: ReactNode;
  renderBot: (bot: Bot, options: NavigationBotOptions) => ReactNode;
  renderGroup: (group: Group, query: string) => ReactNode;
  onTeamMenu?: (team: string, button: HTMLButtonElement) => void;
  onManageTeam?: (team: string) => void;
  autoFocusSearch?: boolean;
  onSearchFocused?: () => void;
}) {
  const [preferences, setPreferences] = useState(readSidebarNavigation);
  const [query, setQuery] = useState("");
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [shown, setShown] = useState(40);
  const [activityFilter, setActivityFilter] = useState<NavigationActivityFilter>("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<string | null>(null);
  const id = useId();
  const teams = navigationTeams(state.bots, state.groups, state.sections, state.pendingQueued);
  const visible = state.bots.filter(bot => !bot.hidden);
  const chiefs = visible.filter(isGlobalChief);
  const activity = new Map(visible.map(bot => [bot.id, navigationBotActivity(bot, state.groups, state.pendingQueued)]));
  const matchesActivity = (bot: Bot) => navigationActivityMatches(activity.get(bot.id)!, activityFilter);
  const teamBots = visible.filter(bot => !isGlobalChief(bot));
  const collator = new Intl.Collator(activeLocale(), { sensitivity: "base", numeric: true });
  const teamLabel = (key: string) => key || t("navigation.general");
  const sortedTeams = [...teams].sort((a, b) => Number(b.working > 0 || b.activeRooms > 0) - Number(a.working > 0 || a.activeRooms > 0) || Number(b.active) - Number(a.active) || collator.compare(teamLabel(a.key), teamLabel(b.key)));
  const orderedBots = (bots: Bot[]) => [...bots].sort((a, b) => navigationActivityRank(activity.get(a.id)!) - navigationActivityRank(activity.get(b.id)!) || Number(Boolean(b.chiefOfStaff)) - Number(Boolean(a.chiefOfStaff)) || collator.compare(a.name, b.name));
  const focused = teams.find(team => team.key === preferences.team);
  const searching = query.trim().length > 0;
  const activeTeam = searching ? undefined : focused;
  const panelId = id + "-panel";
  const favorite = (key: string) => preferences.favorites.includes(key);

  useEffect(() => { saveSidebarNavigation(preferences); }, [preferences]);
  useEffect(() => {
    if (autoFocusSearch) { searchRef.current?.focus(); onSearchFocused?.(); }
  }, [autoFocusSearch, onSearchFocused]);
  useEffect(() => {
    if (state.activeView !== "chat") return;
    const selected = state.bots.find(bot => bot.id === state.selectedId && !bot.hidden);
    if (!selected || selectedRef.current === selected.id) return;
    const changed = selectedRef.current !== null;
    selectedRef.current = selected.id;
    setPreferences(previous => ({
      ...previous,
      recent: [selected.id, ...previous.recent.filter(id => id !== selected.id)].slice(0, 40),
      ...(changed && previous.tab === "teams" && !isGlobalChief(selected) ? { team: selected.section?.trim() ?? "" } : {}),
    }));
  }, [state.activeView, state.selectedId, state.bots]);
  useEffect(() => {
    setShown(40);
    document.getElementById(panelId)?.closest("[data-navigation-scroll]")?.scrollTo?.({ top: 0 });
  }, [preferences.tab, preferences.team, query, activityFilter]);

  useEffect(() => {
    const rename = (event: Event) => {
      const detail = (event as CustomEvent<{ oldName: string; newName: string }>).detail;
      if (!detail || typeof detail.oldName !== "string" || typeof detail.newName !== "string") return;
      setPreferences(previous => ({ ...previous,
        team: previous.team === detail.oldName ? detail.newName : previous.team,
        favorites: [...new Set(previous.favorites.map(team => team === detail.oldName ? detail.newName : team))],
      }));
    };
    window.addEventListener(SIDEBAR_TEAM_RENAMED_EVENT, rename);
    return () => window.removeEventListener(SIDEBAR_TEAM_RENAMED_EVENT, rename);
  }, []);

  const changeTab = (tab: NavigationTab) => {
    setPreferences(previous => ({ ...previous, tab, ...(tab === "teams" ? { team: null } : {}) }));
    setQuery(""); setMessagesOpen(false); setActivityFilter("all");
  };
  const openTeam = (key: string) => {
    setPreferences(previous => ({ ...previous, tab: "teams", team: key }));
    setQuery(""); setMessagesOpen(false); setActivityFilter("all");
  };
  const toggleFavorite = (key: string) => setPreferences(previous => ({ ...previous, favorites: favorite(key) ? previous.favorites.filter(value => value !== key) : [...previous.favorites, key] }));
  const heading = (text: string, count?: number) => <div className="flex items-center gap-2 px-3 pb-2 pt-4 text-[10.5px] font-medium uppercase tracking-[0.09em] text-ink-secondary">{text}{count !== undefined && <span className="tabular-nums">{count}</span>}</div>;
  const botRows = (bots: Bot[], includeTeam: boolean) => bots.map(bot => <div key={bot.id} data-navigation-bot={bot.id}>
    {renderBot(bot, { query: "", subtitle: navigationBotSubtitle(bot, includeTeam), status: activity.get(bot.id)!.status })}
  </div>);
  const star = (team: NavigationTeam) => <button type="button" onClick={() => toggleFavorite(team.key)}
    aria-label={t(favorite(team.key) ? "navigation.unfavorite" : "navigation.favorite", { name: teamLabel(team.key) })}
    aria-pressed={favorite(team.key)} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink touch:size-10">
    <Star size={15} aria-hidden="true" className={cn(favorite(team.key) && "fill-accent/20 text-accent")} />
  </button>;
  const menu = (team: NavigationTeam) => team.key && onTeamMenu ? <button type="button" aria-label={t("navigation.teamActions", { name: teamLabel(team.key) })}
    onClick={event => onTeamMenu(team.key, event.currentTarget)} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink touch:size-10"><MoreHorizontal size={15} aria-hidden="true" /></button> : null;
  const teamRows = (items: NavigationTeam[]) => items.map(team => <NavigationTeamCard key={team.key} team={team} label={teamLabel(team.key)} onOpen={() => openTeam(team.key)}>{star(team)}{menu(team)}</NavigationTeamCard>);
  const filterActivity = (filter: NavigationActivityFilter) => {
    setActivityFilter(filter); setQuery(""); setMessagesOpen(false);
    if (filter !== "all") setPreferences(previous => ({ ...previous, tab: filter === "active" ? "teams" : "bots", team: null }));
  };

  let content: ReactNode;
  let total = 0;
  let hasMore = false;
  if (searching) {
    const teamHits = sortedTeams.filter(team => navigationMatches(query, [teamLabel(team.key)]));
    const botHits = orderedBots(visible.filter(bot => navigationMatches(query, [bot.name, bot.title, bot.description, navigationBotSubtitle(bot, true), ...bot.tasks?.map(task => task.title) ?? [], ...bot.projects?.map(project => project.name) ?? []])));
    const groupHits = state.groups.filter(group => navigationMatches(query, [group.name, teamLabel(group.section?.trim() ?? "")]));
    total = teamHits.length + botHits.length + groupHits.length;
    hasMore = Math.max(teamHits.length, botHits.length, groupHits.length) > shown;
    content = <>
      {heading(t("navigation.globalResults"), total)}
      {teamHits.length > 0 && <>{heading(t("navigation.teams"))}{teamRows(teamHits.slice(0, shown))}</>}
      {botHits.length > 0 && <>{heading(t("navigation.bots"))}{botRows(botHits.slice(0, shown), true)}</>}
      {groupHits.length > 0 && <>{heading(t("sidebar.section.channels"))}{groupHits.slice(0, shown).map(group => <div key={group.id}>{renderGroup(group, "")}</div>)}</>}
      {total === 0 && <p className="px-3 py-5 text-[13px] text-ink-secondary">{t("navigation.noResults", { query })}</p>}
      <button type="button" className="mx-3 my-4 text-left text-[12px] text-accent hover:underline" aria-expanded={messagesOpen} onClick={() => setMessagesOpen(value => !value)}>{t("navigation.searchConversations")}</button>
      {messagesOpen && <SearchResults query={query} onLanded={() => setQuery("")} />}
    </>;
  } else if (preferences.tab === "teams" && activeTeam) {
    total = activeTeam.bots.length + activeTeam.groups.length;
    hasMore = Math.max(activeTeam.bots.length, activeTeam.groups.length) > shown;
    content = <>
      <button type="button" className="mx-3 mb-2 mt-3 flex items-center gap-2 rounded-lg py-2 text-[12px] text-ink-secondary hover:text-ink" onClick={() => setPreferences(previous => ({ ...previous, team: null }))}><ArrowLeft size={15} aria-hidden="true" />{t("navigation.allTeams")}</button>
      <div className="flex items-center gap-1 px-3 pb-2" data-navigation-focused-team={activeTeam.key}>
        <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold text-ink">{teamLabel(activeTeam.key)}</h2>{star(activeTeam)}{menu(activeTeam)}
      </div>
      <p className="flex flex-wrap gap-x-2 px-3 pb-3 text-[11.5px] text-ink-secondary"><span>{t(activeTeam.bots.length === 1 ? "navigation.botCountOne" : "navigation.botCount", { count: activeTeam.bots.length })}</span>
        {activeTeam.working > 0 && <span className="text-success">{t("navigation.working", { count: activeTeam.working })}</span>}
        {activeTeam.waiting > 0 && <span className="text-warning">{t("navigation.waiting", { count: activeTeam.waiting })}</span>}
      </p>
      <button type="button" className="mx-3 mb-3 flex items-center gap-2 rounded-xl border border-hairline/60 bg-inset/40 px-3 py-3 text-left text-[12px] text-ink hover:bg-raised" onClick={() => openTeamFiles(activeTeam.key)} aria-label={t("teamFiles.openTeam", { name: teamLabel(activeTeam.key) })}><FolderOpen size={17} className="shrink-0 text-accent" /><span><span className="block font-medium">{t("teamFiles.menu")}</span><span className="mt-0.5 block text-[11px] text-ink-secondary">{t("teamFiles.shortDescription")}</span></span></button>
      {botRows(orderedBots(activeTeam.bots).slice(0, shown), false)}
      {activeTeam.groups.length > 0 && <>{heading(t("sidebar.section.channels"))}{activeTeam.groups.slice(0, shown).map(group => <div key={group.id}>{renderGroup(group, "")}</div>)}</>}
      {total === 0 && <p className="px-3 py-4 text-[13px] text-ink-secondary">{t("navigation.emptyTeam")}</p>}
      {activeTeam.key && onManageTeam && <button type="button" className="mx-3 my-4 text-left text-[12px] text-accent hover:underline" onClick={() => onManageTeam(activeTeam.key)}>{t("team.manageBots")}</button>}
    </>;
  } else if (preferences.tab === "teams") {
    const available = activityFilter === "active" ? sortedTeams.filter(team => team.active) : sortedTeams;
    total = available.length;
    const active = available.filter(team => team.active);
    const pinned = available.filter(team => !team.active && favorite(team.key));
    const other = available.filter(team => !team.active && !favorite(team.key));
    const ordered = [...active, ...pinned, ...other].slice(0, shown);
    hasMore = available.length > shown;
    content = <>
      {active.length > 0 && <>{heading(t("navigation.activity.activeTeams"), active.length)}{teamRows(ordered.filter(team => team.active))}</>}
      {pinned.length > 0 && <>{heading(t("navigation.favoriteTeams"))}{teamRows(ordered.filter(team => !team.active && favorite(team.key)))}</>}
      {other.length > 0 && <>{heading(t(active.length ? "navigation.activity.otherTeams" : "navigation.allTeams"), other.length)}{teamRows(ordered.filter(team => !team.active && !favorite(team.key)))}</>}
      {activityFilter !== "all" && available.length === 0 && <p className="px-3 py-4 text-[13px] text-ink-secondary">{t("navigation.activity.empty")}</p>}
      {teams.length === 0 && <p className="px-3 py-4 text-[13px] text-ink-secondary">{t("navigation.noTeams")}</p>}
    </>;
  } else {
    const items = preferences.tab === "recent" ? recentNavigationBots(visible, preferences.recent) : orderedBots(visible.filter(bot => !isGlobalChief(bot)));
    const filtered = items.filter(matchesActivity);
    const active = orderedBots(filtered.filter(bot => activity.get(bot.id)!.active));
    const pinned = filtered.filter(bot => !activity.get(bot.id)!.active && bot.pinned);
    const rest = filtered.filter(bot => !activity.get(bot.id)!.active && !bot.pinned);
    const page = [...active, ...pinned, ...rest].slice(0, shown);
    total = filtered.length;
    const groups = activityFilter === "all" ? state.groups.filter(group => preferences.tab === "recent" || group.dm) : [];
    hasMore = filtered.length > shown || groups.length > shown;
    content = <>
      {active.length > 0 && <>{heading(t("navigation.activity.activeBots"), active.length)}{botRows(page.filter(bot => activity.get(bot.id)!.active), true)}</>}
      {pinned.length > 0 && <>{heading(t("sidebar.section.pinned"))}{botRows(page.filter(bot => !activity.get(bot.id)!.active && bot.pinned), true)}</>}
      {rest.length > 0 && heading(t(preferences.tab === "recent" ? "navigation.recent" : "navigation.allBots"), rest.length)}
      {botRows(page.filter(bot => !activity.get(bot.id)!.active && !bot.pinned), true)}
      {activityFilter !== "all" && filtered.length === 0 && <p className="px-3 py-4 text-[13px] text-ink-secondary">{t("navigation.activity.empty")}</p>}
      {activityFilter === "all" && items.length === 0 && <p className="px-3 py-4 text-[13px] text-ink-secondary">{t("navigation.noBots")}</p>}
      {groups.length > 0 && <>{heading(t("sidebar.section.channels"))}{groups.slice(0, shown).map(group => <div key={group.id}>{renderGroup(group, "")}</div>)}</>}
    </>;
  }

  return <GlassScrollFrame className="sidebar-navigation flex-1" data-sidebar-navigation>
    <GlassBar edge="top">
      {chrome}
      <div className="px-3 pb-1 pt-1">
        <div className="flex items-center gap-2 rounded-xl border border-hairline/50 bg-inset/50 px-3 py-2.5 focus-within:border-accent/60">
          <Search size={16} aria-hidden="true" className="shrink-0 text-ink-secondary" />
          <input ref={searchRef} type="search" data-sidebar-navigation-search value={query}
            onChange={event => { setQuery(event.target.value); setMessagesOpen(false); setActivityFilter("all"); }}
            onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); if (query) setQuery(""); else searchRef.current?.blur(); } }}
            placeholder={t("navigation.search")} aria-label={t("navigation.search")} className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-secondary touch:text-[16px]" />
          {query ? <button type="button" aria-label={t("navigation.clearSearch")} className="flex size-5 shrink-0 items-center justify-center text-ink-secondary hover:text-ink" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={14} aria-hidden="true" /></button> : <kbd className="shrink-0 text-[10px] text-ink-tertiary">{globalThis.navigator?.platform?.includes("Mac") ? "⌘ K" : "Ctrl K"}</kbd>}
        </div>
        <div role="tablist" aria-label={t("navigation.views")} className="mt-2 flex rounded-xl bg-control/50 p-1">
          {tabs.map(tab => <button key={tab} type="button" id={id + "-" + tab} role="tab" aria-selected={preferences.tab === tab} aria-controls={panelId}
            tabIndex={preferences.tab === tab ? 0 : -1} onClick={() => changeTab(tab)} onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              changeTab(tabs[next]!); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#${CSS.escape(id + "-" + tabs[next])}`)?.focus();
            }} className={cn("min-h-8 min-w-0 flex-1 rounded-lg px-1 py-1.5 text-[12px] transition-colors touch:min-h-11", preferences.tab === tab ? "bg-raised font-medium text-ink shadow-sm" : "text-ink-secondary hover:text-ink")}>{t(tabLabel[tab])}</button>)}
        </div>
      </div>
      <NavigationActivitySummary connected={state.connected} teams={teams.filter(team => team.active).length} working={teamBots.filter(bot => activity.get(bot.id)!.working).length}
        waiting={teamBots.filter(bot => activity.get(bot.id)!.waiting).length} filter={activityFilter} onFilter={filterActivity} />
      {activityFilter !== "all" && <button type="button" className="mx-3 mb-2 flex items-center gap-1.5 text-[11px] text-accent hover:underline" onClick={() => setActivityFilter("all")}><X size={12} aria-hidden="true" />{t("navigation.activity.clearFilter")}</button>}
      {chiefs.length > 0 && <div className="mx-2 border-b border-hairline/40 pb-2">
        <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.09em] text-ink-secondary">{t("navigation.direct")}</div>
        {chiefs.map(bot => <div key={bot.id} data-global-chief={bot.id}>{renderBot(bot, { query: "", subtitle: t("globalChief.independent"), status: activity.get(bot.id)!.status })}</div>)}
      </div>}
      {panels}
    </GlassBar>
    {resize}
    <GlassScroller className="px-2" data-navigation-scroll>
      <div id={panelId} role="tabpanel" aria-labelledby={id + "-" + preferences.tab} className="pb-3" data-navigation-results>
        <span className="sr-only" role="status">{searching ? t("navigation.resultCount", { count: total }) : ""}</span>
        {content}
        {hasMore && <button type="button" className="mx-3 my-3 rounded-lg bg-control px-3 py-2 text-[12px] text-ink hover:bg-raised" onClick={() => setShown(value => value + 40)}>{t("navigation.showMore")}</button>}
      </div>
    </GlassScroller>
    <GlassBar edge="bottom">{footer}</GlassBar>
  </GlassScrollFrame>;
}
