import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import type { WireBot } from "../shared/wire.ts";

it("indexes native memory, recalls it through a real tool, shares explicitly and preserves accepted team memory", async () => {
  type Item = { content: string; document_id: string; tags: string[]; metadata: Record<string, string> };
  const banks = new Map<string, Map<string, Item>>();
  const requests: Array<{ bank: string; path: string; body: Record<string, unknown> }> = [];
  let unavailable = false;
  const remote = createServer(async (request, response) => {
    if (unavailable) { response.writeHead(503).end(); return; }
    const url = new URL(request.url!, "http://127.0.0.1");
    const bank = url.pathname.split("/")[4];
    const records = banks.get(bank) ?? new Map<string, Item>();
    banks.set(bank, records);
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ bank, path: url.pathname, body });
    response.setHeader("content-type", "application/json");
    if (request.method === "DELETE") {
      records.delete(decodeURIComponent(url.pathname.split("/").at(-1)!));
      response.writeHead(204).end();
    } else if (url.pathname.endsWith("/recall")) {
      response.end(JSON.stringify({ results: [...records.values()].filter(item => item.tags.some(tag => body.tags.includes(tag))).map(item => ({
        id: item.document_id, document_id: item.document_id, text: item.content, tags: item.tags,
      })) }));
    } else {
      expect(body.async).toBe(false);
      for (const item of body.items) records.set(item.document_id, item);
      response.end(JSON.stringify({ success: true, async: false, bank_id: bank, items_count: body.items.length }));
    }
  });
  await new Promise<void>(resolve => remote.listen(0, "127.0.0.1", resolve));
  const address = remote.address();
  if (!address || typeof address === "string") throw new Error("No fixture Hindsight port");
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  const api = async <Result = Record<string, unknown>>(path: string, method = "GET", body?: unknown, status = 200): Promise<Result> => {
    const response = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result as Result;
  };
  const planPath = join(fixture.info.dataDir, "room-plan.json");
  const plan: Record<string, { steps?: unknown[]; reply: string; expectContextIncludes?: string[] }> = {};
  const turn = async (bot: WireBot, task: string, expectedStatus = "settled") => {
    writeFileSync(planPath, JSON.stringify(plan));
    await runControlOmb(["send", "--url", fixture.info.url, "--bot", bot.id, "--task", bot.threadId, "--text", task]);
    expect(await runControlOmb(["wait", "--url", fixture.info.url, "--bot", bot.id, "--task", bot.threadId, "--timeout", "30"])).toMatchObject({ status: expectedStatus });
  };
  const evidence = () => existsSync(`${planPath}.evidence.jsonl`) ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const values = () => [...banks.values()].flatMap(records => [...records.values()]);
  try {
    const { bot: scout } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Memory Scout", section: "Marketing", memoryUpkeep: false }, 201);
    const { bot: writer } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Memory Writer", section: "Marketing", memoryUpkeep: false }, 201);
    const { bot: outsider } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Outside", section: "Sales", memoryUpkeep: false }, 201);
    const sectionsPath = join(fixture.info.dataDir, "section-contexts.json");
    const sections = JSON.parse(readFileSync(sectionsPath, "utf8"));
    sections.memoryKeys.Marketing = "Marketing";
    writeFileSync(sectionsPath, JSON.stringify(sections));
    await api("/api/config", "PUT", { memory: { hindsight: { enabled: true, url: `http://127.0.0.1:${address.port}`, recallTimeoutMs: 100 } } });
    await api(`/api/bots/${scout.id}/memory/file`, "PUT", { path: "memory/project.md", text: "The launch is on Friday.\nThe private budget is $500.\n" });
    await expect.poll(() => values().some(item => item.metadata.bot_id === scout.id && item.document_id === "memory/project.md"), { timeout: 10_000 }).toBe(true);
    plan[scout.id] = { steps: [
      { tool: "memory_search", arguments: { query: "launch timing" } },
      { tool: "memory_share", arguments: { target_bot_id: writer.id, source_path: "memory/project.md", text: "The launch is on Friday." } },
      { tool: "memory_share", arguments: { target_bot_id: outsider.id, source_path: "memory/project.md", text: "The launch is on Friday." }, expectError: true },
      { tool: "propose_team_memory", arguments: { kind: "decision", name: "TEAM_ACCEPTED_MARKER", detail: "The team agreed on Friday" } },
    ], reply: "Memory tools completed", expectContextIncludes: ["Relevant memory retrieved by Hindsight"] };
    plan[writer.id] = { reply: "Received" };
    await turn(scout, "Search memory and share the launch timing with Writer.");
    await expect.poll(() => evidence().some(item => item.botId === scout.id), { timeout: 10_000 }).toBe(true);
    const first = evidence().find(item => item.botId === scout.id);
    const search = first.evidence.find((item: { step?: { tool: string } }) => item.step?.tool === "memory_search");
    expect(JSON.parse(search.response.result.content[0].text)).toMatchObject({ backend: "hindsight", hits: [{ source: "memory/project.md" }] });
    const share = first.evidence.find((item: { step?: { tool: string } }) => item.step?.tool === "memory_share");
    const receipt = JSON.parse(share.response.result.content[0].text).receipt;
    const copy = await api<{ text: string }>(`/api/bots/${writer.id}/memory/file?path=${encodeURIComponent(receipt.recipientPath)}`);
    expect(copy.text).toContain("The launch is on Friday.");
    expect(copy.text).not.toContain("$500");
    const team = await api<{ entries: Array<{ id: string; status: string; revision: string }> }>("/api/team-memory?section=Marketing");
    expect(team.entries).toMatchObject([{ status: "accepted" }]);
    await expect.poll(() => values().some(item => item.document_id === team.entries[0].id), { timeout: 10_000 }).toBe(true);
    const teamBank = [...banks].find(([, records]) => records.has(team.entries[0].id))![0];
    await api("/api/sidebar-sections?section=Marketing", "PATCH", { name: "Growth" });
    const renamed = await api<{ entries: Array<{ id: string }> }>("/api/team-memory?section=Growth");
    expect(renamed.entries[0].id).toBe(team.entries[0].id);
    await api("/api/sidebar-sections", "POST", { name: "Marketing" });
    expect((await api<{ entries: unknown[] }>("/api/team-memory?section=Marketing")).entries).toEqual([]);
    plan[writer.id] = { steps: [{ tool: "memory_search", arguments: { query: "launch timing" } }], reply: "Team memory searched" };
    await turn(writer, "Search accepted team memory about launch timing.");
    const teamRequests = requests.filter(request => request.path.endsWith("/recall") && request.bank === teamBank);
    expect(teamRequests.length).toBeGreaterThan(0);
    await api(`/api/bots/${scout.id}/memory/file?path=memory%2Fproject.md`, "DELETE");
    await expect.poll(() => values().some(item => item.metadata.bot_id === scout.id), { timeout: 10_000 }).toBe(false);
    unavailable = true;
    plan[writer.id] = { steps: [{ tool: "memory_search", arguments: { query: "launch Friday" } }], reply: "Local fallback works" };
    await turn(writer, "Recall the Friday launch while Hindsight is unavailable.");
    const last = evidence().filter(item => item.botId === writer.id).at(-1);
    const fallback = last.evidence.find((item: { step?: { tool: string } }) => item.step?.tool === "memory_search");
    const result = JSON.parse(fallback.response.result.content[0].text);
    expect(result.backend).toBe("local");
    expect(result.local.some((item: { file: string }) => item.file === receipt.recipientPath)).toBe(true);
    expect(result.team.some((item: { id: string }) => item.id === team.entries[0].id)).toBe(true);
  } finally {
    await fixture.close();
    remote.closeAllConnections();
    await new Promise<void>((resolve, reject) => remote.close(error => error ? reject(error) : resolve()));
  }
}, 90_000);
