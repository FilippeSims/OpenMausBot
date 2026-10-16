import { spawnSync } from "node:child_process";
import { cp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { x as extract } from "tar";

// pg0's macOS archives have Homebrew paths baked into their Mach-O load
// commands. Relocate them during the build, when Xcode tools are available.
export async function prepareMacPostgres(destination, asset, download) {
  if (process.platform !== "darwin") throw new Error("Build macOS Hindsight on a macOS runner");
  const archive = await download(asset);
  const postgres = path.join(destination, "postgres");
  await extract({ file: archive, cwd: destination, strip: 1 });
  // Archives extract bin/lib/share directly at destination; move only this
  // pinned distribution into its dedicated profile resource.
  const { mkdir, rename } = await import("node:fs/promises");
  await mkdir(postgres);
  for (const name of ["bin", "lib", "share"]) await rename(path.join(destination, name), path.join(postgres, name));
  await rm(path.join(destination, "include"), { recursive: true, force: true });
  for (const name of ["libssl.3.dylib", "libcrypto.3.dylib"])
    await cp(path.join(destination, "site/psycopg2/.dylibs", name), path.join(postgres, "lib", name));
  for (const entry of await readdir(postgres, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const bytes = await readFile(file);
    if (bytes.length < 4 || !["cffaedfe", "cefaedfe", "cafebabe", "bebafeca"].includes(bytes.subarray(0, 4).toString("hex"))) continue;
    const output = spawnSync("otool", ["-L", file], { encoding: "utf8" });
    if (output.status !== 0) throw new Error(`Could not inspect PostgreSQL Mach-O: ${file}`);
    const changes = [];
    for (const line of output.stdout.split("\n").slice(1)) {
      const dependency = line.trim().split(" (compatibility")[0];
      if (!dependency.startsWith("/") || dependency.startsWith("/usr/lib/") || dependency.startsWith("/System/Library/")) continue;
      const library = path.join(postgres, "lib", path.basename(dependency));
      const relative = path.relative(path.dirname(file), library).split(path.sep).join("/");
      changes.push("-change", dependency, `@loader_path/${relative}`);
    }
    if (changes.length) {
      const patched = spawnSync("install_name_tool", [...changes, file], { stdio: "pipe" });
      if (patched.status !== 0) throw new Error(`Could not relocate PostgreSQL Mach-O: ${file}`);
      // Replacing load commands invalidates the archive's ad-hoc signature.
      const signed = spawnSync("codesign", ["--force", "--sign", "-", file], { stdio: "pipe" });
      if (signed.status !== 0) throw new Error(`Could not ad-hoc sign PostgreSQL Mach-O: ${file}`);
    }
  }
}
