import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { api, useStore } from "@/state/store";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import type { NotificaWorkspaceStatus } from "../../shared/notifica";
export function NotificaConversationButton({
  botId,
  threadId,
}: {
  botId: string;
  threadId: string;
}) {
  const owner = useOwnerOrAdmin(),
    { dispatch } = useStore(),
    [status, setStatus] = useState<NotificaWorkspaceStatus>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (owner !== true) return;
    let alive = true;
    const refresh = () =>
      void api<NotificaWorkspaceStatus>("/api/notifica/workspace")
        .then((value) => {
          if (alive) setStatus(value);
        })
        .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [owner, botId, threadId]);
  if (owner !== true || !status?.enabled) return null;
  const linked = status.conversations?.find(
      (c) => c.botId === botId && c.threadId === threadId,
    ),
    others =
      status.conversations?.filter(
        (c) => c.botId === botId && c.threadId !== threadId,
      ) ?? [];
  return (
    <details className="relative text-[12px] text-ink-secondary">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md border border-hairline/40 px-2 py-1">
        <MessageCircle size={14} />
        {linked ? "Notifica · sincronizado" : "Notifica"}
      </summary>
      <div className="absolute right-0 top-full z-50 mt-2 flex w-72 flex-col gap-3 rounded-xl border border-hairline bg-card p-4 shadow-xl">
        <p>
          {linked
            ? "Este tópico e o Notifica compartilham mensagens e respostas."
            : "Você está em um tópico separado. Continue uma conversa sincronizada ou vincule este tópico."}
        </p>
        {others.map((c) => (
          <button
            className="ui-button text-left"
            key={c.threadId}
            onClick={() =>
              dispatch({ type: "switchTask", botId, threadId: c.threadId })
            }
          >
            Abrir {c.title}
          </button>
        ))}
        {linked?.conversationId && (
          <a
            className="ui-button"
            href={`https://notifica-23b9c.web.app/?conversation=${linked.conversationId}`}
            target="_blank"
            rel="noreferrer"
          >
            Abrir a mesma conversa no Notifica
          </a>
        )}
        {!linked && (
          <button
            className="ui-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                setStatus(
                  await api<NotificaWorkspaceStatus>(
                    "/api/notifica/workspace/link",
                    {
                      method: "POST",
                      body: JSON.stringify({ botId, threadId }),
                    },
                  ),
                );
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Não foi possível sincronizar.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Sincronizar este tópico e seu histórico
          </button>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}
