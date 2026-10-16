import { resolve } from "node:path";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal, type MountedPreview } from "./testing/preview-fixture.ts";

const bundle = resolve(process.argv[2] ?? `dist-native/hindsight/${process.platform}-${process.arch}`);
const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true }, [], undefined, bundle);
let ui: MountedPreview | undefined;
try {
  ui = await mountPreview(fixture, { entry: "/src/testing/hindsight-settings.tsx", route: "/__hindsight-settings.html", title: "Built-in Hindsight — isolated fixture" });
  console.log(JSON.stringify({ ...fixture.info, bundle, previewUrl: ui.previewUrl }));
  await parkUntilSignal();
} finally { await ui?.close(); await fixture.close(); }
