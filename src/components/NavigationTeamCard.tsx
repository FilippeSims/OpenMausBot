import type { ReactNode } from "react";
import { ChevronRight, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { NavigationTeam } from "@/lib/sidebar-navigation";

export function NavigationTeamCard({ team, label, onOpen, children }: { team: NavigationTeam; label: string; onOpen: () => void; children: ReactNode }) {
  return <div data-navigation-team={team.key} data-team-active={team.active} className={cn("mb-1 flex items-center rounded-xl border hover:bg-raised/40",
    team.working ? "border-success/20 bg-success/[0.04]" : team.waiting ? "border-warning/20 bg-warning/[0.04]" : team.active ? "border-accent/20 bg-accent/[0.04]" : "border-transparent")}>
    <button type="button" onClick={onOpen} aria-label={t("navigation.openTeam", { name: label })}
      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-accent">
      <span className={cn("relative flex size-9 shrink-0 items-center justify-center rounded-xl", team.working ? "bg-success/10 text-success" : team.waiting ? "bg-warning/10 text-warning" : team.active ? "bg-accent/10 text-accent" : "bg-control text-ink-secondary")}>
        <Users size={18} aria-hidden="true" />{team.active && <span aria-hidden="true" className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-panel", team.working ? "bg-success motion-safe:animate-pulse" : team.waiting ? "bg-warning" : "bg-accent")} />}
      </span>
      <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium text-ink">{label}</span>
        <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10.5px] font-medium">
          {team.working > 0 && <span className="text-success">{t("navigation.working", { count: team.working })}</span>}
          {team.waiting > 0 && <span className="text-warning">{t("navigation.waiting", { count: team.waiting })}</span>}
          {team.active && !team.working && !team.waiting && <span className="text-accent">{t("navigation.activity.teamActive")}</span>}
          {!team.active && <span className="text-ink-secondary">{t("navigation.activity.teamIdle")}</span>}
        </span>
        {team.activeBots.length > 0 && <span className="mt-1 block truncate text-[11px] text-ink-secondary" title={team.activeBots.map(bot => bot.name).join(", ")} data-active-bot-names>{team.activeBots.map(bot => bot.name).join(", ")}</span>}
        <span className="mt-0.5 block truncate text-[10.5px] text-ink-secondary">{t(team.bots.length === 1 ? "navigation.botCountOne" : "navigation.botCount", { count: team.bots.length })}
          {team.groups.length > 0 && ` · ${t("navigation.roomCount", { count: team.groups.length })}`}
          {team.unread > 0 && ` · ${t("navigation.unread", { count: team.unread })}`}
        </span>
      </span><ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
    </button>{children}
  </div>;
}
