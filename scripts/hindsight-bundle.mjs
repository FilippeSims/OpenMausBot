import { createHash } from "node:crypto";
import { readFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";

export async function verifyHindsightBundle(directory, target) {
  const manifest = JSON.parse(await readFile(path.join(directory, "runtime.json"), "utf8"));
  if (manifest.version !== 1 || manifest.target !== target || manifest.engine !== "0.10.3" || manifest.python !== "3.11.14") throw new Error("Wrong Hindsight bundle target/version");
  const root = await realpath(directory);
  const expectedPython = target.startsWith("win32") ? "python/python.exe" : "python/bin/python3.11";
  if (manifest.interpreter !== expectedPython) throw new Error("Wrong bundled Hindsight interpreter");
  const required = [expectedPython, "launcher.py", "mausbot_profile.py", "LICENSE", "model-LICENSE.txt", "OpenSSL-LICENSE.txt", "PostgreSQL-COPYRIGHT.txt", "pgvector-LICENSE.txt", "README.md", "model.json",
    "site/hindsight_api/engine/memory_engine.py", "site/hindsight_api/engine/embeddings.py",
    target.startsWith("win32") ? "site/pg0/bin/pg0.exe" : "site/pg0/bin/pg0"];
  if (target.startsWith("darwin")) required.push("postgres/bin/postgres", "postgres/lib/libssl.3.dylib", "postgres/lib/libcrypto.3.dylib");
  for (const file of required) {
    const actual = await realpath(path.join(root, file));
    if (!actual.startsWith(root + path.sep) || !(await lstat(actual)).isFile()) throw new Error(`Missing/conflicting Hindsight resource: ${file}`);
  }
  const model = JSON.parse(await readFile(path.join(directory, "model.json"), "utf8"));
  for (const [file, digest] of Object.entries(model.files)) {
    const bytes = await readFile(path.join(root, "model", path.basename(file)));
    if (createHash("sha256").update(bytes).digest("hex") !== digest) throw new Error(`Corrupted Hindsight model: ${file}`);
  }
  return manifest;
}
