import { z } from "zod";
import { PASS, type RouteHandler } from "./table.ts";
import type { NotificaWorkspaceService } from "../notifica-workspace.ts";

export function createNotificaWorkspaceRoutes(service: NotificaWorkspaceService, writable: () => void): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/notifica/workspace" && path !== "/api/notifica/workspace/retry") return PASS;
    res.setHeader("cache-control", "no-store");
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Somente o proprietário ou administrador pode conectar a empresa ao Notifica." });
    try {
      if (method === "GET" && path === "/api/notifica/workspace") return json(res, 200, service.status());
      if (method === "PUT" && path === "/api/notifica/workspace") {
        const body = await readBody(req, 64_000); writable(); return json(res, 200, service.configure(body));
      }
      if (method === "POST" && path.endsWith("/retry")) { writable(); return json(res, 200, service.retry()); }
      return json(res, 405, { error: "Unsupported Notifica workspace operation." });
    } catch (error) {
      return json(res, error instanceof z.ZodError ? 400 : (error as { status?: number }).status ?? 500,
        { error: error instanceof z.ZodError ? "Confira os nomes das empresas e a empresa de cada time." : error instanceof Error ? error.message : "Não foi possível salvar a conexão." });
    }
  };
}
