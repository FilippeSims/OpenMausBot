import { t as uiText } from "@/lib/i18n";
import type { InstanceInfo } from "@/state/store";
import { canWorkOnCloud, type CloudEngine } from "../../shared/cloud-computer";
import { isCloudComputerBusyMessage } from "../../shared/computer-contention";

export function isRemoteScreenshotContention(error: { status: number; message: string }): boolean {
  return error.status === 409 && [
    uiText("ui.remote-desktop.9c797510f9"),
    uiText("ui.remote-desktop.65f0d668ba"),
    uiText("ui.remote-desktop.3134a1ca33"),
    uiText("ui.remote-desktop.373dee1a4c"),
  ].includes(error.message);
}

export function isActiveTurnRefusal(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { status, message } = error as { status?: unknown; message?: unknown };
  if (status !== undefined && status !== 409) return false;
  return typeof message === "string" && isCloudComputerBusyMessage(message);
}

export function remoteScreenshotSource(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const frame = raw as { png?: unknown; format?: unknown };
  if (typeof frame.png !== "string" || !frame.png || !/^[A-Za-z0-9+/=]+$/.test(frame.png)) return null;
  if (frame.format !== "png" && frame.format !== "jpeg") return null;
  return `data:${frame.format === "jpeg" ? "image/jpeg" : "image/png"};base64,${frame.png}`;
}

export function cloudEngineOf(instance: InstanceInfo | undefined): CloudEngine {
  return { computerMcp: instance?.capabilities?.computerMcp };
}

export function boatCapableEngine(instances: readonly InstanceInfo[], selectedId?: string): InstanceInfo | undefined {
  const selected = selectedId ? instances.find(instance => instance.instanceId === selectedId) : undefined;
  return selected && canWorkOnCloud(cloudEngineOf(selected)) ? selected : undefined;
}
