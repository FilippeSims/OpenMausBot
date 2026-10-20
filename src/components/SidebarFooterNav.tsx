import { FolderOpen, Network, Puzzle, Sun, Zap } from "lucide-react";
import type { ReactNode } from "react";

import { useAppTriggers } from "@/lib/app-triggers";
import { cn } from "@/lib/cn";
import { useCloudFilesReady } from "@/lib/cloud-files";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { isRoutineProblemRun } from "@/lib/routines";
import { useSidebarToolsLayout, type SidebarDensity } from "@/lib/sidebar-preferences";
import { useStore } from "@/state/store";

import { SidebarSectionHeader } from "./SidebarSectionHeader";


function NavRow({
  id,
  label,
  icon,
  active = false,
  attention = false,
  iconsOnly,
  rail = false,
  tourId,
  caption = false,
  onClick,
}: {
  id: string;
  label: string;
  icon: (active: boolean) => ReactNode;
  active?: boolean;
  attention?: boolean;
  iconsOnly: boolean;
  rail?: boolean;
  tourId?: string;
  caption?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-tour={tourId}
      data-sidebar-nav={id}
      onClick={onClick}
      aria-label={iconsOnly || caption ? label : undefined}
      title={iconsOnly || caption ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center rounded-xl transition-colors",
        caption ? "min-h-[50px] min-w-0 flex-1 flex-col justify-center gap-1 px-1 py-1.5" : rail ? "size-9 shrink-0 justify-center" : iconsOnly ? "mx-auto size-[46px] shrink-0 justify-center" : "w-full min-h-9 gap-3 px-3 py-1.5 text-left",
        active ? "bg-raised text-ink" : "text-ink hover:bg-raised/50",
      )}
    >
      {icon(active)}
      {caption ? <span className="max-w-full truncate text-[10.5px] leading-4">{label}</span> : !iconsOnly && <span className="flex-1 truncate text-[14px] font-medium leading-5">{label}</span>}
      {attention && (
        <span
          data-testid="routines-attention"
          className={cn("size-2 shrink-0 rounded-full bg-danger", iconsOnly && (rail ? "absolute right-1 top-1" : "absolute right-2 top-2"))}
        />
      )}
    </button>
  );
}

export function SidebarTodayNav({ density }: { density: SidebarDensity }) {
  const { state, dispatch } = useStore();
  const iconsOnly = density === "icons";
  const active = state.activeView === "today";
  return (
    <div className={iconsOnly ? "flex justify-center px-2 pb-1" : "px-2 pb-2"}>
      <NavRow
        id="today"
        label={t("sidebar.nav.today")}
        iconsOnly={iconsOnly}
        active={active}
        icon={(on) => <Sun size={iconsOnly ? 20 : 18} className={on ? "text-accent" : "text-ink-secondary"} />}
        onClick={() => dispatch({ type: "showToday" })}
      />
    </div>
  );
}

export function SidebarAppsButton() {
  const { state, dispatch } = useStore();
  const label = t("sidebar.nav.apps");
  return (
    <button
      type="button"
      data-tour="nav-apps"
      data-sidebar-nav="apps"
      onClick={() => dispatch({ type: "togglePlugins", open: true })}
      aria-label={label}
      title={label}
      aria-pressed={state.pluginsOpen}
      className={cn(
        "flex size-[46px] shrink-0 items-center justify-center rounded-xl transition-colors",
        state.pluginsOpen ? "bg-raised text-accent" : "text-ink-secondary hover:bg-raised/50 hover:text-ink",
      )}
    >
      <Puzzle size={18} />
    </button>
  );
}

export function SidebarFooterNav({
  density,
  rail = false,
  collapsed = false,
  onToggleCollapsed,
  compactNavigation = false,
}: {
  density: SidebarDensity;
  rail?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  compactNavigation?: boolean;
}) {
  const { state, dispatch } = useStore();
  const advanced = useAdvancedMode();
  const iconsOnly = density === "icons";
  const toolsLayout = useSidebarToolsLayout();
  const toolbar = compactNavigation || advanced && !iconsOnly && toolsLayout === "toolbar";
  const iconSize = iconsOnly && !rail ? 20 : 18;
  const tone = (active: boolean) => (active ? "text-accent" : "text-ink-secondary");
  const appTriggers = useAppTriggers();
  const automationsNeedYou = state.routineRuns.some((run) => isRoutineProblemRun(run) && !run.seenAt) || appTriggers.triggers.some((trigger) => trigger.enabled && trigger.problem);
  const automationsRow = <NavRow
    caption={compactNavigation}
    id="automations"
    label={t("sidebar.nav.automations")}
    tourId="nav-automations"
    iconsOnly={iconsOnly || toolbar}
    rail={rail}
    active={state.activeView === "routines"}
    attention={automationsNeedYou}
    icon={(active) => <Zap size={iconSize} className={tone(active)} />}
    onClick={() => dispatch({ type: "showRoutines", view: "list" })}
  />;
  const filesRow = useCloudFilesReady() && <NavRow
    caption={compactNavigation}
    id="files"
    label={t("sidebar.nav.files")}
    iconsOnly={iconsOnly || toolbar}
    rail={rail}
    active={state.activeView === "files"}
    icon={(active) => <FolderOpen size={iconSize} className={tone(active)} />}
    onClick={() => dispatch({ type: "showFiles" })}
  />;
  if (!compactNavigation && !advanced && !iconsOnly) return <nav aria-label={t("sidebar.tools")} className="flex flex-col gap-0.5">{automationsRow}{filesRow}</nav>;

  const rows = (
    <>
      {automationsRow}
      {iconsOnly && <NavRow
        id="apps"
        label={t("sidebar.nav.apps")}
        tourId="nav-apps"
        iconsOnly={iconsOnly}
        rail={rail}
        active={state.pluginsOpen}
        icon={(active) => <Puzzle size={iconSize} className={tone(active)} />}
        onClick={() => dispatch({ type: "togglePlugins", open: true })}
      />}
      {advanced && (
        <NavRow
          caption={compactNavigation}
          id="team-map"
          label={t("sidebar.nav.teamMap")}
          tourId="team-tools"
          iconsOnly={iconsOnly || toolbar}
          active={state.activeView === "team-map"}
          icon={(active) => <Network size={iconSize} className={tone(active)} />}
          onClick={() => dispatch({ type: "showTeamMap" })}
        />
      )}
      {filesRow}
    </>
  );

  if (compactNavigation) return <nav data-sidebar-navigation-tools aria-label={t("sidebar.tools")} className="flex items-stretch gap-1 border-t border-hairline/40 pt-1">
    <NavRow id="today" label={t("sidebar.nav.today")} iconsOnly caption active={state.activeView === "today"}
      icon={active => <Sun size={18} className={tone(active)} />} onClick={() => dispatch({ type: "showToday" })} />
    {rows}
  </nav>;

  if (iconsOnly) {
    return <nav data-tour="tools" aria-label={t("sidebar.tools")} className={cn("flex flex-col items-center", rail ? "gap-0.5" : "gap-1")}>{rows}</nav>;
  }
  return (
    <div data-tour="tools">
      <SidebarSectionHeader
        name={t("sidebar.tools")}
        collapsed={collapsed}
        alert={collapsed && automationsNeedYou}
        onToggle={onToggleCollapsed}
        reorderable={false}
        dragging={false}
      />
      {!collapsed && <nav aria-label={t("sidebar.tools")} className={toolbar ? "flex flex-row gap-1" : "flex flex-col gap-0.5"}>{rows}</nav>}
    </div>
  );
}
