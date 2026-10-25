import { useSyncExternalStore } from "react";
import type { MessageAttachmentContext, PreviewImage } from "@/components/AttachmentPreview";

export type MessageFilePreview = { path: string; name: string; message: MessageAttachmentContext; entry?: string };
export type FilePreviewSource = MessageFilePreview | { image: PreviewImage; images?: PreviewImage[] };
type OpenPreview = { source: FilePreviewSource; id: number; returnFocus: HTMLElement | null };
let current: OpenPreview | null = null;
let sequence = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function openFilePreview(source: FilePreviewSource) {
  current = { source, id: ++sequence, returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null };
  for (const listener of listeners) listener();
}

export function closeFilePreview() {
  const focus = current?.returnFocus;
  current = null;
  for (const listener of listeners) listener();
  if (focus) requestAnimationFrame(() => { if (focus.isConnected) focus.focus(); });
}

export function useFilePreview() {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
