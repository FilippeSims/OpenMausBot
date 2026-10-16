import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import type { WireBot } from "../shared/wire.ts";

const destination = process.env.OMB_HINDSIGHT_VERIFY_URL;
const bundle = process.env.OMB_HINDSIGHT_VERIFY_BUNDLE;

it.skipIf(!destination && !bundle)("uses local chunks memory without an LLM through isolated Mausbot tools", async () => {
  let base = "";
  if (!bundle) {
  const endpoint = new URL(destination!);
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
      !endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
    throw new Error("Local Hindsight verification requires an explicit loopback HTTP origin and port.");
  }
  base = endpoint.origin;
  const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5_000) });
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ status: "healthy" });
  }

  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true }, [], undefined, bundle, process.env.OMB_HINDSIGHT_VERIFY_SERVER_ENTRY);
  console.log(JSON.stringify({ verification: "hindsight-local", ...fixture.info, backend: bundle ? "embedded" : "external" }));
  const manifestPath = join(fixture.info.dataDir, "hindsight-index.json");
  type Manifest = { namespace: string; indexed: Record<string, Record<string, string>> };
  const manifest = (): Manifest => existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { namespace: "", indexed: {} };
  const api = async <Result = Record<string, unknown>>(path: string, method = "GET", body?: unknown, status = 200): Promise<Result> => {
    const response = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const result = await response.json();
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result as Result;
  };
  const planPath = join(fixture.info.dataDir, "room-plan.json");
  const plan: Record<string, { steps: unknown[]; reply: string; expectContextIncludes: string[] }> = {};
  type ToolEvidence = { step?: { tool: string }; response?: { result: { content: { text: string }[] } } };
  const search = async (bot: WireBot, steps: unknown[] = [{ tool: "memory_search", arguments: { query: "Quando acontece o lançamento do projeto Aurora?" } }], expectSemantic = true) => {
    plan[bot.id] = { steps, reply: "Memória local consultada.", expectContextIncludes: expectSemantic ? ["Relevant memory retrieved by Hindsight"] : [] };
    writeFileSync(planPath, JSON.stringify(plan));
    await runControlOmb(["send", "--url", fixture.info.url, "--bot", bot.id, "--task", bot.threadId, "--text", "Consulte a memória sobre o lançamento do projeto Aurora."]);
    expect(await runControlOmb(["wait", "--url", fixture.info.url, "--bot", bot.id, "--task", bot.threadId, "--timeout", "30"])).toMatchObject({ status: "settled" });
    const evidence = readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
    return evidence.filter(item => item.botId === bot.id).at(-1).evidence
      .filter((item: ToolEvidence) => item.response && ["memory_search", "memory_share"].includes(item.step?.tool ?? ""))
      .map((item: ToolEvidence) => JSON.parse(item.response!.result.content[0].text));
  };
  try {
    if (bundle) {
      await expect.poll(async () => (await api<{ memory: { hindsight: { runtimeState: string } } }>("/api/config")).memory.hindsight.runtimeState, { timeout: 90_000 }).toBe("ready");
      expect((await api<{ memory: { hindsight: unknown } }>("/api/config")).memory.hindsight).toMatchObject({ enabled: true, mode: "embedded", embeddedAvailable: true, keyConfigured: false });
      expect(await api("/api/memory/hindsight/test", "POST", { mode: "embedded" })).toMatchObject({ ok: true });
    }
    const { bot: scout } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Local Memory Scout", section: "Local Test", memoryUpkeep: false }, 201);
    const { bot: writer } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Local Memory Writer", section: "Local Test", memoryUpkeep: false }, 201);
    await api("/api/config", "PUT", { memory: { hindsight: { enabled: true, ...(bundle ? { mode: "embedded" } : { url: base }), recallTimeoutMs: 5_000, retainTimeoutMs: 60_000 } } });
    const note = "O lançamento do projeto Aurora acontece na sexta-feira. Esta é uma nota fictícia de verificação.\n";
    await api(`/api/bots/${scout.id}/memory/file`, "PUT", { path: "memory/project.md", text: note });
    await expect.poll(() => Object.values(manifest().indexed).some(documents => Boolean(documents["memory/project.md"])), { timeout: 60_000 }).toBe(true);
    const [privateToScout] = await search(writer, undefined, false);
    expect(privateToScout).toMatchObject({ backend: "local", hits: [], local: [], team: [] });

    const [recalled, shared] = await search(scout, [
      { tool: "memory_search", arguments: { query: "Qual é a data do lançamento do projeto Aurora?" } },
      { tool: "memory_share", arguments: { target_bot_id: writer.id, source_path: "memory/project.md", text: note.trim() } },
    ]);
    expect(recalled.backend).toBe("hindsight");
    expect(recalled.hits).toEqual(expect.arrayContaining([expect.objectContaining({ source: "memory/project.md", text: expect.stringContaining("sexta-feira") })]));
    expect(shared.ok).toBe(true);
    const receipt = shared.receipt;
    await expect.poll(() => Object.values(manifest().indexed).some(documents => Boolean(documents[receipt.recipientPath])), { timeout: 60_000 }).toBe(true);
    const [received] = await search(writer);
    expect(received.backend).toBe("hindsight");
    expect(received.hits).toEqual(expect.arrayContaining([expect.objectContaining({ source: receipt.recipientPath,
      metadata: expect.objectContaining({ origin: "shared", author_bot_id: scout.id }) })]));

    const bank = Object.entries(manifest().indexed).find(([, documents]) => documents["memory/project.md"])![0];
    if (!bundle) {
    const reflection = await fetch(`${base}/v1/default/banks/${encodeURIComponent(bank)}/reflect`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "Summarize these synthetic notes." }),
      signal: AbortSignal.timeout(5_000),
    });
    expect(reflection.status).toBe(400);
    }

    const previousRevision = manifest().indexed[bank]["memory/project.md"];
    await api(`/api/bots/${scout.id}/memory/file`, "PUT", { path: "memory/project.md", text: "O lançamento do projeto Aurora foi remarcado para segunda-feira. Nota fictícia atualizada.\n" });
    await expect.poll(() => manifest().indexed[bank]["memory/project.md"] || previousRevision, { timeout: 60_000 }).not.toBe(previousRevision);
    const [updated] = await search(scout);
    expect(updated.backend).toBe("hindsight");
    expect(updated.hits).toEqual(expect.arrayContaining([expect.objectContaining({ source: "memory/project.md", text: expect.stringContaining("segunda-feira") })]));
    expect(updated.hits.some((hit: { text: string }) => hit.text.includes("sexta-feira"))).toBe(false);

    if (bundle) {
      const before = manifest().indexed;
      await api("/api/config", "PUT", { memory: { hindsight: { enabled: false, mode: "embedded" } } });
      await expect.poll(async () => (await api<{ memory: { hindsight: { runtimeState: string } } }>("/api/config")).memory.hindsight.runtimeState).toBe("stopped");
      expect(await api<{ text: string }>(`/api/bots/${scout.id}/memory/file?path=memory%2Fproject.md`)).toMatchObject({ text: expect.stringContaining("segunda-feira") });
      await api("/api/config", "PUT", { memory: { hindsight: { enabled: true, mode: "embedded", recallTimeoutMs: 5_000 } } });
      await expect.poll(async () => (await api<{ memory: { hindsight: { runtimeState: string } } }>("/api/config")).memory.hindsight.runtimeState, { timeout: 30_000 }).toBe("ready");
      expect(manifest().indexed).toEqual(before);
      const [restarted] = await search(scout);
      expect(restarted.backend).toBe("hindsight");
      expect(restarted.hits).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("segunda-feira") })]));
    }

    await api(`/api/bots/${scout.id}/memory/file?path=memory%2Fproject.md`, "DELETE");
    await expect.poll(() => Object.values(manifest().indexed).some(documents => "memory/project.md" in documents), { timeout: 60_000 }).toBe(false);
  } finally {
    const state = manifest();
    await fixture.close();
    const prefix = `omb-${state.namespace}-`;
    for (const bank of Object.keys(state.indexed).filter(name => !bundle && state.namespace && name.startsWith(prefix))) {
      const response = await fetch(`${base}/v1/default/banks/${encodeURIComponent(bank)}`, { method: "DELETE", signal: AbortSignal.timeout(10_000) });
      expect([200, 204, 404], `cleanup ${bank}`).toContain(response.status);
    }
  }
}, 180_000);
