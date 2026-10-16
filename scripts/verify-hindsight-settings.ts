// Real settings and API against a disposable home and synthetic Hindsight service.
import { createServer } from "node:http";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal, type MountedPreview } from "./testing/preview-fixture.ts";
const requests: Array<{ method: string; path: string }> = [];
const service = createServer((req, res) => {
  requests.push({ method: req.method ?? "", path: req.url ?? "" });
  res.setHeader("content-type", "application/json");
  if (req.url === "/health") res.end(JSON.stringify({ status: "healthy" }));
  else if (req.url === "/bad/health") res.writeHead(401).end(JSON.stringify({ error: "DO_NOT_ECHO_TEST_SECRET" }));
  else res.end(JSON.stringify({ success: true }));
});
await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
const serviceUrl = `http://127.0.0.1:${(service.address() as { port: number }).port}`;
const fixture = await launchVerificationServer();
let ui: MountedPreview | undefined;
try {
  const response = await fetch(`${fixture.info.url}/api/config`, { method: "PUT", headers: { "content-type": "application/json", origin: fixture.info.url },
    body: JSON.stringify({ language: "pt-br", memory: { captureQuietMs: 12345, tidyHour: 4, hindsight: { enabled: false, url: serviceUrl } } }) });
  if (!response.ok) throw new Error(`Fixture config HTTP ${response.status}`);
  ui = await mountPreview(fixture, { entry: "/src/testing/hindsight-settings.tsx", route: "/__hindsight-settings.html", title: "Hindsight settings — isolated fixture", extraRoutes: [{
    path: "/__fixture/requests", handler(_req, res) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(requests)); },
  }] });
  console.log(JSON.stringify({ ...fixture.info, serviceUrl, previewUrl: ui.previewUrl }));
  await parkUntilSignal();
} finally { await ui?.close(); await fixture.close(); await new Promise<void>((resolve) => service.close(() => resolve())); }
