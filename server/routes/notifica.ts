import { z } from "zod";
import { PASS, type RouteHandler } from "./table.ts";
import type { NotificaService } from "../notifica.ts";

const settings = z.object({ enabled: z.boolean(), key: z.string().trim().min(1).max(4_096).regex(/^[!-~]+$/).optional(), replacePendingKey: z.boolean().optional() }).strict();

export function createNotificaRoutes(service: NotificaService, exists: (botId: string) => boolean, writable: () => void): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = /^\/api\/bots\/([\w-]+)\/notifica(\/retry)?$/.exec(path);
    if (!match) return PASS;
    res.setHeader("cache-control", "no-store");
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Only a workspace owner or admin can configure Notifica." });
    const botId = match[1];
    if (!exists(botId)) return json(res, 404, { error: "No such bot." });
    try {
      if (method === "GET" && !match[2]) return json(res, 200, service.status(botId));
      if (method === "PUT" && !match[2]) {
        const body = settings.parse(await readBody(req, 12_000));
        writable();
        if (!exists(botId)) return json(res, 404, { error: "No such bot." });
        return json(res, 200, service.configure(botId, body));
      }
      if (method === "POST" && match[2]) { writable(); return json(res, 200, service.retry(botId)); }
      return json(res, 405, { error: "Unsupported Notifica operation." });
    } catch (error) {
      return json(res, error instanceof z.ZodError ? 400 : (error as { status?: number }).status ?? 500,
        { error: error instanceof z.ZodError ? "Invalid Notifica settings." : error instanceof Error ? error.message : "Notifica settings could not be saved." });
    }
  };
}
