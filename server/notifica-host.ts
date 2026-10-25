import { acceptedSendMatch } from "./send-idempotency.ts";
import { cancelledChatFollowup } from "./message-db.ts";
import { queuedSteeredMessage, queueSteeredMessage } from "./steer-queue.ts";
import { queuedChannelMessage, queueChannelMessage } from "./channel-queue.ts";
import type { Store } from "./store.ts";
import type { NotificaEvent, NotificaOrigin } from "./notifica-state.ts";

export function notificaOriginExists(store: Store, origin: NotificaOrigin): boolean {
  if (!store.bot(origin.botId)) return false;
  if (!origin.groupId) return Boolean(store.taskByThread(origin.botId, origin.threadId));
  const group = store.group(origin.groupId);
  return Boolean(group?.memberIds.includes(origin.botId) && (group.dm ? group.threadId === origin.threadId : store.groupTaskByThread(group.id, origin.threadId)));
}

/** The reply is user text in the ordinary durable agent queue, never a shell command or a privileged instruction. */
export function enqueueNotificaReply(store: Store, event: NotificaEvent, sendId: string): void {
  enqueueNotificaText(store, event.origin, event.reply!.text, sendId);
}

export function enqueueNotificaText(store: Store, origin: NotificaOrigin, text: string, sendId: string): void {
  const { botId, threadId, groupId } = origin;
  if (!notificaOriginExists(store, origin) || store.bot(botId)?.hidden) throw new Error("Original bot or task is unavailable");
  const kind = groupId ? "channel" : "bot";
  if (cancelledChatFollowup(kind, groupId ?? botId, threadId, sendId)) throw new Error("This reply was cancelled in the chat queue");
  const accepted = acceptedSendMatch(store.messagesFor(threadId), sendId, text, undefined, groupId ? "chat" : undefined);
  if (accepted.kind === "conflict") throw new Error("Notifica reply content conflicts with its durable receipt");
  if (accepted.kind === "match") return;
  const queued = groupId ? queuedChannelMessage(groupId, threadId, sendId) : queuedSteeredMessage(botId, threadId, sendId);
  if (queued) {
    if (queued.text !== text) throw new Error("Notifica reply conflicts with the queued answer");
    return;
  }
  const options = { sendId, sender: { name: "Notifica" }, trigger: { kind: "user" as const, label: "Notifica" }, replyPriority: true as const };
  if (groupId) queueChannelMessage(groupId, threadId, text, { ...options, targetBotId: botId });
  else queueSteeredMessage(botId, threadId, text, options);
}
