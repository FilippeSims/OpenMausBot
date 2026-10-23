import type { Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { navigationBotActivity, type NavigationBotStatus } from "@/lib/navigation-activity";

export function NavigationBotDetails({ bot, subtitle, status = navigationBotActivity(bot).status }: { bot: Bot; subtitle: string; status?: NavigationBotStatus }) {
  const statuses = status === "working-waiting" ? ["working", "waiting"] as const : [status];
  return <><span className="block truncate" title={subtitle}>{subtitle}</span>
    <span className="mt-1 flex flex-wrap gap-1" data-navigation-bot-status={status}>
      {statuses.map(value => <span key={value} className={cn("inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium leading-tight",
        value === "working" ? "bg-success/10 text-success" : value === "waiting" ? "bg-warning/10 text-warning"
          : value === "idle" || value === "offline" ? "text-ink-secondary" : "bg-accent/10 text-accent")}>
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full bg-current", value === "working" && "motion-safe:animate-pulse")} />
        {t(`navigation.activity.${value}`)}
      </span>)}
    </span>
  </>;
}
