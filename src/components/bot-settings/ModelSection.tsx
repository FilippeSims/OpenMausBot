import { t as uiText } from "@/lib/i18n";
import { EffortRow, ModelPicker } from "../ModelPicker";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./BotEditorContext";
import { ProposalStatus } from "./ProposalStatus";
import { ThreadModelsLine } from "../ThreadModelsLine";
import { t } from "@/lib/i18n";
import { Select } from "../Select";

export function ModelSection({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const { draft } = useBotEditor();
  const modelVariants = state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.capabilities?.modelVariants;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-card p-4">
        <ModelPicker
          bot={bot}
          contained
          label={
            <div>
              <div className="text-[15px] font-medium text-ink">{uiText("botSettings.simple.defaultModel")}</div>
              <div className="mt-0.5 text-[13px] text-ink-secondary">
                {draft ? uiText("ui.ModelSection.8c7fb036f3") : uiText("ui.ModelSection.8af55d33cc")}
              </div>
              <ProposalStatus bot={bot} kind="chief" />
            </div>
          }
        />
        {!draft && <ThreadModelsLine bot={bot} className="mt-3" />}
      </div>

      <EffortRow
        bot={bot}
        className="rounded-xl bg-card p-4"
        label={
          <div>
            <div className="text-[15px] font-medium text-ink">{modelVariants ? uiText("model.simple.reasoning") : uiText("teamSettings.effort")}</div>
            {/* Codex applies a level to the whole thread and cannot take one back, so this says what the app sends, not where the engine ends up. */}
            <div className="mt-0.5 text-[13px] text-ink-secondary">
              {modelVariants ? (draft ? uiText("ui.ModelSection.21463e32fd") : uiText("ui.ModelSection.c1469fc983")) : uiText("ui.ModelSection.f71faae6bb", { value1: String(bot.modelSelection.effort ? "" : uiText("ui.ModelSection.92f0434121")) })}
            </div>
            <ProposalStatus bot={bot} kind="chief" />
          </div>
        }
      />
      {!draft && <FallbackChain bot={bot} onChange={(fallback) => dispatch({ type: "updateBot", botId: bot.id, patch: { fallback } })} />}
      {!draft && state.config?.cacheKeepWarm && (
        <KeepWarmRow bot={bot} workspaceOn={state.config.cacheKeepWarm.enabled}
          onChange={(cacheKeepWarm) => dispatch({ type: "updateBot", botId: bot.id, patch: { cacheKeepWarm } })} />
      )}
    </div>
  );
}

function KeepWarmRow({ bot, workspaceOn, onChange }: { bot: Bot; workspaceOn: boolean; onChange: (value: boolean | null) => void }) {
  const value = bot.cacheKeepWarm === true ? "on" : bot.cacheKeepWarm === false ? "off" : "follow";
  return (
    <div className="rounded-xl bg-card p-4">
      <label htmlFor="bot-cache-keepwarm" className="text-[15px] font-medium text-ink">{t("bot.keepWarm.title")}</label>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{t("bot.keepWarm.help")}</div>
      <Select className="mt-3 max-w-full" id="bot-cache-keepwarm" value={value}
        onChange={(event) => onChange(event.target.value === "on" ? true : event.target.value === "off" ? false : null)}>
        <option value="follow">{t("bot.keepWarm.follow", { state: t(workspaceOn ? "bot.keepWarm.on" : "bot.keepWarm.off") })}</option>
        <option value="on">{t("bot.keepWarm.on")}</option>
        <option value="off">{t("bot.keepWarm.off")}</option>
      </Select>
    </div>
  );
}

function FallbackChain({ bot, onChange }: { bot: Bot; onChange: (fallback: Bot["fallback"]) => void }) {
  const { state } = useStore();
  const chain = bot.fallback ?? [];
  const available = state.instances.filter(
    (instance) =>
      instance.snapshot.state === "available" &&
      Boolean(instance.models.default.trim()) &&
      instance.instanceId !== bot.modelSelection.instanceId &&
      !chain.some((entry) => entry.instanceId === instance.instanceId),
  );
  const nameOf = (instanceId: string) => state.instances.find((instance) => instance.instanceId === instanceId)?.displayName ?? instanceId;

  const add = (instanceId: string) => {
    const instance = state.instances.find((candidate) => candidate.instanceId === instanceId);
    if (!instance || !instance.models.default.trim() || chain.length >= 5 || !available.includes(instance)) return;
    onChange([...chain, { instanceId, model: instance.models.default }]);
  };

  return (
    <div className="rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">{uiText("ui.ModelSection.8430cb1d23")}</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{uiText("ui.ModelSection.6acd5044ee")}</div>
      {!state.config?.automaticRecovery?.enabled && <p className="mt-2 text-[12px] text-ink-secondary">{uiText("ui.ModelSection.951b238462")}</p>}
      {chain.length > 0 && (
        <ol className="mt-3 flex flex-col gap-1">
          {chain.map((entry, index) => (
            <li key={entry.instanceId} className="flex items-center gap-2 rounded-lg bg-inset px-3 py-1.5 text-[13px]">
              <span className="w-4 shrink-0 tabular-nums text-ink-secondary">{index + 1}.</span>
              <span className="min-w-0 flex-1 truncate text-ink">{nameOf(entry.instanceId)}</span>
              <span className="shrink-0 truncate text-[11.5px] text-ink-secondary">{entry.model}</span>
              <button
                type="button"
                onClick={() => onChange(chain.filter((candidate) => candidate.instanceId !== entry.instanceId))}
                aria-label={uiText("ui.ModelSection.0c60129cbf", { value1: String(nameOf(entry.instanceId)) })}
                className="shrink-0 rounded p-0.5 text-ink-secondary hover:text-ink"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ol>
      )}
      {chain.length < 5 && (
        <div className={cn("flex items-center gap-2", chain.length > 0 ? "mt-2" : "mt-3")}>
          <Select size="sm"
            value=""
            onChange={(event) => add(event.target.value)}
            aria-label={uiText("ui.ModelSection.215aebb7b7")}
            disabled={available.length === 0}
          >
            <option value="">{available.length === 0 ? uiText("ui.ModelSection.2e8f179eea") : uiText("ui.ModelSection.1997ae9a75")}</option>
            {available.map((instance) => (
              <option key={instance.instanceId} value={instance.instanceId}>
                {instance.displayName}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}
