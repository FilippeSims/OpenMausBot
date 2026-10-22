import { messageFileRoots } from "./message-file.ts";
import { workspaceDir } from "./workspace.ts";
import { ATTACHMENTS_DIR } from "./attachments.ts";
import type { Store } from "./store.ts";

export function threadMessageFileRoots(store: Pick<Store, "botByThread" | "groupByThread" | "taskByThread" | "groupTaskByThread">, senderId: string, threadId: string): string[] {
  const bot = store.botByThread(threadId);
  if (bot) return messageFileRoots({ senderWorkspace: workspaceDir(senderId), attachments: ATTACHMENTS_DIR,
    pinnedCwd: store.taskByThread(bot.id, threadId)?.cwd, configuredCwd: bot.cwd });
  const group = store.groupByThread(threadId);
  const task = group ? store.groupTaskByThread(group.id, threadId) : undefined;
  const pinnedCwd = group ? task ? task.pinnedCwd : group.threadId === threadId ? group.pinnedCwd : undefined : undefined;
  return messageFileRoots({ senderWorkspace: workspaceDir(senderId), attachments: ATTACHMENTS_DIR,
    pinnedCwd, configuredCwd: group?.cwd });
}
