// Disposable parent used to prove cleanup after an unexpected parent exit.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HindsightRuntime } from "../hindsight-runtime.ts";
const [bundle, dataDir] = process.argv.slice(2);
if (!bundle || !dataDir) throw new Error("Explicit fixture bundle and home required");
const runtime = new HindsightRuntime({ bundle, dataDir, config: () => undefined });
await runtime.reconcile();
if (runtime.status().runtimeState !== "ready") throw new Error("Fixture memory did not start");
const postgres = Number(readFileSync(join(dataDir, "hindsight-runtime/.pg0/instances/mausbot/data/postmaster.pid"), "utf8").split("\n")[0]);
console.log(JSON.stringify({ python: runtime.processId(), postgres }));
setInterval(() => {}, 60_000);
