import { t as uiText } from "@/lib/i18n";
export type CallCapabilityHelp = {
  label: string;
  reason: string;
};

const TURNS_NEED_MAC: CallCapabilityHelp = {
  get label() { return uiText("ui.call-capability.d4f9c9b487"); },
  get reason() { return uiText("ui.call-capability.3eb8eda104"); },
};

const TURNS_ON_THIS_COMPUTER: CallCapabilityHelp = {
  get label() { return uiText("ui.call-capability.fef2e15e27"); },
  get reason() { return uiText("ui.call-capability.4d181ddc4a"); },
};

export function callCapabilityHelp(
  capabilities: DesktopCapabilities,
  speechServiceAvailable: boolean,
): CallCapabilityHelp | null {
  if (!capabilities.dictation.available) {
    switch (capabilities.dictation.reasonCode) {
      case "remote-server":
        return capabilities.host.platform === "darwin" ? TURNS_ON_THIS_COMPUTER : TURNS_NEED_MAC;
      case "desktop-app-required":
      case "unsupported-platform":
        return TURNS_NEED_MAC;
      default:
        return {
          label: uiText("ui.call-capability.1ebe33ecf7"),
          reason: uiText("ui.call-capability.50439a92f7"),
        };
    }
  }
  if (!speechServiceAvailable) {
    return {
      label: uiText("ui.call-capability.61aef0b7da"),
      reason: uiText("ui.call-capability.25f2a4d344"),
    };
  }
  return null;
}
