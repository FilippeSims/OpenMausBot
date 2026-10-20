import type { Dispatch } from "react";
import { ChevronRight, Crown } from "lucide-react";
import { api, type Action, type AppState, type Bot, type Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { stateForBot } from "@/lib/mascot";
import { BotAvatar } from "./Avatar";
import { RenameTitle } from "./RenameTitle";

const CHATHEAD_PILL = "flex min-w-0 items-center gap-2 rounded-full border border-hairline/40 bg-control/60 py-0.5 pl-1.5 text-ink";

function chiefOfStaffBadge(bot: Bot) {
  if (!bot.chiefOfStaff) return null;
  const label = t(bot.globalChief ? "globalChief.title" : "chat.chiefOfStaff");
  return (
    <span title={label} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-medium text-accent @max-4xl/chathead:px-1.5">
      <Crown size={11} aria-hidden="true" /> <span className="@max-4xl/chathead:sr-only">{label}</span>
    </span>
  );
}

export function ChatBotIdentity({ bot, advanced, messages, mascotMotion, headerAnimated, dispatch }: {
  bot: Bot;
  advanced: boolean;
  messages: Message[];
  mascotMotion: AppState["mascotMotion"];
  headerAnimated: boolean;
  dispatch: Dispatch<Action>;
}) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <span data-chathead-team className="max-w-full truncate pl-2 text-[11px] text-ink-secondary">{bot.globalChief ? t("navigation.independent") : t("navigation.breadcrumb", { team: bot.section?.trim() || t("navigation.general") })}</span>
      {advanced ? (
        <div data-chathead-pill className={cn(CHATHEAD_PILL, "pr-1")}>
          <button
            type="button"
            onClick={() => dispatch({ type: "toggleSettings", open: true })}
            className="flex shrink-0 items-center justify-center rounded-full"
            title={t("chat.openProfile")}
            aria-label={t("chat.openProfileAria", { name: bot.name })}
          >
            <BotAvatar
              bot={bot}
              state={stateForBot({ ...bot, messages })}
              size={24}
              motion={mascotMotion?.kind ?? "none"}
              motionKey={mascotMotion?.nonce ?? 0}
              animated={headerAnimated}
            />
          </button>
          <RenameTitle
            value={bot.name}
            onCommit={(name) => {
              if (window.ogb?.remoteClient?.active) {
                void api(`/api/bots/${bot.id}/profile`, { method: "PATCH", body: JSON.stringify({ name }) })
                  .then(({ bot: updated }) => dispatch({ type: "botPatched", bot: updated }))
                  .catch((cause) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) }));
              } else {
                dispatch({ type: "updateBot", botId: bot.id, patch: { name } });
              }
            }}
            onActivate={() => dispatch({ type: "toggleSettings", open: true })}
            showEditButton
            className="truncate text-[14px] font-semibold text-ink"
            editButtonClassName="size-6 rounded-full"
            inputClassName="max-w-[220px] rounded-full bg-inset px-2 py-0.5 text-[14px] font-semibold"
          />
          {chiefOfStaffBadge(bot)}
        </div>
      ) : (
        <button
          type="button"
          data-chathead-pill data-tour="bot-pill"
          onClick={() => dispatch({ type: "toggleSettings", open: true })}
          title={t("chat.openProfile")}
          aria-label={t("chat.openProfileAria", { name: bot.name })}
          className={cn(CHATHEAD_PILL, "group h-9 gap-2.5 pl-2 pr-3.5 hover:bg-raised-hover")}
        >
          <BotAvatar bot={bot} state={stateForBot({ ...bot, messages })} size={24}
            motion={mascotMotion?.kind ?? "none"} motionKey={mascotMotion?.nonce ?? 0} animated={headerAnimated} />
          <span className="min-w-0 truncate text-[14px] font-medium text-ink">{bot.name}</span>
          {chiefOfStaffBadge(bot)}
          <ChevronRight size={14} aria-hidden="true" className="-ml-2.5 w-0 shrink-0 text-ink-secondary opacity-0 transition-[width,margin,opacity] duration-150 group-hover:ml-0 group-hover:w-3.5 group-hover:opacity-100 group-focus-visible:ml-0 group-focus-visible:w-3.5 group-focus-visible:opacity-100" />
        </button>
      )}
    </div>
  );
}
