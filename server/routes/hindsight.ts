import type { AppConfig } from "../config.ts";
import { checkHindsightConnection, hindsightEndpoint } from "../hindsight-memory.ts";
import type { HindsightRuntime } from "../hindsight-runtime.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createHindsightRoutes(deps: { cfg: AppConfig; runtime: HindsightRuntime; cloudHome: boolean }): RouteHandler {
  return async ({ req, res, path, method, readBody, json }) => {
    if (method !== "POST" || path !== "/api/memory/hindsight/test") return PASS;
    if (deps.cloudHome) return json(res, 403, { error: "Hindsight is unavailable on Cloud homes." });
    const body = await readBody(req, 8192);
    if (body.url !== undefined && (typeof body.url !== "string" || body.url.length > 2_000)) {
      return json(res, 400, { error: "Invalid Hindsight URL." });
    }
    res.setHeader("cache-control", "no-store");
    if (body.mode === "embedded" || (body.mode === undefined && body.url === undefined && deps.runtime.mode() === "embedded")) {
      const candidate = deps.runtime.config();
      if (!candidate?.enabled || deps.runtime.mode() !== "embedded") return json(res, 200, { ok: false, reason: "unreachable" });
      return json(res, 200, await checkHindsightConnection(candidate, deps.runtime.apiKey()));
    }
    const candidate = { ...deps.cfg.memory?.hindsight, ...(body.url !== undefined ? { url: body.url } : {}) };
    try { hindsightEndpoint(candidate, process.env.OMB_HINDSIGHT_API_KEY); }
    catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : "Invalid Hindsight configuration." }); }
    return json(res, 200, await checkHindsightConnection(candidate, process.env.OMB_HINDSIGHT_API_KEY));
  };
}
