import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { fixtureApi, mountPreview, parkUntilSignal, type MountedPreview } from "./testing/preview-fixture.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = await launchVerificationServer();
const previews: MountedPreview[] = [];

function samplePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    "", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>", "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [index, label] of [[3, "Release report - page one"], [5, "Review complete - page two"]] as const) {
    const stream = `BT /F1 20 Tf 32 530 Td (${label}) Tj ET\n0.1 0.6 0.7 rg 32 400 356 64 re f\n`;
    objects[index] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`;
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

try {
  const api = fixtureApi(fixture.info.url);
  const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]);
  await control(["new-bot", "--name", "File reviewer"]);
  const { bots } = await api("GET", "/api/bots?messages=0");
  const bot = bots.find((item: { name: string }) => item.name === "File reviewer");
  const workspace = join(fixture.info.dataDir, "sample-project");
  mkdirSync(workspace, { recursive: true });
  await api("PATCH", `/api/bots/${bot.id}`, { cwd: workspace });
  await api("PATCH", "/api/config", { language: "en" });
  const files = {
    "report #1.md": "# Launch review\n\nA **readable report** beside your conversation.\n\n## Next steps\n\n- Review the artwork\n- Approve the release\n\n| Team | Status |\n| --- | --- |\n| Design | Ready |\n| Development | Ready |\n\n```js\nconst ready = true;\n```\n\n<script>window.__previewExecuted = true</script>\n\n![No remote request](https://example.invalid/tracking.png)\n\n[Unshared file](unshared.txt)\n",
    "release.pdf": samplePdf(),
    "metrics.csv": "Project,Changes\nAlpha,12\nBeta,7\n",
    "page.html": "<style>body{font:20px system-ui;padding:24px;background:#eef8fa;color:#164452}</style><h1>Safe page preview</h1><p>Scripts and external requests stay blocked.</p><script>window.parent.__previewExecuted=true</script><img src='https://example.invalid/tracking.png'>",
    "archive.zip": "Unsupported preview fixture",
    "missing.txt": "Removed after the turn.",
    "unshared.txt": "Changed, never shared in a message.",
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(workspace, name), content);
  copyFileSync(join(root, "docs/screenshots/composer-dock-after.mp4"), join(workspace, "demo.mp4"));
  copyFileSync(join(root, "docs/verification/evidence/chat-ui/chat-ui.png"), join(workspace, "artwork.png"));
  const names = [...Object.keys(files).filter(name => name !== "unshared.txt"), "demo.mp4", "artwork.png"];
  const reply = ["Your files are ready for review.", ...names.map(name => `[${name}](${pathToFileURL(join(workspace, name)).href})`)].join("\n\n");
  const wrapper = join(fixture.info.dataDir, "preview-claude.mjs");
  writeFileSync(wrapper, ["#!/usr/bin/env node",
    `process.env.FAKE_CLAUDE_REPLIES = ${JSON.stringify(JSON.stringify([reply]))};`,
    `await import(${JSON.stringify(pathToFileURL(join(root, "server/testing/fake-claude-cli.ts")).href)});`,
  ].join("\n"), { mode: 0o700 });
  await api("PATCH", "/api/instances/claude", { cli: wrapper });
  const sent = await control(["send", "--bot", bot.id, "--text", "Prepare the review files."]);
  const settled = await control(["wait", "--bot", bot.id, "--timeout", "30"]);
  rmSync(join(workspace, "missing.txt"));
  const filesPreview = await mountPreview(fixture, {
    entry: "/scripts/testing/computer-files-preview.tsx", route: "/__file-preview.html", title: "Isolated OMB file previews",
    extraRoutes: [{ path: "/__computer-files-fixture", handler: async (_req, res) => {
      const current = await api("GET", "/api/bots");
      const shown = current.bots.find((item: { id: string }) => item.id === bot.id);
      const digest = { id: "fixture-digest", role: "bot", kind: "digest", at: Date.now(),
        parentId: shown.activeLeafId ?? shown.messages.at(-1)?.id,
        digest: { files: { added: [...names, "unshared.txt"], changed: [], deleted: [] } } };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ...shown, messages: [...shown.messages, digest], activeLeafId: digest.id }));
    } }],
  });
  previews.push(filesPreview);
  const appPreview = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__file-preview-app.html", title: "Isolated OMB file preview app" });
  previews.push(appPreview);
  console.log(JSON.stringify({ ...fixture.info, previewUrl: filesPreview.previewUrl, appUrl: appPreview.previewUrl, botId: bot.id, taskId: sent.taskId, settled }));
  await parkUntilSignal();
} finally { for (const preview of previews) await preview.close(); await fixture.close(); }
