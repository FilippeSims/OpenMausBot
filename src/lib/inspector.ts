import { t as uiText } from "@/lib/i18n";
import type { RuntimeEvent } from "../../shared/runtime-events";
import type { InspectorEntry, NativeRecord } from "../../shared/inspector";
export type { InspectorEntry, InspectorPage, NativeRecord } from "../../shared/inspector";

interface FoldPreview {
  text: string;
  pendingSpace: boolean;
  overflow: boolean;
}

export interface InspectorRow {
  key: string;
  kind: "runtime" | "native";
  at: string;
  tag: string;
  summary: string;
  tone: "boundary" | "error" | "plain";
  data: unknown;
  count: number;
  preview?: FoldPreview;
}

const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const FOLD_PREVIEW_CHARS = 119;

function appendPreview(previous: FoldPreview | undefined, delta: string): FoldPreview {
  const next: FoldPreview = previous ? { ...previous } : { text: "", pendingSpace: false, overflow: false };
  if (next.overflow) return next;
  for (const char of delta) {
    if (/\s/.test(char)) {
      if (next.text) next.pendingSpace = true;
      continue;
    }
    if (next.pendingSpace) {
      if (next.text.length >= FOLD_PREVIEW_CHARS) {
        next.overflow = true;
        break;
      }
      next.text += " ";
      next.pendingSpace = false;
    }
    if (next.text.length >= FOLD_PREVIEW_CHARS) {
      next.overflow = true;
      break;
    }
    next.text += char;
  }
  return next;
}

const previewText = (preview: FoldPreview) => `${preview.text}${preview.overflow ? "…" : ""}`;

export function summarizeRuntime(e: RuntimeEvent): { summary: string; tone: InspectorRow["tone"] } {
  switch (e.type) {
    case "session.started":
      return { summary: uiText("ui.inspector.56754b538f", { value1: String(e.sessionId ?? "(none)"), value2: String(e.model ? ` · ${e.model}` : "") }), tone: "plain" };
    case "session.exited":
      return { summary: uiText("ui.inspector.86c174a85b", { value1: String(e.reason ? ` · ${e.reason}` : "") }), tone: "plain" };
    case "turn.started":
      return { summary: uiText("ui.inspector.5f854fa598", { value1: String(e.turnId ? ` · ${e.turnId.slice(0, 8)}` : "") }), tone: "boundary" };
    case "turn.retrying":
      return { summary: uiText("ui.inspector.f60c52c7ba", { value1: String(e.reason), value2: String(e.attempt), value3: String(Math.round(e.delayMs / 1000)) }), tone: "plain" };
    case "turn.completed": {
      const parts = [e.ok ? "turn ok" : "turn failed"];
      if (e.stopReason) parts.push(e.stopReason);
      if (typeof e.cost === "number") parts.push(`$${e.cost.toFixed(4)}`);
      if (e.denials?.length) parts.push(`${e.denials.length} denied`);
      return { summary: parts.join(" · "), tone: e.ok ? "boundary" : "error" };
    }
    case "turn.wait_started":
      return {
        summary: uiText("ui.inspector.6ba4946eb4", { value1: String(e.holder ? `${e.holder.name}${e.holder.task ? ` (${e.holder.task})` : ""}` : "holder unknown") }),
        tone: "plain",
      };
    case "turn.wait_ended": {
      const seconds = Math.round(e.waitedMs / 1000);
      const waited = e.waitedMs < 1_000 ? "under a second" : `${seconds}s`;
      if (e.outcome === "acquired") return { summary: uiText("ui.inspector.b6ca03b5d6", { value1: String(waited) }), tone: "boundary" };
      if (e.outcome === "parked") return { summary: uiText("ui.inspector.c1141de82d", { value1: String(waited) }), tone: "plain" };
      if (e.outcome === "gave_up") return { summary: uiText("ui.inspector.726b3cf138", { value1: String(waited) }), tone: "error" };
      return { summary: uiText("ui.inspector.f3ee3964d1", { value1: String(waited) }), tone: "plain" };
    }
    case "item.started":
      return { summary: uiText("ui.inspector.9989fa2d2c", { value1: String(e.itemType), value2: String(e.title ? `: ${clip(oneLine(e.title))}` : " started") }), tone: "plain" };
    case "item.updated":
      return { summary: uiText("ui.inspector.ed4968c9f6", { value1: String(e.itemType), value2: String(typeof e.tokens === "number" ? ` · ${e.tokens} tok` : "") }), tone: "plain" };
    case "item.completed":
      if (e.itemType === "assistant_text") return { summary: uiText("ui.inspector.69e9cee5fe", { value1: String(clip(oneLine(e.text))) }), tone: "plain" };
      if (e.itemType === "assistant_image") return { summary: uiText("ui.inspector.9e5235081e"), tone: "plain" };
      return { summary: uiText("ui.inspector.c519a06fdc", { value1: String(e.ok ? "ok" : "failed") }), tone: e.ok ? "plain" : "error" };
    case "content.delta":
      return { summary: uiText("ui.inspector.efae3eb968", { value1: String(e.streamKind), value2: String(clip(oneLine(e.delta))) }), tone: "plain" };
    case "request.opened":
      return {
        summary: uiText("ui.inspector.5628a20aca", { value1: String(e.requestType), value2: String(e.origin === "output" ? " (agent-composed)" : ""), value3: String(e.tool), value4: String(clip(oneLine(e.summary))) }),
        tone: "plain",
      };
    case "request.resolved":
      return { summary: uiText("ui.inspector.b05989ce92", { value1: String(e.behavior), value2: String(e.source) }), tone: "plain" };
    case "thread.token-usage.updated":
      return { summary: uiText("ui.inspector.507ee0fc96", { value1: String(e.input), value2: String(e.output) }), tone: "plain" };
    case "runtime.error":
      return { summary: uiText("ui.inspector.9989fa2d2c", { value1: String(e.setup ? "setup: " : ""), value2: String(clip(oneLine(e.message))) }), tone: "error" };
    case "runtime.notice":
      return { summary: uiText("ui.inspector.c2043a12ba", { value1: String(clip(oneLine(e.message))) }), tone: "plain" };
    default:
      return { summary: (e as { type: string }).type, tone: "plain" };
  }
}

export function summarizeNative(r: NativeRecord): string {
  const msg = r.msg as Record<string, unknown> | null;
  if (!msg || typeof msg !== "object") return String(r.msg);
  const method = typeof msg.method === "string" ? msg.method : undefined;
  const type = typeof msg.type === "string" ? msg.type : undefined;
  const id = msg.id !== undefined ? ` #${String(msg.id)}` : "";
  if (method) return `${method}${id}`;
  // antigravity's stream keys on `event`, with the outcome under result.status
  if (typeof msg.event === "string") {
    const status = (msg.result as Record<string, unknown> | undefined)?.status;
    return typeof status === "string" ? `${msg.event} · ${status}` : msg.event;
  }
  if (type) {
    // claude stream-json: surface role/subtype so a user turn and an assistant chunk don't both read "message"
    const inner = msg.message as Record<string, unknown> | undefined;
    const role = typeof inner?.role === "string" ? ` · ${inner.role}` : "";
    const subtype = typeof msg.subtype === "string" ? ` · ${msg.subtype}` : "";
    return `${type}${subtype}${role}`;
  }
  if (msg.result !== undefined) return `result${id}`;
  if (msg.error !== undefined) return `error${id}`;
  return clip(oneLine(JSON.stringify(msg)));
}

export function toRows(entries: InspectorEntry[]): InspectorRow[] {
  const rows: InspectorRow[] = [];
  for (const [i, entry] of entries.entries()) {
    if (entry.kind === "native") {
      rows.push({
        key: `n${i}`,
        kind: "native",
        at: entry.at,
        tag: entry.data.dir === "out" ? "→ out" : "← in",
        summary: uiText("ui.inspector.7c639bc99b", { value1: String(entry.data.source), value2: String(summarizeNative(entry.data)) }),
        tone: "plain",
        data: entry.data,
        count: 1,
      });
      continue;
    }
    const e = entry.data;
    const last = rows.at(-1);
    if (
      e.type === "content.delta" &&
      last?.kind === "runtime" &&
      last.tag === "content.delta" &&
      (last.data as RuntimeEvent[])[0]?.type === "content.delta" &&
      ((last.data as RuntimeEvent[])[0] as { streamKind: string }).streamKind === e.streamKind
    ) {
      const list = last.data as RuntimeEvent[];
      list.push(e);
      last.count = list.length;
      last.preview = appendPreview(last.preview, e.delta);
      last.summary = `${e.streamKind}: ${previewText(last.preview)}`;
      continue;
    }
    const { summary, tone } = summarizeRuntime(e);
    const preview = e.type === "content.delta" ? appendPreview(undefined, e.delta) : undefined;
    const streamKind = e.type === "content.delta" ? e.streamKind : undefined;
    rows.push({
      key: e.eventId || `r${i}`,
      kind: "runtime",
      at: entry.at,
      tag: e.type,
      summary: preview && streamKind ? `${streamKind}: ${previewText(preview)}` : summary,
      tone,
      data: e.type === "content.delta" ? [e] : e,
      count: 1,
      preview,
    });
  }
  return rows;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}
