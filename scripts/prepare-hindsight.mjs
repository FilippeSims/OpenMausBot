import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { x as extract } from "tar";
import { prepareMacPostgres } from "./hindsight-postgres.mjs";
import { verifyHindsightBundle } from "./hindsight-bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "third_party/hindsight");
const uv = process.env.OMB_BUILD_UV ?? "uv";
const targets = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
  "linux-x64": "x86_64-unknown-linux-gnu",
};
const selected = process.argv.slice(2);
if (!selected.length) selected.push(...(process.platform === "darwin" ? ["darwin-arm64", "darwin-x64"] : [`${process.platform}-${process.arch}`]));
function run(args) {
  const result = spawnSync(uv, args, { cwd: root, stdio: "inherit", windowsHide: true,
    env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: "15.0" } });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`uv failed (${result.status})`);
}
const model = JSON.parse(await readFile(path.join(source, "model.json"), "utf8"));
const cache = path.join(root, "dist-native/hindsight-cache");
await mkdir(cache, { recursive: true });
async function download(asset) {
  const destination = path.join(cache, path.basename(new URL(asset.url).pathname));
  const valid = async () => createHash("sha256").update(await readFile(destination)).digest("hex") === asset.sha256;
  if (!await valid().catch(() => false)) {
    console.log(`Downloading pinned runtime: ${path.basename(destination)}`);
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`Runtime download HTTP ${response.status}`);
    await writeFile(destination, Buffer.from(await response.arrayBuffer()));
    if (!await valid()) throw new Error(`Runtime checksum mismatch: ${destination}`);
  }
  return destination;
}
const pythons = JSON.parse(await readFile(path.join(source, "python.json"), "utf8"));
const postgresql = JSON.parse(await readFile(path.join(source, "postgres.json"), "utf8"));
for (const [file, digest] of Object.entries(model.files)) {
  const destination = path.join(cache, path.basename(file));
  const valid = async () => createHash("sha256").update(await readFile(destination)).digest("hex") === digest;
  if (!await valid().catch(() => false)) {
    console.log(`Downloading pinned Hindsight model: ${file}`);
    const response = await fetch(`https://huggingface.co/${model.repository}/resolve/${model.revision}/${file}`);
    if (!response.ok) throw new Error(`Model download HTTP ${response.status}`);
    await writeFile(destination, Buffer.from(await response.arrayBuffer()));
    if (!await valid()) throw new Error(`Model checksum mismatch: ${file}`);
  }
}
for (const target of selected) {
  const triple = targets[target];
  if (!triple) throw new Error(`Unsupported Hindsight target: ${target}`);
  const destination = path.join(root, "dist-native/hindsight", target);
  // Fixed, task-owned output only. A failed preparation leaves no ready manifest.
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const osName = target.startsWith("win32") ? "windows" : target.startsWith("darwin") ? "darwin" : "linux";
  const cpu = target.endsWith("arm64") ? "aarch64" : "x86_64";
  const pythonAsset = pythons[`cpython-3.11.14-${osName}-${cpu}-${osName === "linux" ? "gnu" : "none"}`];
  if (!pythonAsset) throw new Error(`No hash-locked Python for ${target}`);
  await extract({ file: await download(pythonAsset), cwd: destination });
  // These terminal aliases collide on case-insensitive macOS build volumes.
  // The embedded service has no terminal UI and never uses terminfo.
  await rm(path.join(destination, "python/share/terminfo"), { recursive: true, force: true });
  const install = ["pip", "install", "--target", path.join(destination, "site"), "--python-version", "3.11", "--python-platform", target === "linux-x64" ? "x86_64-manylinux_2_35" : triple,
    "--require-hashes", "--only-binary", ":all:"];
  if (target === `${process.platform}-${process.arch}`) {
    install.splice(install.indexOf("--python-platform"), 2);
    install.push("--python", path.join(destination, "python", target.startsWith("win32") ? "python.exe" : "bin/python3.11"));
  }
  run([...install, "-r", path.join(source, "requirements.lock")]);
  run([...install, "--no-deps", "-r", path.join(source, "engine.lock")]);
  if (target.startsWith("darwin")) await prepareMacPostgres(destination, postgresql[`postgresql-18.1.0-${triple}.tar.gz`], download);
  const embeddings = path.join(destination, "site/hindsight_api/engine/embeddings.py");
  let text = await readFile(embeddings, "utf8");
  for (const [before, after] of [
    ["from transformers import AutoTokenizer", "from mausbot_profile import LocalAutoTokenizer as AutoTokenizer"],
    ["session_options = None\n        if not self.cpu_mem_arena:\n            session_options = ort.SessionOptions()\n            session_options.enable_cpu_mem_arena = False",
     "session_options = ort.SessionOptions()\n        session_options.intra_op_num_threads = 2\n        session_options.inter_op_num_threads = 1\n        session_options.enable_cpu_mem_arena = False"],
  ]) {
    if (text.split(before).length !== 2) throw new Error("Hindsight patch drift; review the new upstream source before packaging");
    text = text.replace(before, after);
  }
  await writeFile(embeddings, text);
  const patchFile = async (file, before, after) => {
    const destinationFile = path.join(destination, "site/hindsight_api", file);
    const original = await readFile(destinationFile, "utf8");
    if (original.split(before).length !== 2) throw new Error(`Hindsight patch drift: ${file}`);
    await writeFile(destinationFile, original.replace(before, after));
  };
  // FastMCP is only a type annotation in this interface. The profile exposes
  // Mausbot's scoped tools instead of a second unrestricted MCP service.
  await patchFile("extensions/mcp.py", "from fastmcp import FastMCP", "from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    from fastmcp import FastMCP");
  const mcp = path.join(destination, "site/hindsight_api/extensions/mcp.py");
  await writeFile(mcp, "from __future__ import annotations\n" + await readFile(mcp, "utf8"));
  await patchFile("config.py", 'importlib.import_module("transformers")', 'importlib.import_module("mausbot_profile")');
  const providerInit = path.join(destination, "site/hindsight_api/engine/providers/__init__.py");
  const providerText = await readFile(providerInit, "utf8");
  if (!providerText.includes("from .none_llm import NoneLLM")) throw new Error("Hindsight provider patch drift");
  await writeFile(providerInit, '# Mausbot local profile: cloud SDKs are excluded.\nfrom .none_llm import NoneLLM\n__all__ = ["NoneLLM"]\n');
  await patchFile("engine/llm_wrapper.py", "    ollama_num_ctx = _validate_ollama_num_ctx(ollama_num_ctx)",
    '    # Mausbot indexes reviewed notes; generative providers are not bundled.\n' +
    '    if provider.lower() != "none":\n        raise ValueError("Mausbot Hindsight supports only the none LLM provider")\n' +
    '    from .providers.none_llm import NoneLLM\n' +
    '    return NoneLLM(provider=provider, api_key=api_key, base_url=base_url, model=model, reasoning_effort=reasoning_effort)\n');
  for (const [module, provider] of [["openai_compatible_llm", "OpenAICompatibleLLM"], ["gemini_llm", "GeminiLLM"]]) {
    await patchFile("engine/llm_wrapper.py",
      `        from .providers.${module} import ${provider}\n\n        if isinstance(self._provider_impl, ${provider}):\n            return self._provider_impl._client\n        return None`,
      "        return None  # Mausbot uses only NoneLLM; no cloud SDK client.");
  }
  await mkdir(path.join(destination, "model"));
  for (const file of Object.keys(model.files)) await cp(path.join(cache, path.basename(file)), path.join(destination, "model", path.basename(file)));
  for (const file of ["launcher.py", "mausbot_profile.py", "LICENSE", "model-LICENSE.txt", "OpenSSL-LICENSE.txt", "PostgreSQL-COPYRIGHT.txt", "pgvector-LICENSE.txt", "model.json", "README.md"])
    await cp(path.join(source, file), path.join(destination, file));
  const interpreter = target.startsWith("win32") ? "python/python.exe" : "python/bin/python3.11";
  await writeFile(path.join(destination, "runtime.json"), JSON.stringify({ version: 1, engine: "0.10.3", python: "3.11.14", target, interpreter, model: model.revision }, null, 2) + "\n");
  await verifyHindsightBundle(destination, target);
  console.log(`Prepared Hindsight ${target}: ${destination}`);
}
