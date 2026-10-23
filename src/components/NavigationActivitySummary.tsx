import { Activity, CircleAlert, Zap } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { NavigationActivityFilter } from "@/lib/navigation-activity";

export function NavigationActivitySummary({ teams, working, waiting, connected, filter, onFilter }: {
  teams: number; working: number; waiting: number; connected: boolean; filter: NavigationActivityFilter;
  onFilter: (filter: NavigationActivityFilter) => void;
}) {
  const items = [
    { filter: "active" as const, count: teams, key: "teams" as const, Icon: Activity },
    { filter: "working" as const, count: working, key: "working" as const, Icon: Zap },
    { filter: "waiting" as const, count: waiting, key: "waiting" as const, Icon: CircleAlert },
  ];
  return <section className="mx-3 mb-2 mt-1" aria-label={t("navigation.activity.title")} data-navigation-activity>
    <div className="mb-1.5 flex items-center justify-between text-[10px] text-ink-secondary"><span>{t("navigation.activity.title")}</span><span className="flex items-center gap-1"><span className={cn("size-1 rounded-full", connected ? "bg-success" : "bg-warning")} />{t(connected ? "navigation.activity.live" : "navigation.activity.reconnecting")}</span></div>
    <div className="grid grid-cols-3 gap-1.5">
      {items.map(({ filter: target, count, key, Icon }) => <button key={target} type="button" aria-pressed={filter === target}
        aria-label={t(`navigation.activity.filter.${key}`, { count })} onClick={() => onFilter(filter === target ? "all" : target)}
        className={cn("flex min-w-0 flex-col items-start rounded-lg border px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent",
          filter === target ? "border-accent/50 bg-accent/10" : "border-hairline/50 bg-inset/40 hover:bg-raised")}>
        <span className={cn("flex items-center gap-1.5 text-[15px] font-semibold tabular-nums", count ? target === "waiting" ? "text-warning" : "text-success" : "text-ink-secondary")}><Icon size={12} aria-hidden="true" />{count}</span>
        <span className="mt-0.5 text-[9.5px] leading-tight text-ink-secondary">{t(`navigation.activity.summary.${key}`)}</span>
      </button>)}
    </div>
  </section>;
}
