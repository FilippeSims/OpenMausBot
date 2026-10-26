import { fromMarkdown } from "mdast-util-from-markdown";
import { windowsPathDestinations } from "../shared/markdown-windows-paths.ts";
import { ATTACHMENTS_DIR } from "./attachments.ts";
import { deliveredCopy } from "./bot-attachment.ts";
import { messageFileDownloadName, messageFileTargets, messageReferencesFile, openMessageFile, referencedFileName, type OpenedMessageFile } from "./message-file.ts";
import { threadMessageFileRoots } from "./message-file-roots.ts";
import { NOTIFICA_ATTACHMENT_MAX_BYTES } from "./notifica-client.ts";
import { notificaOriginExists } from "./notifica-host.ts";
import type { NotificaOrigin } from "./notifica-state.ts";
import type { Message, Store } from "./store.ts";

export type WorkspaceOutput = { role?: "user" | "agent"; at?: number; id: string; text: string; files?: Array<{ href: string; name: string }> };
type Node = { type: string; url?: string; identifier?: string; value?: string; alt?: string; children?: Node[]; position?: { start: { offset?: number }; end: { offset?: number } } };
const walk = (node: Node, visit: (node: Node) => void): void => { visit(node); for (const child of node.children ?? []) walk(child, visit); };
const label = (node: Node): string => node.value ?? node.alt ?? (node.children ?? []).map(label).join("");
const localPage = (href: string): boolean => {
  try { const url = new URL(href); return /^https?:$/.test(url.protocol) && /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname); } catch { return false; }
};

export function workspaceOutput(message: Message): WorkspaceOutput {
  const text = message.text ?? "", targets = new Set(messageFileTargets(text));
  const files = new Map<string, { href: string; name: string }>();
  for (const href of targets) files.set(href, { href, name: messageFileDownloadName(undefined, referencedFileName(href) ?? "arquivo") });
  for (const attachment of message.attachments ?? []) files.set(attachment.path, { href: attachment.path,
    name: messageFileDownloadName("name" in attachment ? attachment.name : undefined, referencedFileName(attachment.path) ?? "arquivo") });
  const ast = fromMarkdown(text, { mdastExtensions: [windowsPathDestinations] }) as Node;
  const definitions = new Map<string, string>(), edits: Array<{ start: number; end: number; text: string }> = [];
  walk(ast, node => { if (node.type === "definition" && node.identifier && node.url && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url); });
  walk(ast, node => {
    const href = node.url ?? (node.identifier ? definitions.get(node.identifier) : undefined);
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (!href || (!targets.has(href) && !localPage(href)) || start === undefined || end === undefined) return;
    if (node.type === "definition") edits.push({ start, end, text: "" });
    else if (["link", "image", "linkReference", "imageReference"].includes(node.type)) {
      const name = label(node) || files.get(href)?.name || "arquivo";
      edits.push({ start, end, text: name.replaceAll("[", "").replaceAll("]", "").replace(/[<>]/g, "") + (localPage(href) ? " (endereço local, disponível no computador de origem)" : "") });
    }
  });
  let output = text;
  const outerEdits = edits.filter(edit => !edits.some(outer => outer !== edit && outer.start <= edit.start && outer.end >= edit.end));
  for (const edit of outerEdits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return { id: message.id, text: output, ...(files.size ? { files: [...files.values()] } : {}) };
}

export function workspaceOutputs(store: Store, origin: NotificaOrigin, since: number, redact: (text: string) => string): WorkspaceOutput[] {
  return store.messagesFor(origin.threadId).filter(message => message.at >= since && (message.role === "bot" || (message.role === "user" && !message.sendId?.startsWith("notifica-"))) && message.kind === "text"
    && (message.text?.trim() || message.attachments?.length) && (!message.from?.botId || message.from.botId === origin.botId))
    .map(message => { const output = workspaceOutput(message); return { ...output, at:message.at, ...(message.role === "user" ? {role: "user" as const, files: undefined} : {}), text: redact(output.text) }; });
}

export async function openWorkspaceOutputFile(store: Store, origin: NotificaOrigin, messageId: string, href: string,
  options: { roots?: (senderId: string, threadId: string) => string[]; attachments?: string } = {}): Promise<OpenedMessageFile> {
  const denied = () => Object.assign(new Error("Este arquivo não foi compartilhado nesta mensagem."), { status: 403 });
  if (!notificaOriginExists(store, origin) || store.bot(origin.botId)?.hidden) throw denied();
  const message = store.messagesFor(origin.threadId).find(item => item.id === messageId);
  const direct = store.botByThread(origin.threadId);
  if (!message || message.role !== "bot" || message.kind !== "text" || (message.from?.botId ?? direct?.id) !== origin.botId) throw denied();
  const attachment = message.attachments?.find(item => item.path === href), attachments = options.attachments ?? ATTACHMENTS_DIR;
  if (!attachment && !messageReferencesFile(message.text ?? "", href)) throw denied();
  const roots = attachment ? [attachments] : options.roots?.(origin.botId, origin.threadId) ?? threadMessageFileRoots(store, origin.botId, origin.threadId);
  let file: OpenedMessageFile;
  let name = attachment && "name" in attachment ? attachment.name : undefined;
  try { file = await openMessageFile(href, roots, { maxBytes: NOTIFICA_ATTACHMENT_MAX_BYTES }); }
  catch (error) {
    const failure = error as { code?: string; status?: number };
    const linkedName = !attachment && (failure.code === "outside_workspace" || failure.status === 404) ? referencedFileName(href) : null;
    const copy = linkedName ? deliveredCopy(store.messagesFor(origin.threadId), message, linkedName) : null;
    if (!copy) throw error;
    file = await openMessageFile(copy.path, [attachments], { maxBytes: NOTIFICA_ATTACHMENT_MAX_BYTES }); name = copy.name;
  }
  if (attachment?.kind === "image" && !file.mime.startsWith("image/")) { await file.handle.close(); throw denied(); }
  return { ...file, name: messageFileDownloadName(name, file.name) };
}
