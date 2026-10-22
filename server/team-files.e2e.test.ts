import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import type { WireBot } from "../shared/wire.ts";
import type { TeamFilesListing } from "../shared/team-files.ts";

it("uses team reference files through real bot tools and collects chat deliverables without crossing team boundaries", async () => {
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  const api = async <T = any>(path: string, method = "GET", body?: unknown, expected = 200): Promise<T> => {
    const response = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(expected);
    return result as T;
  };
  const endpoint = (section: string, path = "", content = false) => `/api/team-files${content ? "/content" : ""}?${new URLSearchParams({ section, path })}`;
  const create = async (name: string, section?: string) => (await api<{ bot: WireBot }>("/api/bots", "POST", { name, section }, 201)).bot;
  const planPath = join(fixture.info.dataDir, "room-plan.json");
  const plans: Record<string, unknown> = {};
  const turn = async (bot: WireBot, steps: unknown[], expected: string[] = []) => {
    plans[bot.id] = { reply: "Team file verification complete.", steps, expectSystemIncludes: expected };
    writeFileSync(planPath, JSON.stringify(plans));
    await runControlOmb(["send", "--url", fixture.info.url, "--bot", bot.id, "--task", bot.threadId, "--text", "Use the supplied brand references and save the deliverable for this team."]);
    expect(await runControlOmb(["wait", "--url", fixture.info.url, "--bot", bot.id, "--task", bot.threadId, "--timeout", "30"]))
      .toMatchObject({ status: "settled" });
    return readFileSync(planPath + ".evidence.jsonl", "utf8").trim().split("\n").map(line => JSON.parse(line)).filter(row => row.botId === bot.id).at(-1);
  };
  try {
    const designer = await create("Designer", "Studio");
    const outsider = await create("Other", "Other team");
    const chief = await create("Director");
    await api(`/api/bots/${chief.id}`, "PATCH", { globalChief: true, acknowledgeGlobalAccess: true });
    const restricted = await create("Restricted", "Private team");
    await api(`/api/bots/${restricted.id}`, "PATCH", { visibility: "admins" });
    await api(endpoint("Studio"), "POST", { action: "mkdir", path: "Identidade Visual/Logos" }, 201);
    const logo = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="#124A97"/><text x="15" y="48" fill="white">LUMEN</text></svg>';
    const uploaded = await fetch(fixture.info.url + endpoint("Studio", "Identidade Visual/Logos/logo.svg", true), {
      method: "PUT", headers: { "content-type": "application/octet-stream", origin: fixture.info.url }, body: logo,
    });
    expect(uploaded.status).toBe(201);
    const receipt = await uploaded.json() as { sha256: string };
    const download = await fetch(fixture.info.url + endpoint("Studio", "Identidade Visual/Logos/logo.svg", true));
    expect(await download.text()).toBe(logo);
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(download.headers.get("content-disposition")).toContain("attachment");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    const pngUpload = await fetch(fixture.info.url + endpoint("Studio", "Identidade Visual/Logos/logo.png", true), {
      method: "PUT", headers: { "content-type": "application/octet-stream", origin: fixture.info.url }, body: png,
    });
    expect(pngUpload.status).toBe(201);
    const privateWorkspace = join(fixture.info.dataDir, "task-workspaces", designer.id, designer.threadId);
    mkdirSync(privateWorkspace, { recursive: true });
    writeFileSync(join(privateWorkspace, "proposal.md"), "# LUMEN\nDeliverable using the supplied blue logo.\n");
    writeFileSync(join(privateWorkspace, "layout.png"), png);
    const designerEvidence = await turn(designer, [
      { tool: "team_files", arguments: { action: "list" } },
      { tool: "team_files", arguments: { action: "read", path: "Identidade Visual/Logos/logo.svg" } },
      { tool: "team_files", arguments: { action: "read", path: "Identidade Visual/Logos/logo.png" } },
      { tool: "team_files", arguments: { action: "write", path: "Entregas/brand-notes.md", text: "Use the original LUMEN logo and blue #124A97." } },
      { tool: "team_files", arguments: { action: "list", section: "Other team" }, expectError: true },
      { tool: "attach_file", arguments: { path: join(privateWorkspace, "proposal.md") } },
      { tool: "attach_file", arguments: { path: join(privateWorkspace, "layout.png") } },
    ], ["Shared team files:", "Identidade Visual", "team_files", "Entregas"]);
    const readResult = designerEvidence.evidence.find((entry: any) => entry.step?.tool === "team_files" && entry.step.arguments.action === "read");
    expect(JSON.parse(readResult.response.result.content[0].text)).toMatchObject({ text: logo, sha256: receipt.sha256 });
    const pngResult = designerEvidence.evidence.find((entry: any) => entry.step?.tool === "team_files" && entry.step.arguments.path?.endsWith("logo.png"));
    expect(pngResult.response.result.content[1]).toEqual({ type: "image", mimeType: "image/png", data: png.toString("base64") });
    const studioRoot = (await api<TeamFilesListing>(endpoint("Studio"))).root;
    await expect.poll(async () => {
      const entries = (await api<TeamFilesListing>(endpoint("Studio", "Entregas"))).entries;
      return entries.find(entry => entry.kind === "directory")?.path;
    }, { timeout: 10_000 }).toBe("Entregas/Designer");
    const output = "Entregas/Designer/proposal.md";
    await expect.poll(async () => (await api<TeamFilesListing>(endpoint("Studio", "Entregas/Designer"))).entries.map(entry => entry.name)).toContain("proposal.md");
    expect(await (await fetch(fixture.info.url + endpoint("Studio", output, true))).text()).toContain("Deliverable using the supplied blue logo.");
    const imageOutput = "Entregas/Designer/layout.png";
    await expect.poll(async () => (await fetch(fixture.info.url + endpoint("Studio", imageOutput, true))).status).toBe(200);
    const imageDownload = await fetch(fixture.info.url + endpoint("Studio", imageOutput, true));
    expect(imageDownload.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await imageDownload.arrayBuffer())).toEqual(png);
    expect((await api<TeamFilesListing>(endpoint("Other team", "Entregas"))).entries).toEqual([]);
    await turn(outsider, [{ tool: "team_files", arguments: { action: "read", section: "Studio", path: "Identidade Visual/Logos/logo.svg" }, expectError: true }]);
    const globalEvidence = await turn(chief, [
      { tool: "team_files", arguments: { action: "read", section: "Studio", path: "Identidade Visual/Logos/logo.svg" } },
      { tool: "team_files", arguments: { action: "list", section: "Private team" }, expectError: true },
    ]);
    await api(`/api/bots/${chief.id}`, "PATCH", { globalChief: false });
    await turn(chief, [{ tool: "team_files", arguments: { action: "list", section: "Studio" }, expectError: true }]);
    const removed = await api<{ entry: { id: string } }>(endpoint("Studio"), "POST", { action: "trash", path: "Identidade Visual" });
    await api(endpoint("Studio", "Identidade Visual"), "GET", undefined, 404);
    await api(endpoint("Studio"), "POST", { action: "restore", id: removed.entry.id });
    await api("/api/sidebar-sections?section=Studio", "PATCH", { name: "Growth" });
    expect((await api<TeamFilesListing>(endpoint("Growth"))).root).toBe(studioRoot);
    expect(await (await fetch(fixture.info.url + endpoint("Growth", "Identidade Visual/Logos/logo.svg", true))).text()).toBe(logo);
    await api("/api/sidebar-sections", "POST", { name: "Studio" });
    expect((await api<TeamFilesListing>(endpoint("Studio"))).root).not.toBe(studioRoot);
    await api(endpoint("Studio", "Identidade Visual"), "GET", undefined, 404);
    expect(existsSync(join(studioRoot, "Identidade Visual", "Logos", "logo.svg"))).toBe(true);
    await api(endpoint("Growth", "../config.json"), "GET", undefined, 400);
    const evidencePath = fixture.info.logPath + ".team-files.json";
    writeFileSync(evidencePath, JSON.stringify({ logPath: fixture.info.logPath, designerEvidence, globalEvidence, output, renamed: "Growth", receipt }, null, 2));
    console.log("Team files evidence:", evidencePath);
  } finally { await fixture.close(); }
}, 120_000);
