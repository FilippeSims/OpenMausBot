# Notifica: questions and durable continuation

Configure each bot in **Bot settings → Voice & alerts → Notifica**. In Notifica,
choose **Agentes → Conectar agente**, create that bot's integration, paste its
key, enable the connection and save. The Portuguese interface labels are
**Voz e alertas**, **Chave privada deste bot**, **Ativar Notifica para este bot**
and **Salvar Notifica**. An unsaved bot must be saved first.

`perguntar_usuario` accepts `eventId`, `title`, `message`, optional
`expectsReply` (default true), and up to six `suggestions`. The server derives
`conversationKey` from the authenticated bot and original thread; a model
cannot select another bot's key or another thread. Use `expectsReply: false`
for a notice or final result. An event ID may be retried only with identical
content. A queued tool receipt confirms durable acceptance, not remote delivery.

The connection uses outbound HTTPS to `https://api-notifica.adapton.com.br`:
`POST /agentMessage` sends an immutable persisted payload; `POST /agentReply`
polls the returned conversation and question IDs approximately every 15 seconds.
No model runs for polling, and no webhook or new incoming port is required.
Timeouts preserve the question. HTTP 429 backs off according to `Retry-After`
(seconds or HTTP date), including after restart and manual retry. HTTP 401/403
pauses that credential until the owner reconnects or explicitly retries.

Each question retains its bot, thread, optional room, remote conversation,
message and alert IDs. One question is pending per bot/conversation; subsequent
Notifica messages stay in order. The task appears as waiting for the user but
does not occupy an active provider slot. Other tasks can run. Incoming chat
messages in that conversation wait too; the returned answer has queue priority.

An answer enters the ordinary durable agent queue as **user text**, with a
stable `sendId` derived from bot + remote conversation + `reply.id`. It is not
executed as a shell command. Dispatch uses the original task's normal context,
permissions, model and session cursor. A room answer targets the original bot,
even if the room's default responder is another member. Deleted tasks are never
replaced with another conversation. Normal interrupted-dispatch handling still
requires review if a crash occurred after an agent turn had already started.

Keys and communication state are encrypted in `notifica.json.enc`, sealed by
`notifica-key`; both are owner-readable/writable files in the installation data
directory (0600 on Unix). They are excluded from portable workspace exports and
restores, and keys never enter shared bot profiles, status responses or prompts.
Keep both files together in an installation-level backup. An unreadable state
fails closed instead of overwriting pending questions. Disabling preserves all
pending work. Changing a key affects new messages; the owner can explicitly
apply a replacement key to pending questions **of that same Notifica agent**.

Run the acceptance checks against disposable fixtures only:

```sh
corepack pnpm exec vitest run server/notifica.test.ts server/notifica.e2e.test.ts server/routes/notifica.test.ts src/components/bot-settings/NotificaSettings.test.ts
corepack pnpm exec vitest run scripts/testing/notifica-settings.ui.e2e.test.ts
```

The server acceptance fixture owns a synthetic loopback Notifica API, private
keys, fake model and temporary data directory. It exercises the real injected
tool, a second task and second bot, polls without extra model turns, restarts
during the wait, verifies the original session cursor is resumed, delivers the
reply exactly once, and sends the result through the same conversation key.
Evidence is retained next to its server log as `.notifica.json`. The UI fixture
saves a synthetic key through the real Portuguese settings and retains a
screenshot and `.notifica-settings.json`; it never contacts a real Notifica
account. `FAKE_CLAUDE_NOTIFICA_URL` can only select a loopback stub when the
verification launcher's sealed-path environment is active.

For the final live check, configure a real per-bot key privately in the app,
ask the bot to send a test question, answer it in Notifica, and confirm the
continuation in that bot's original task. Synthetic fixtures do not establish
that a real key or an external account is correctly configured.

## Companies, teams and remote approvals

For the whole workspace, open **Settings → Connections → Notifica · Empresas e
times**. In Notifica, create an OpenMausBot workspace connection, then save its
private key here. Add companies and select the company for each team. Visible
bots are synchronized with their existing team; renaming a team preserves its
remote identifier and company. An unassigned bot appears under **Sem time**.
The catalog allows 30 companies, 100 teams, 200 bots and 240 total records.
A rejected or oversized catalog leaves existing conversation delivery running.

This connection uses outbound requests only. `workspaceSync` sends the catalog
on startup or change. `agentInbox` polls every 15 seconds and keeps the remote
queue until `agentAck`, which follows acceptance into the ordinary durable chat
queue. A new remote conversation creates an independent Ask-mode task for that
exact bot. Its visible replies and progress return through `agentMessage`; messages over 4,000
characters are split into stable, ordered chunks. Restart reuses the saved task,
message IDs and acknowledgments. A failed conversation does not block other
conversations. A deleted task is never silently replaced.

Native tool permissions, peer-contact permissions and outbound-send permissions
are published automatically through `agentApproval`. The decision identifies the
original bot, task, card and request; free chat text never grants permission.
`agentApprovalResolve` reports the outcome only after the native request was
answered. Denied, expired, stopped and already-answered cards cannot grant a new
action. A crash during delivery is reconciled with the exact saved card and does
not execute a new permission request. Structured configuration/skill proposals,
provider questions and approvals whose complete detail exceeds 4,000 characters
remain in the OpenMausBot interface. Oversized approvals send an informational
notice to Notifica directing the owner to the full local review. `perguntar_usuario` supports ordinary
questions over the workspace connection. A task already linked to that workspace
keeps its same remote conversation even when the bot also has an enabled personal
connection. For other tasks, an enabled personal connection keeps precedence.

`notifica-workspace.json.enc` and `notifica-workspace-key` are installation-private
0600 files excluded from portable workspace backups. Changing the connection key
selects a separate credential scope; work under the previous key stays preserved
and resumes when that key is selected again. Disable preserves pending work.
The OpenMausBot server must be running for new messages or decisions to arrive.

Acceptance uses a disposable server, native fake-provider permission prompts,
and a loopback Notifica API. It verifies two companies, two bots, precise Allow
and Deny, returning results, and the same conversation after a restart:

```sh
corepack pnpm exec vitest run server/notifica-workspace.test.ts server/notifica-workspace.e2e.test.ts src/components/NotificaWorkspaceSettings.test.ts
```

The same acceptance can run against the real Notifica backend on Firebase
emulators, with an isolated emulator account and workspace integration:

```sh
OMB_NOTIFICA_ACCEPTANCE_FIXTURE=/absolute/path/to/fixture.json corepack pnpm exec vitest run server/notifica-workspace.e2e.test.ts
```

The private fixture JSON contains `baseUrl` (loopback only), `workspaceKey`,
`integrationId`, `email` and `password`. Auth and Firestore must be the
`demo-notifica` emulators on loopback ports 9099 and 8080. No production Firebase
endpoint is used. Evidence is retained beside the isolated server log as
`.workspace-notifica.json`, without credentials. This verifies both repository
implementations together, not a deployed server or phone notification transport.

Workspace responses also transfer rendered Markdown file/image/video links and
persisted bot attachments. Each file must be authorized by its exact stored
message and the same conversation roots used by the local file viewer; plain
paths in prose and files outside those roots grant no access. Local destinations
are removed from the mirrored text. Successful transfers appear as authenticated
Notifica attachments, and unavailable or oversized files produce a separate
notice while text and other conversations continue.

The bridge permits 50 MiB per file, while the existing local download route keeps
its 25 MiB limit. Immutable encrypted snapshots in `notifica-workspace-files`
preserve upload bytes and IDs across restart or changes to the original file.
The queue is capped at 250 MiB across credentials, excluded from portable
backups, and removed after upload receipts are saved. Disable/key changes retain
pending work. Transient failures retry up to five times with a pending notice;
**Tentar novamente** resumes those transfers without inventing successful links.

Run file acceptance with the same optional emulator fixture described above:

```sh
corepack pnpm exec vitest run server/notifica-workspace-files.test.ts server/notifica-workspace.test.ts server/workspace-backup-policy.test.ts
corepack pnpm exec vitest run server/notifica-workspace-files.e2e.test.ts
```

The isolated fake-engine fixture transfers Markdown, PNG and video bytes, retries
an upload after a lost response, refuses an outside-workspace link and a file
over 50 MiB, and restarts without duplicating attachments. With
`OMB_NOTIFICA_ACCEPTANCE_FIXTURE`, it also downloads every accepted file through
the real backend using the isolated emulator user's session. Evidence is retained
beside the server log as `.workspace-notifica-files.json`.
