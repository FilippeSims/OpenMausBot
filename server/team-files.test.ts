import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, linkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TeamFiles, teamFileBytes, teamFilePath } from "./team-files.ts";
import { teamFileTeams } from "./team-files-host.ts";

let scratch: string;
let files: TeamFiles;
beforeEach(() => { scratch = mkdtempSync(join(tmpdir(), "omb-team-files-")); files = new TeamFiles(join(scratch, "files"), section => section); });
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("team file storage", () => {
  it("keeps binary logos and nested folders with portable names", async () => {
    files.mkdir("Marketing", "Identidade Visual/Logos");
    const logo = Buffer.from([137, 80, 78, 71, 0, 255, 128]);
    const saved = await files.write("Marketing", "Identidade Visual/Logos/logo.png", teamFileBytes(logo));
    expect((await files.read("Marketing", saved.path)).data).toEqual(logo);
    expect(files.list("Marketing", "Identidade Visual").entries).toMatchObject([{ name: "Logos", kind: "directory" }]);
    expect(files.list("Marketing", "Identidade Visual/Logos", "LOGO").entries).toHaveLength(1);
    expect(files.list("Sales").entries.map(item => item.name).sort()).toEqual(["Entregas", "Referências"]);
  });

  it("refuses stale overwrites and keeps same-name uploads as independent versions", async () => {
    const first = await files.write("Marketing", "logo.svg", teamFileBytes(Buffer.from("first")));
    await expect(files.write("Marketing", "logo.svg", teamFileBytes(Buffer.from("other")))).rejects.toMatchObject({ status: 409 });
    const same = await files.write("Marketing", "logo.svg", teamFileBytes(Buffer.from("first")), { unique: true });
    expect(same.path).toBe("logo.svg");
    const second = await files.write("Marketing", "logo.svg", teamFileBytes(Buffer.from("second")), { unique: true });
    expect(second.path).toBe("logo (2).svg");
    await files.write("Marketing", "logo.svg", teamFileBytes(Buffer.from("updated")), { expectedSha256: first.sha256 });
    await expect(files.write("Marketing", "logo.svg", teamFileBytes(Buffer.from("stale")), { expectedSha256: first.sha256 })).rejects.toMatchObject({ status: 409 });
    expect((await files.read("Marketing", second.path)).data.toString()).toBe("second");
  });

  it("serializes writes so two editors cannot both replace one revision", async () => {
    const initial = await files.write("A", "guide.md", teamFileBytes(Buffer.from("one")));
    const results = await Promise.allSettled(["two", "three"].map(text => files.write("A", "guide.md", teamFileBytes(Buffer.from(text)), { expectedSha256: initial.sha256 })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  });

  it("finishes an upload before moving its parent folder to trash", async () => {
    files.mkdir("A", "Design");
    let start!: () => void, finish!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    const continued = new Promise<void>(resolve => { finish = resolve; });
    async function* upload() { yield Buffer.from("logo"); start(); await continued; yield Buffer.from(" complete"); }
    const saving = files.write("A", "Design/logo.svg", upload());
    await started;
    const removing = files.trash("A", "Design");
    finish(); await saving;
    const removed = await removing;
    await files.restore("A", removed.id);
    expect((await files.read("A", "Design/logo.svg")).data.toString()).toBe("logo complete");
  });

  it("rejects oversized streams without leaving a partial file", async () => {
    async function* oversized() { for (let n = 0; n < 26; n++) yield Buffer.alloc(1024 * 1024); }
    await expect(files.write("A", "huge.bin", oversized())).rejects.toMatchObject({ status: 413 });
    expect(files.list("A").entries.map(entry => entry.name)).toEqual(["Entregas", "Referências"]);
  });

  it("retains files across a team rename, without giving them to a new team reusing its name", async () => {
    const identities = new Map([["Original", "team-one"]]);
    files = new TeamFiles(join(scratch, "stable"), name => identities.get(name)!);
    await files.write("Original", "reference.txt", teamFileBytes(Buffer.from("original")));
    identities.set("Renamed", identities.get("Original")!); identities.set("Original", "team-two");
    expect((await files.read("Renamed", "reference.txt")).data.toString()).toBe("original");
    await expect(files.read("Original", "reference.txt")).rejects.toMatchObject({ status: 404 });
  });

  it("renames folders, restores trash and refuses restoring over newer files", async () => {
    files.mkdir("A", "Design/Logos");
    await files.write("A", "Design/Logos/logo.svg", teamFileBytes(Buffer.from("logo")));
    expect(await files.rename("A", "Design", "Identidade Visual")).toBe("Identidade Visual");
    const removed = await files.trash("A", "Identidade Visual");
    expect(files.trashEntries("A")).toMatchObject([{ id: removed.id, path: "Identidade Visual" }]);
    expect(() => files.list("A", "Identidade Visual")).toThrow();
    await files.restore("A", removed.id);
    expect((await files.read("A", "Identidade Visual/Logos/logo.svg")).data.toString()).toBe("logo");
    const removedFile = await files.trash("A", "Identidade Visual/Logos/logo.svg");
    await files.write("A", "Identidade Visual/Logos/logo.svg", teamFileBytes(Buffer.from("newer")));
    await expect(files.restore("A", removedFile.id)).rejects.toThrow(/already exists/);
    expect((await files.read("A", "Identidade Visual/Logos/logo.svg")).data.toString()).toBe("newer");
  });

  it.each(["../private", "/Users/private", "ok/../../private", "a\\b", "C:/file", "a/./b", "a//b", ".maus/state", "a/NUL.txt", "CON", "bad.", "bad ", "bad\0file", "a:b", "a?b"])("rejects invalid portable path %j", path => {
    expect(() => teamFilePath(path)).toThrow();
  });

  it.skipIf(process.platform === "win32")("rejects symlinks in every path component and linked files", async () => {
    const outside = join(scratch, "outside"); mkdirSync(outside); writeFileSync(join(outside, "secret"), "outside");
    const root = files.root("A");
    symlinkSync(outside, join(root, "linked"));
    await expect(files.read("A", "linked/secret")).rejects.toMatchObject({ status: 403 });
    await expect(files.write("A", "linked/secret", teamFileBytes(Buffer.from("changed")))).rejects.toMatchObject({ status: 403 });
    linkSync(join(outside, "secret"), join(root, "hardlink"));
    await expect(files.read("A", "hardlink")).rejects.toMatchObject({ status: 403 });
    expect(readFileSync(join(outside, "secret"), "utf8")).toBe("outside");
    expect(files.list("A").entries.map(entry => entry.name)).not.toContain("linked");
  });

  it("cleans interrupted uploads and validates authorization before committing", async () => {
    async function* failed() { yield Buffer.from("partial"); throw new Error("interrupted"); }
    await expect(files.write("A", "bad.txt", failed())).rejects.toThrow("interrupted");
    expect(files.list("A").entries.map(entry => entry.name)).not.toContain("bad.txt");
    await expect(files.write("A", "revoked.txt", teamFileBytes(Buffer.from("new")), { valid: () => { throw new Error("revoked"); } })).rejects.toThrow("revoked");
    expect(files.list("A").entries.map(entry => entry.name)).not.toContain("revoked.txt");
  });
});

it("limits team-file access to home teams and authorized Chief teams, respecting audiences and peers", () => {
  const author = { id: "author", name: "Author", section: "Marketing" };
  const sales = { id: "sales", name: "Sales", section: "Sales" };
  const privateBot = { id: "restricted", name: "Private", section: "Private", visibility: "admins" };
  const bots = [author, sales, privateBot];
  expect(teamFileTeams(author, bots, ["Marketing", "Sales", "Private"])).toEqual(["Marketing"]);
  expect(teamFileTeams({ ...author, chiefOfStaff: true, managedSections: ["Sales"] }, bots, ["Marketing", "Sales", "Private"])).toEqual(["Marketing", "Sales"]);
  const global = { id: "global", name: "Global", globalChief: true, chiefOfStaff: true };
  expect(teamFileTeams(global, bots, ["Marketing", "Sales", "Private"])).toEqual(["", "Marketing", "Sales"]);
  expect(teamFileTeams({ ...global, peers: ["author"] }, bots, ["Marketing", "Sales", "Private"])).toEqual(["", "Marketing"]);
});
