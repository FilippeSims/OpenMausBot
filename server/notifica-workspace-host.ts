import { createHash } from "node:crypto";
import { liveCardKind } from "../shared/live-approval.ts";
import type { Store, Message } from "./store.ts";
import { peerApprovalOrigin } from "./peer-approval.ts";
import { notificaOriginExists } from "./notifica-host.ts";
import type { WorkspaceApproval } from "./notifica-workspace-state.ts";
import type { NotificaOrigin } from "./notifica-state.ts";

export function workspaceApprovals(store: Store): WorkspaceApproval[] {
  const result: WorkspaceApproval[] = [];
  const collect = (origin: NotificaOrigin, messages: Message[]) => {
    if (!notificaOriginExists(store, origin) || store.bot(origin.botId)?.hidden) return;
    for (const message of messages) {
      const card = message.card;
      if (liveCardKind(card) !== "approval" || !card?.requestId || !card.tool || (message.from?.botId && message.from.botId !== origin.botId)
        || card.teamMemoryRequest || card.webhookRequest || card.appTriggerRequest) continue;
      const expiresIn = card.outboundRequest ? 9 * 60_000 : ["ask_bot", "delegate_bot", "post_to_room"].includes(card.tool) ? 15 * 60_000 : 24 * 60 * 60_000;
      result.push({ id: createHash("sha256").update(JSON.stringify([origin, message.id, card.requestId])).digest("hex"), origin,
        requestId: card.requestId, messageId: message.id, title: card.title, message: card.subtitle, tool: card.tool,
        expiresAt: new Date(message.at + expiresIn).toISOString() });
    }
  };
  for (const bot of store.bots.filter(bot => !bot.hidden)) for (const task of store.tasks(bot.id)) collect({ botId: bot.id, threadId: task.threadId }, store.messagesFor(task.threadId));
  for (const group of store.groups) {
    const threads = new Set([group.threadId, ...store.groupTasks(group.id).map(task => task.threadId)]);
    for (const threadId of threads) for (const message of store.messagesFor(threadId)) {
      const peer = message.card?.requestId ? peerApprovalOrigin(message.card.requestId) : undefined;
      const botId = message.from?.botId ?? (peer?.threadId === threadId && peer.messageId === message.id ? peer.botId : undefined);
      if (botId) collect({ botId, threadId, groupId: group.id }, [message]);
    }
  }
  return result;
}

export function workspaceApprovalState(store: Store, approval: WorkspaceApproval, decision?: "approved" | "denied"): "pending" | "applied" | "cancelled" {
  if (!notificaOriginExists(store, approval.origin) || store.bot(approval.origin.botId)?.hidden) return "cancelled";
  const message = store.messagesFor(approval.origin.threadId).find(message => message.id === approval.messageId);
  const card = message?.card;
  if (!card || card.requestId !== approval.requestId || card.title !== approval.title || card.subtitle !== approval.message || card.tool !== approval.tool
    || (message?.from?.botId && message.from.botId !== approval.origin.botId)) return "cancelled";
  if (card.answered === "allow" || card.answered === "deny") return !decision || card.answered === (decision === "approved" ? "allow" : "deny") ? "applied" : "cancelled";
  return liveCardKind(card) === "approval" ? "pending" : "cancelled";
}
