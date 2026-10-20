import { tLiteral } from "@/lib/i18n";
import { t as uiText } from "@/lib/i18n";
// Security: the harness holds the cloud provider keys; the renderer never talks to ElevenLabs or Fish Audio itself.
import { useEffect, useState } from "react";
import { Check, Loader2, Volume2 } from "lucide-react";

import { api, useStore, type Bot, type ConfigStatus } from "@/state/store";
import { useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { speaker } from "@/lib/tts";
import {
  listLocalSystemVoices,
  localSystemVoicesAvailable,
  remoteSystemVoice,
  remoteVoiceProvider,
  setRemoteSystemVoice,
  setRemoteVoiceProvider,
  type RemoteVoiceProvider,
} from "@/lib/local-voice";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { voiceKeyDraftValue, type VoiceKeyDraft } from "@/lib/voice-key-draft";
import { Select } from "./Select";
import { Switch } from "./SettingsPrimitives";

const SAMPLE = "Morning. Overnight the tests went green, and I left two notes for you in the thread.";
const FISH_MODELS = [
  { value: "s2.1-pro", label: "voice.fish.modelPro" },
  { value: "s2.1-pro-free", label: "voice.fish.modelFree" },
] as const;
type FishModel = (typeof FISH_MODELS)[number]["value"];

export function VoiceSettings({
  bot,
  onPatch,
  workspaceConfigurationLocked = false,
}: {
  bot: Bot;
  onPatch: (patch: Partial<Pick<Bot, "voice" | "speakReplies" | "voiceNotes">>) => void;
  workspaceConfigurationLocked?: boolean;
}) {
  const { state, dispatch } = useStore();
  const tts = state.config?.tts;

  const [keyDraft, setKeyDraft] = useState<VoiceKeyDraft>({ provider: null, value: "" });
  const [serverUrl, setServerUrl] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingServer, setSavingServer] = useState(false);
  const [savingFishModel, setSavingFishModel] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<Array<{ id: string; label: string; description?: string }>>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);

  const { capabilities } = useDesktopCapabilities();
  const localMacClient = workspaceConfigurationLocked && localSystemVoicesAvailable();
  const [deviceProvider, setDeviceProvider] = useState<RemoteVoiceProvider>(() => remoteVoiceProvider());
  const [deviceVoice, setDeviceVoice] = useState(() => remoteSystemVoice(bot.id));
  const usesLocalSystem = localMacClient && deviceProvider === "system";
  const provider = tts?.provider ?? "elevenlabs";
  const cloudProvider = provider === "fish"
    ? {
        id: "fish" as const,
        name: "Fish Audio",
        credential: "fishAudioKey" as const,
        configField: "fishKey" as const,
        placeholder: uiText("ui.VoiceSettings.725524a31d"),
        keyUrl: "https://fish.audio/app/api-keys/",
      }
    : provider === "elevenlabs"
      ? {
          id: "elevenlabs" as const,
          name: "ElevenLabs",
          credential: "ttsKey" as const,
          configField: "key" as const,
          placeholder: uiText("ui.VoiceSettings.f9b4830fb9"),
          keyUrl: "https://elevenlabs.io/app/settings/api-keys",
        }
      : null;
  const key = cloudProvider ? voiceKeyDraftValue(keyDraft, cloudProvider.id) : "";
  const hostProviderLabel = provider === "fish"
    ? uiText("ui.VoiceSettings.f2b286a867")
    : provider === "elevenlabs"
      ? "Host · ElevenLabs"
      : provider === "chatterbox"
        ? "Host · Chatterbox"
        : provider === "xai" ? t("voice.grok.host") : uiText("ui.VoiceSettings.0dda63b47a");
  const systemVoicesAvailable = capabilities.host.platform === "darwin";
  const hostConfigured = Boolean(tts?.configured);
  const included = Boolean(tts?.included);
  const configured = usesLocalSystem || hostConfigured;

  useEffect(() => {
    setDeviceVoice(remoteSystemVoice(bot.id));
  }, [bot.id]);

  useEffect(() => {
    setServerUrl(tts?.baseUrl ?? "");
    setModel(tts?.model ?? "");
  }, [tts?.baseUrl, tts?.model]);

  // Security: discard the draft on every provider change, and keep it tagged, so one provider's credential never goes
  // to another service.
  useEffect(() => {
    setKeyDraft({ provider: null, value: "" });
  }, [provider]);

  useEffect(() => {
    if (usesLocalSystem) {
      const load = () => setVoices(listLocalSystemVoices());
      load();
      window.speechSynthesis.addEventListener("voiceschanged", load);
      return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
    }
    if (!hostConfigured) {
      setVoices([]);
      return;
    }
    let alive = true;
    setLoadingVoices(true);
    api("/api/tts/voices")
      .then((r: { voices?: typeof voices; error?: string }) => {
        if (!alive) return;
        setVoices(r.voices ?? []);
        if (r.error) setError(r.error);
      })
      .catch(() => alive && setVoices([]))
      .finally(() => alive && setLoadingVoices(false));
    return () => {
      alive = false;
    };
  }, [hostConfigured, provider, usesLocalSystem]);

  const chooseDeviceProvider = (next: RemoteVoiceProvider) => {
    setRemoteVoiceProvider(next);
    setDeviceProvider(next);
    setError(null);
  };

  const chooseVoice = (voiceId: string) => {
    if (usesLocalSystem) {
      setRemoteSystemVoice(bot.id, voiceId);
      setDeviceVoice(voiceId);
      return;
    }
    onPatch({ voice: voiceId });
  };

  const setProvider = (next: "elevenlabs" | "fish" | "system" | "chatterbox" | "xai") => {
    if (next === provider || switching || (next === "system" && !systemVoicesAvailable)) return;
    setSwitching(true);
    setKeyDraft({ provider: null, value: "" });
    setError(null);
    api("/api/config", { method: "PUT", body: JSON.stringify({ tts: { provider: next } }) })
      .then((status: ConfigStatus) => dispatch({ type: "configStatus", config: status }))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSwitching(false));
  };

  const saveKey = () => {
    const nextKey = key.trim();
    if (!nextKey || !cloudProvider || keyDraft.provider !== cloudProvider.id) return Promise.resolve();
    setSaving(true);
    setError(null);
    const request = window.ogb?.setCredential
      ? window.ogb.setCredential(cloudProvider.credential, nextKey)
      : api("/api/config", {
          method: "PUT",
          body: JSON.stringify({ tts: { [cloudProvider.configField]: nextKey } }),
        });
    return request
      .then((status: ConfigStatus) => {
        dispatch({ type: "configStatus", config: status });
        setKeyDraft({ provider: null, value: "" });
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };

  const saveServer = () => {
    const next = serverUrl.trim();
    if (!next || savingServer) return Promise.resolve();
    if (!/^https?:\/\//i.test(next)) {
      setError(uiText("ui.VoiceSettings.5b6b94d647"));
      return Promise.resolve();
    }
    setSavingServer(true);
    setError(null);
    return api("/api/config", { method: "PUT", body: JSON.stringify({ tts: { baseUrl: next, model: model.trim() } }) })
      .then((status: ConfigStatus) => dispatch({ type: "configStatus", config: status }))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSavingServer(false));
  };

  const saveFishModel = (next: FishModel) => {
    if (next === tts?.fishModel || savingFishModel) return;
    setSavingFishModel(true);
    setError(null);
    api("/api/config", { method: "PUT", body: JSON.stringify({ tts: { fishModel: next } }) })
      .then((status: ConfigStatus) => dispatch({ type: "configStatus", config: status }))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSavingFishModel(false));
  };

  if (!tts) return null;

  const selectedVoice = usesLocalSystem ? deviceVoice : (bot.voice ?? "");
  const ready = usesLocalSystem || (hostConfigured && Boolean(selectedVoice || tts.voice));

  return (
    <div className="rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">{uiText("call.live.voice")}</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        {localMacClient
          ? uiText("ui.VoiceSettings.f7ff24ad94")
          : workspaceConfigurationLocked
            ? uiText("ui.VoiceSettings.7dda082a89")
            : <>{uiText("ui.VoiceSettings.193c3acf55")} {provider === "system"
                ? systemVoicesAvailable
                  ? uiText("ui.VoiceSettings.4610cee16b")
                  : uiText("ui.VoiceSettings.853aad793a")
                : provider === "xai"
                  ? uiText("ui.VoiceSettings.50843318c9", { value1: String(uiText("voice.grok.sharedKey")) })
                : provider === "chatterbox"
                  ? uiText("ui.VoiceSettings.4a74f76f68")
                  : uiText("ui.VoiceSettings.b74640229a", { value1: String(cloudProvider?.name ?? uiText("ui.VoiceSettings.1666dbdf18")) })}</>}
      </div>

      {localMacClient && (
        <div className="mt-4">
          <div className="mb-2 text-[13px] text-ink-secondary">{uiText("ui.VoiceSettings.ea3f10b105")}</div>
          <div className="inline-flex rounded-xl bg-inset p-1" role="radiogroup" aria-label={uiText("ui.VoiceSettings.ea3f10b105")}>
            {([
              { value: "system", label: uiText("ui.VoiceSettings.4e9b08a188"), available: true },
              { value: "host", label: hostProviderLabel, available: hostConfigured },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={deviceProvider === option.value}
                disabled={!option.available}
                title={!option.available ? uiText("ui.VoiceSettings.4a1d339053") : undefined}
                onClick={() => chooseDeviceProvider(option.value)}
                className={cn(
                  "rounded-lg px-3.5 py-1.5 text-[12.5px] transition-colors disabled:opacity-50",
                  deviceProvider === option.value ? "bg-raised text-ink shadow" : "text-ink-secondary hover:text-ink",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!workspaceConfigurationLocked && (
        <div className="mt-4">
          <div className="mb-2 text-[13px] text-ink-secondary">{uiText("ui.VoiceSettings.a9bef3a9ee")}</div>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-inset p-1" role="radiogroup" aria-label={uiText("ui.VoiceSettings.a9bef3a9ee")}>
            {([
              { value: "elevenlabs", label: uiText("ui.VoiceSettings.91268016fe"), available: true },
              { value: "fish", label: uiText("ui.VoiceSettings.243024e3cf"), available: true },
              { value: "system", label: uiText("ui.VoiceSettings.4e9b08a188"), available: systemVoicesAvailable },
              { value: "chatterbox", label: uiText("ui.VoiceSettings.9a9b2d014e"), available: true },
              { value: "xai", label: t("voice.grok.label"), available: true },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={provider === option.value}
                disabled={switching || !option.available}
                title={!option.available ? uiText("ui.VoiceSettings.3b7b2529c3") : undefined}
                onClick={() => setProvider(option.value)}
                className={cn(
                  "rounded-lg px-3.5 py-1.5 text-[12.5px] transition-colors disabled:opacity-50",
                  provider === option.value ? "bg-raised text-ink shadow" : "text-ink-secondary hover:text-ink",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!workspaceConfigurationLocked && cloudProvider && (
        <div className="mt-4">
        <div className="mb-1.5 flex items-center gap-2 text-[13px] text-ink-secondary">
          <span className={cn("size-1.5 rounded-full", configured ? "bg-success" : "bg-raised-hover")} />
          <span>{cloudProvider.name} {uiText("ui.VoiceSettings.2c70e12b7a")}</span>
          {configured && <span className="text-[11px] text-success">{included ? t("keys.includedWithCloudPro") : uiText("cloudWelcome.engine.connected")}</span>}
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKeyDraft({ provider: cloudProvider.id, value: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && key.trim() && void saveKey()}
            placeholder={configured && !included ? uiText("keys.replace") : cloudProvider.placeholder}
            aria-label={uiText("ui.VoiceSettings.47aefcbe17", { value1: String(cloudProvider.name) })}
            autoComplete="off"
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          <button
            onClick={() => void saveKey()}
            disabled={saving || !key.trim()}
            className="flex w-[72px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-control py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <><Check size={13} />{uiText("common.save")}</>}
          </button>
        </div>
        {!configured && (
          <a
            href={cloudProvider.keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-block text-[12px] font-medium text-accent hover:underline"
          > {uiText("ui.VoiceSettings.2bf33a49a1")} {cloudProvider.name}
          </a>
        )}
        </div>
      )}

      {!workspaceConfigurationLocked && provider === "fish" && (
        <div className="mt-4">
          <div className="mb-1.5 text-[13px] text-ink-secondary">{t("voice.fish.model")}</div>
          <Select
            value={tts.fishModel ?? "s2.1-pro"}
            onChange={(e) => saveFishModel(e.target.value as FishModel)}
            disabled={savingFishModel}
            aria-label={t("voice.fish.model")}
            className="w-full"
          >
            {FISH_MODELS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </Select>
          <div className="mt-1.5 text-[11.5px] leading-relaxed text-ink-secondary">{t("voice.fish.modelHint")}</div>
        </div>
      )}

      {provider === "xai" && (
        <p className="mt-4 text-[13px] text-ink-secondary">
          {hostConfigured ? t("voice.grok.ready") : t("voice.grok.missingKey")}
        </p>
      )}

      {!workspaceConfigurationLocked && provider === "chatterbox" && (
        <div className="mt-4">
        <div className="mb-1.5 flex items-center gap-2 text-[13px] text-ink-secondary">
          <span className={cn("size-1.5 rounded-full", configured ? "bg-success" : "bg-raised-hover")} />
          <span>{uiText("ui.VoiceSettings.5ea7b42a58")}</span>
          {configured && <span className="text-[11px] text-success">{uiText("settings.profile.saved")}</span>}
        </div>
        <div className="flex gap-2">
          <input
            type="url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void saveServer()}
            placeholder="http://127.0.0.1:4123"
            aria-label={uiText("ui.VoiceSettings.311d2a24a8")}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          <button
            onClick={() => void saveServer()}
            disabled={savingServer || !serverUrl.trim()}
            className="flex w-[72px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-control py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingServer ? <Loader2 size={13} className="animate-spin" /> : <><Check size={13} />{uiText("common.save")}</>}
          </button>
        </div>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void saveServer()}
          placeholder={uiText("ui.VoiceSettings.9bc8f1bf41")}
          aria-label={uiText("ui.VoiceSettings.17daafc097")}
          autoComplete="off"
          spellCheck={false}
          className="mt-2 w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        <div className="mt-1.5 text-[11.5px] leading-relaxed text-ink-secondary"> {uiText("ui.VoiceSettings.2972b3a16c")}{" "}
          <a
            href="https://github.com/resemble-ai/chatterbox"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent hover:underline"
          >{uiText("ui.VoiceSettings.2d2bcb2286")}</a>
        </div>
        </div>
      )}

      {configured && (
        <div className="mt-4">
          <div className="mb-1.5 text-[13px] text-ink-secondary">{uiText("call.live.voice")}</div>
          <div className="flex gap-2">
            <Select
              value={selectedVoice}
              onChange={(e) => chooseVoice(e.target.value)}
              aria-label={uiText("ui.VoiceSettings.825fd74e0d", { value1: String(bot.name) })}
              data-voice-picker
              className="w-full"
            >
              <option value="">
                {loadingVoices
                  ? uiText("ui.VoiceSettings.cb5620abfd")
                  : usesLocalSystem
                    ? uiText("ui.VoiceSettings.f3f7a6130a")
                    : tts.voice
                      ? uiText("ui.VoiceSettings.8ef3f9c126")
                      : uiText("ui.VoiceSettings.81a82c1726")}
              </option>
              {selectedVoice && !voices.some((voice) => voice.id === selectedVoice) && (
                <option value={selectedVoice}>{uiText("ui.VoiceSettings.006c76db10")}</option>
              )}
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                  {v.description ? uiText("ui.VoiceSettings.f87f72ece8", { value1: String(v.description) }) : ""}
                </option>
              ))}
            </Select>
            <button
              onClick={() => void speaker.speak(tLiteral(SAMPLE), { voiceId: bot.voice, botId: bot.id })}
              disabled={!ready}
              title={ready ? uiText("ui.VoiceSettings.d03e7675ca") : uiText("ui.VoiceSettings.22c3f0d10e")}
              aria-label={uiText("ui.VoiceSettings.d03e7675ca")}
              className="flex w-[72px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-control py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Volume2 size={14} />{uiText("ui.VoiceSettings.85d6c0718c")}</button>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-hairline/40 pt-4">
        <div>
          <div className="text-[13px] font-medium text-ink">{uiText("ui.VoiceSettings.462e512a3f")}</div>
          <div className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">{uiText("ui.VoiceSettings.ac01e6dd0a")}</div>
        </div>
        <Switch
          checked={Boolean(bot.speakReplies)}
          aria-label={uiText("ui.VoiceSettings.29821fcbfa")}
          onClick={() => onPatch({ speakReplies: !bot.speakReplies })}
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-ink">{uiText("ui.VoiceSettings.496bcd8a50")}</div>
          <div className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">{uiText("ui.VoiceSettings.2f16062c28")}</div>
        </div>
        <Switch
          checked={bot.voiceNotes !== false}
          aria-label={uiText("ui.VoiceSettings.cfdf95c2c9")}
          onClick={() => onPatch({ voiceNotes: bot.voiceNotes === false })}
        />
      </div>

      {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}
