import { PASS, type RouteHandler } from "./table.ts";
import type { NotificaWorkspaceService } from "../notifica-workspace.ts";
export function createNotificaOrganizationRoutes(
  service: NotificaWorkspaceService,
  writable: () => void,
): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/notifica/organization") return PASS;
    res.setHeader("cache-control", "no-store");
    if (!auth.scopes.includes("admin"))
      return json(res, 403, {
        error:
          "Somente o proprietário ou administrador pode acessar a organização pessoal.",
      });
    if (method !== "POST") return json(res, 405, { error: "Use POST." });
    try {
      const input = await readBody(req, 64000);
      writable();
      return json(
        res,
        200,
        await service.organization(input, {
          type: "human",
          id: "owner",
          conversation_id: null,
        }),
      );
    } catch (error) {
      return json(res, (error as { status?: number }).status ?? 503, {
        error:
          error instanceof Error ? error.message : "Organização indisponível.",
      });
    }
  };
}
