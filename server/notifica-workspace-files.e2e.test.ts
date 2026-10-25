import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { launchRestartableServer } from "./testing/restartable-server.ts";

it("transfers real message-linked reports, images and videos from an isolated workspace without exposing refused paths", async () => {
  const configured = process.env.OMB_NOTIFICA_ACCEPTANCE_FIXTURE;
  const config = configured ? JSON.parse(readFileSync(configured, "utf8")) : undefined;
  if (config && !/^http:\/\/127\.0\.0\.1:\d+$/.test(config.baseUrl)) throw new Error("Acceptance API must be loopback");
  const auth = config ? await (await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: config.email, password: config.password, returnSecureToken: true }),
  })).json() as { idToken?: string } : undefined;
  if (config && !auth?.idToken) throw new Error("Isolated emulator login failed");
  const callable = async (name: string, data: unknown) => {
    const response = await fetch(config.baseUrl + "/" + name, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${auth!.idToken}` }, body: JSON.stringify({ data }) });
    const value = await response.json() as any; expect(response.ok, JSON.stringify(value)).toBe(true); return value.result;
  };
  const inbox: any[] = [], outputs: any[] = [], uploaded = new Map<string, { attachment: { id: string; name: string; mime: string; bytes: number }; bytes: Buffer; targetBotId: string }>();
  let firstResponseLost = false;
  const remote = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1"), chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks); res.setHeader("content-type", "application/json");
    const send = (value: unknown) => res.end(JSON.stringify(value));
    if (config) {
      const response = await fetch(config.baseUrl + req.url, { method: "POST", headers: { "content-type": req.headers["content-type"] ?? "application/json", Authorization: req.headers.authorization ?? "" }, body: bytes });
      const result = await response.json() as any; res.statusCode = response.status;
      if (response.ok && url.pathname === "/agentAttachment") {
        const eventId = url.searchParams.get("eventId")!, targetBotId = url.searchParams.get("targetBotId")!;
        const existing = uploaded.get(eventId); if (existing) expect(existing.bytes.equals(bytes)).toBe(true);
        uploaded.set(eventId, { attachment: result.attachment, bytes, targetBotId });
        if (!firstResponseLost) { firstResponseLost = true; res.statusCode = 503; return send({ error: "Retry original bytes" }); }
      }
      if (response.ok && url.pathname === "/agentMessage") { const body = JSON.parse(bytes.toString()); if (!outputs.some(item => item.eventId === body.eventId)) outputs.push(body); }
      return send(result);
    }
    if (url.pathname === "/agentAttachment") {
      expect(req.headers["content-type"]).toBe("application/octet-stream"); expect(Number(req.headers["content-length"])).toBe(bytes.length);
      const eventId = url.searchParams.get("eventId")!, name = url.searchParams.get("name")!, targetBotId = url.searchParams.get("targetBotId")!;
      expect(eventId.length).toBeLessThanOrEqual(120); expect(name).not.toMatch(/[\\/]/);
      const existing = uploaded.get(eventId);
      if (existing) { expect(bytes.equals(existing.bytes)).toBe(true); expect(targetBotId).toBe(existing.targetBotId); return send({ attachment: existing.attachment, duplicate: true }); }
      const attachment = { id: createHash("sha256").update(eventId).digest("hex"), name, mime: name.endsWith(".md") ? "text/markdown" : name.endsWith(".png") ? "image/png" : "video/mp4", bytes: bytes.length };
      uploaded.set(eventId, { attachment, bytes, targetBotId });
      if (!firstResponseLost) { firstResponseLost = true; res.statusCode = 503; return send({ error: "Retry original bytes" }); }
      return send({ attachment, duplicate: false });
    }
    const body = JSON.parse(bytes.toString());
    if (url.pathname === "/agentInbox") return send({ messages: inbox });
    if (url.pathname === "/agentAck") { const index = inbox.findIndex(item => item.id === body.messageId); if (index >= 0) inbox.splice(index, 1); return send({ ok: true }); }
    if (url.pathname === "/agentMessage") {
      for (const id of body.attachmentIds ?? []) expect([...uploaded.values()].find(item => item.attachment.id === id)?.targetBotId).toBe(body.targetBotId);
      if (!outputs.some(item => item.eventId === body.eventId)) outputs.push(body);
      return send({ conversationId: "conv-" + body.conversationKey, messageId: body.eventId, alertId: null, duplicate: false });
    }
    return send({ ok: true });
  });
  await new Promise<void>(resolve => remote.listen(0, "127.0.0.1", resolve));
  const remoteUrl = `http://127.0.0.1:${(remote.address() as AddressInfo).port}`;
  const fixture = await launchRestartableServer({ scripted: true, env: { FAKE_CLAUDE_NOTIFICA_URL: remoteUrl } });
  const api = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(fixture.url + path, { method, headers: { "content-type": "application/json", origin: fixture.url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as any; expect(response.ok, JSON.stringify(result)).toBe(true); return result;
  };
  try {
    const bot = (await api("/api/bots", "POST", { name: "File delivery fixture" })).bot;
    const workspace = join(fixture.dataDir, "workspaces", bot.id); mkdirSync(workspace, { recursive: true });
    const artifacts = [
      { name: "report.md", bytes: Buffer.from("# Fixture report\n\nDelivered from the isolated workspace.\n") },
      { name: "picture.png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEbkAAAAASUVORK5CYII=", "base64") },
      { name: "clip.mp4", bytes: Buffer.from("fixture-video-bytes") },
    ];
    for (const artifact of artifacts) writeFileSync(join(workspace, artifact.name), artifact.bytes);
    const oversized = join(workspace, "oversized.mp4"); writeFileSync(oversized, ""); truncateSync(oversized, 50 * 1024 * 1024 + 1);
    const outside = join(fixture.dataDir, "outside.txt"); writeFileSync(outside, "must not upload");
    const reply = `Files are ready.\n\n[Report](${join(workspace, "report.md")})\n![Picture](${join(workspace, "picture.png")})\n[Video](${join(workspace, "clip.mp4")})\n[Too large](${oversized})\n[Outside](${outside})`;
    writeFileSync(fixture.planPath, JSON.stringify({ [bot.id]: { reply } }));
    await api("/api/notifica/workspace", "PUT", { enabled: true, key: config?.workspaceKey ?? config?.token ?? "attachment-fixture-only", companies: [{ id: "fixture", name: "Fixture" }], teamCompanies: {} });
    await expect.poll(async () => (await api("/api/notifica/workspace")).lastSyncAt, { timeout: 20_000 }).toBeTruthy();
    const conversationKey = "notifica:direct:" + bot.id;
    if (config) {
      const { conversationId } = await callable("startConversation", { integrationId: config.integrationId, targetBotId: bot.id });
      await callable("sendToAgent", { conversationId, requestId: randomUUID(), text: "Share the fixture files" });
    } else inbox.push({ id: randomUUID(), conversationId: "conv-" + conversationKey, conversationKey, targetBotId: bot.id, title: "Files", text: "Share the fixture files", kind: "message", createdAt: new Date().toISOString() });
    await expect.poll(() => outputs.filter(item => item.attachmentIds?.length).length, { timeout: 50_000 }).toBe(3);
    await expect.poll(() => outputs.filter(item => item.message.startsWith("Não foi possível transferir")).length, { timeout: 15_000 }).toBe(2);
    expect(uploaded.size).toBe(3);
    for (const artifact of artifacts) expect([...uploaded.values()].find(item => item.attachment.name === artifact.name)?.bytes.equals(artifact.bytes)).toBe(true);
    if (config) for (const item of uploaded.values()) {
      const downloaded = await fetch(config.baseUrl + "/attachments/" + item.attachment.id, { headers: { Authorization: `Bearer ${auth!.idToken}` } });
      expect(downloaded.status).toBe(200); expect(Buffer.from(await downloaded.arrayBuffer()).equals(item.bytes)).toBe(true);
    }
    expect(outputs.find(item => item.message.startsWith("Files are ready."))?.message).not.toContain(fixture.dataDir);
    expect(outputs.some(item => item.message.includes("excede o limite de 50 MiB"))).toBe(true);
    expect(outputs.some(item => item.message.includes("acesso não autorizado"))).toBe(true);
    expect(readdirSync(join(fixture.dataDir, "notifica-workspace-files"))).toEqual([]);
    await fixture.stop(); await fixture.start();
    await new Promise(resolve => setTimeout(resolve, 2500));
    expect(outputs.filter(item => item.attachmentIds?.length)).toHaveLength(3);
    writeFileSync(fixture.logPath + ".workspace-notifica-files.json", JSON.stringify({ realNotifica: Boolean(config), outputs, uploads: [...uploaded.values()].map(item => ({ ...item.attachment, sha256: createHash("sha256").update(item.bytes).digest("hex"), targetBotId: item.targetBotId })), status: await api("/api/notifica/workspace") }, null, 2));
    console.log("Notifica file transfer evidence:", fixture.logPath + ".workspace-notifica-files.json");
  } finally { await fixture.close(); await new Promise<void>(resolve => remote.close(() => resolve())); }
}, 120_000);
