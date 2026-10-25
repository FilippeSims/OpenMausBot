# Right-side file previews

```sh
node --experimental-strip-types scripts/verify-file-preview.ts
```

Use the printed `appUrl` for the full application and `previewUrl` for the real
Files pane beside the real Markdown/chip components. Both share one disposable
server, fake Claude turn and synthetic project. The launcher prints its URL,
PID, temporary data directory and retained server log. Ctrl-C closes both
previews and that server and removes only its temporary data.

Clicking a shared filename opens the preview. The neighboring download button
and the preview header's download button explicitly save a copy. Markdown,
PDF, images, video, audio, text, HTML and CSV/TSV have previews. Unknown formats
show an explanation and retain download. Existing message-scoped authorization
and workspace containment apply to every file request; digest rows alone still
offer no read access.

## Checks

1. Click `report #1.md` in the chat, attachment chip and Files pane. Its heading,
   list, table and code render in the right panel, with the conversation visible
   beside it on desktop. Opening the preview does not download. Its embedded
   script is omitted, remote image remains text, and nested local link is inert.
2. Download the report explicitly. Its original name and 372-byte synthetic
   contents survive; the authored URL, including encoded space and `#`, reaches
   the exact stored thread/message endpoint unchanged.
3. Open `release.pdf`: both pages render, Next/Previous changes page, and zoom
   and Fit width work. PDF.js renders canvases and accessible page text; no PDF
   scripts, annotations, forms or embedded actions are mounted. Protected or
   malformed PDFs show an actionable error with download still available.
4. Open `artwork.png`; the image decodes. Open `demo.mp4`; controls appear with
   preload metadata, playback paused, and no autoplay. Close or switch files:
   the old request is aborted and blob URL is released.
5. `metrics.csv` shows Alpha/12 and Beta/7 with the existing table controls.
   `page.html` renders in an empty sandbox and a deny-by-default CSP. Neither
   its script nor external image can run/request. `archive.zip` explains the
   unsupported preview; `missing.txt` shows an error. `unshared.txt` stays
   **Not shared**, without a preview or download action.
6. At 1360×900 and 1280×900, the preview is a right-side sibling, with no page
   overflow. At 390×844 it fills the viewport, marks the background inert,
   traps Tab in its controls and closes with Escape. Focus returns to the
   originating filename. Verify Midnight and Atelier skins. Switching to
   another conversation closes the old preview.

## Regression commands

```sh
pnpm exec vitest run src/components/FilePreviewPanel.test.ts src/lib/file-preview-data.test.ts src/components/AttachmentPreview.test.ts src/components/AttachmentGallery.test.ts src/components/ChatMarkdown.test.ts src/components/ComputerFilesPane.test.ts src/components/HtmlFilePreview.test.ts src/components/RichTable.test.ts src/components/AttachmentGallery.reply-group.test.ts src/components/GroupView.message-actions.test.ts server/message-file.test.ts scripts/testing/verification-docs.test.ts
NODE_OPTIONS=--max-old-space-size=6144 pnpm typecheck
pnpm i18n:check
pnpm exec vite build
```

Text/Markdown/HTML previews cap streamed and declared bytes at 2 MB. Media
keeps the existing 25 MB file endpoint cap; CSV/TSV keeps its existing 10 MB
preview and table limits. Media MIME types are checked. Plain text and
sandboxed HTML accept known text suffixes when the server serves octet-stream.
No new filesystem route or root grant was introduced.

## Evidence — 2026-10-25

BrowserOS Neo drove the real fixture application and Files pane:

- [Markdown beside the conversation](evidence/file-preview/markdown-desktop.jpg)
- [Narrow Atelier preview](evidence/file-preview/markdown-mobile.jpg)
- [PDF page in the app](evidence/file-preview/pdf-desktop.jpg)

The browser confirmed the report's Markdown, no remote image or nested local
link, explicit 372-byte download, both PDF pages, a decoded 1280×577 image and
a paused 14.03-second MP4 with native controls. HTML retained its empty sandbox
and blocked script; CSV showed both rows; missing and unshared files retained
their errors/refusals. Desktop document widths matched 1360 and 1280 pixels;
the mobile document and preview both measured 390×844. Tab cycled between
download and close; Escape restored filename focus and released background
inertness. The fixture log is `server-1792935834144-8153.log` under the temporary
`openmausbot-verification-evidence` directory.

These checks cover browser rendering against the real isolated server. They do
not qualify a packaged Electron app or physical iOS/Android clients. Password
entry for encrypted PDFs and previews of Office archives are outside this UI.
