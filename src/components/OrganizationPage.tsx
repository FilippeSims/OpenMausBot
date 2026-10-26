import { useCallback, useEffect, useState } from "react";
import { api, useStore } from "@/state/store";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { Organizer } from "./organizer/Organizer";
import type { Operation, Result } from "./organizer/model";
export function OrganizationPage() {
  const owner = useOwnerOrAdmin(),
    { dispatch } = useStore(),
    [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (owner !== true) return;
    let alive = true;
    void api<{ bots: { id: string; name: string }[] }>("/api/bots?messages=0")
      .then((result) => {
        if (alive)
          setAgents(result.bots.map((bot) => ({ id: bot.id, name: bot.name })));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [owner]);
  const request = useCallback(
    (op: Operation) =>
      api<Result>("/api/notifica/organization", {
        method: "POST",
        body: JSON.stringify(op),
      }),
    [],
  );
  return (
    <main className="h-full min-w-0 flex-1 overflow-auto p-5 sm:p-8">
      {owner === null ? (
        <p>Verificando acesso…</p>
      ) : owner === false ? (
        <p>
          A organização pessoal está disponível ao proprietário desta
          instalação.
        </p>
      ) : (
        <>
          <div className="mb-4 flex justify-end">
            <button
              className="ui-button"
              onClick={() =>
                dispatch({
                  type: "toggleAppSettings",
                  open: true,
                  section: "connections",
                })
              }
            >
              Conexão Notifica
            </button>
          </div>
          <Organizer request={request} agents={agents} />
        </>
      )}
    </main>
  );
}
