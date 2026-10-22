import { extname } from "node:path";
import { TextDecoder } from "node:util";
import { z } from "zod";
import { TEAM_FILE_MAX_BYTES } from "../../shared/team-files.ts";
import { TeamFilesHost } from "../team-files-host.ts";
import { teamFileBytes, teamFileError } from "../team-files.ts";
import type { RosterMember } from "../peer-roster.ts";
import { mimeFor } from "../message-file.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createTeamFilesRoutes(host: TeamFilesHost): RouteHandler {
  return async ({ req, res, url, path, method, json, readBody }) => {
    if (!path.startsWith("/api/team-files")) return PASS;
    try {
      if (!url.searchParams.has("section")) throw teamFileError(400, "section is required.");
      const section = url.searchParams.get("section")!;
      if (!host.exists(section)) throw teamFileError(404, "No such team.");
      const relative = url.searchParams.get("path") ?? "";
      if (path === "/api/team-files" && method === "GET") {
        const offset = Math.max(0, Math.min(10_000, Number(url.searchParams.get("offset")) || 0));
        return json(res, 200, { section, path: relative, ...host.files.list(section, relative, (url.searchParams.get("query") ?? "").slice(0, 200), offset),
          maxFileBytes: TEAM_FILE_MAX_BYTES, ...host.status(section) });
      }
      if (path === "/api/team-files/trash" && method === "GET") return json(res, 200, { entries: host.files.trashEntries(section) });
      if (path === "/api/team-files/content" && method === "GET") {
        const file = await host.files.read(section, relative);
        const mime = mimeFor(file.name);
        const inline = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime);
        res.writeHead(200, { "content-type": inline ? mime : "application/octet-stream", "content-length": file.bytes,
          "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" });
        res.end(file.data); return;
      }
      if (path === "/api/team-files/content" && method === "PUT") {
        if (Number(req.headers["content-length"]) > TEAM_FILE_MAX_BYTES) { req.resume(); throw teamFileError(413, "The file is too large."); }
        const root = host.files.root(section);
        return json(res, 201, await host.files.write(section, relative, req, { unique: url.searchParams.get("unique") === "1",
          ...(typeof req.headers["if-match"] === "string" ? { expectedSha256: req.headers["if-match"] } : {}), valid: () => {
            if (!host.exists(section) || host.files.root(section) !== root) throw teamFileError(409, "The team changed while this file was uploading.");
          } }));
      }
      if (path === "/api/team-files" && method === "POST") {
        const body = z.object({ action: z.enum(["mkdir", "rename", "trash", "restore"]), path: z.string().max(1_024).optional(), name: z.string().max(240).optional(), id: z.string().uuid().optional() }).strict().parse(await readBody(req, 8_192));
        if (body.action === "restore") return json(res, 200, { path: await host.files.restore(section, body.id ?? "") });
        if (body.action === "mkdir") { host.files.mkdir(section, body.path ?? ""); return json(res, 201, { ok: true }); }
        if (body.action === "rename") return json(res, 200, { path: await host.files.rename(section, body.path ?? "", body.name ?? "") });
        return json(res, 200, { entry: await host.files.trash(section, body.path ?? "") });
      }
      return json(res, 405, { error: "Unsupported team file operation." });
    } catch (error) {
      const status = error instanceof z.ZodError ? 400 : (error as { status?: number }).status ?? 500;
      if (!req.readableEnded && method === "PUT") req.resume();
      return json(res, status, { error: error instanceof Error ? error.message : "Team files are unavailable.", code: `team_files_${status}` });
    }
  };
}

const operation = z.object({ action: z.enum(["list", "read", "mkdir", "write"]), section: z.string().max(60).optional(),
  path: z.string().max(1_024).optional(), text: z.string().max(200_000).optional(), expected_sha256: z.string().regex(/^[0-9a-f]{64}$/).optional() }).strict();

export async function runTeamFileTool(host: TeamFilesHost, sender: RosterMember, input: unknown, active: () => void) {
  const args = operation.parse(input);
  const section = args.section ?? sender.section?.trim() ?? "";
  const writing = args.action === "mkdir" || args.action === "write";
  host.authorize(sender, section, writing); active();
  const path = args.path ?? "";
  if (args.action === "list") return { ...host.files.list(section, path), section, availableTeams: host.sections(sender), ...host.status(section) };
  if (args.action === "mkdir") { host.files.mkdir(section, path); return { ok: true, section, path }; }
  if (args.action === "write") {
    if (args.text === undefined) throw teamFileError(400, "text is required when writing a team file.");
    return host.files.write(section, path, teamFileBytes(Buffer.from(args.text)), { expectedSha256: args.expected_sha256,
      valid: () => { active(); host.authorize(sender, section, true); } });
  }
  const file = await host.files.read(section, path, 10 * 1024 * 1024);
  active(); host.authorize(sender, section);
  const mime = mimeFor(file.name);
  const metadata = { section, path, bytes: file.bytes, sha256: file.sha256, absolutePath: `${host.files.root(section)}/${path}`, mime };
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extname(file.name).toLowerCase())) {
    return { content: [{ type: "text", text: JSON.stringify(metadata) }, { type: "image", mimeType: mime, data: file.data.toString("base64") }] };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(file.data);
    if (text.includes("\0")) throw new Error("binary");
    return { ...metadata, text: text.slice(0, 100_000), truncated: text.length > 100_000 };
  } catch { return { ...metadata, message: "Binary reference file. Use its absolutePath with your file tools on this computer; do not recreate or guess its contents." }; }
}
