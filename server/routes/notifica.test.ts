import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { json, readBody } from "../harness/http.ts";
import { NotificaService } from "../notifica.ts";
import { dispatchRoutes } from "./table.ts";
import { createNotificaRoutes } from "./notifica.ts";

let server: Server | undefined;
let dir: string | undefined;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

it("keeps bot connections private, validates input and requires admin authority", async () => {
  dir = mkdtempSync(join(tmpdir(), "omb-notifica-routes-"));
  const service = new NotificaService(dir, { ready: () => false, exists: () => true, deliver: async () => {}, changed: () => {} });
  let auth: RequestAuth = { kind: "loopback", scopes: ["admin"] };
  let maintenance = false;
  const routes = [createNotificaRoutes(service, botId => ["a", "b"].includes(botId), () => { if (maintenance) throw Object.assign(new Error("Backup in progress"), { status: 503 }); })];
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, path: url.pathname, url, method: req.method!, auth, json, readBody })) json(res, 404, {});
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (botId: string, body?: unknown, method = body ? "PUT" : "GET") => fetch(`${base}/api/bots/${botId}/notifica`, { method,
    headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  expect((await call("a", { enabled: true, key: "private-secret-a" })).status).toBe(200);
  const get = await call("a"); expect(get.headers.get("cache-control")).toBe("no-store");
  const status = await get.text(); expect(status).toContain('"configured":true'); expect(status).not.toContain("private-secret-a");
  expect(await (await call("b")).json()).toMatchObject({ configured: false });
  expect((await call("a", { enabled: true, key: "bad\nheader" })).status).toBe(400);
  expect((await call("a", { enabled: true, apiUrl: "https://secret-exfil.example" })).status).toBe(400);
  expect((await call("missing")).status).toBe(404);
  maintenance = true; expect((await call("a", { enabled: false })).status).toBe(503); maintenance = false;
  auth = { kind: "loopback", trust: "service", scopes: ["client"] };
  expect((await call("a")).status).toBe(403); expect((await call("a", { enabled: false })).status).toBe(403);
  for (const method of ["GET", "PUT", "POST"]) expect(requiredScope(method, "/api/bots/a/notifica")).toBe("admin");
});
