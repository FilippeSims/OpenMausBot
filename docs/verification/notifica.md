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
