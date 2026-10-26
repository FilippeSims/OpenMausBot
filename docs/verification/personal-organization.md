# Personal organization and the Notifica conversation

The canonical fixture lives beside the Notifica API in
`../notifica/scripts/organization-fixture.mjs`. It imports
`launchRestartableServer` and `runControlOmb`, starts only the fake engine, uses a
temporary home/data directory, and points the connector at an emulator-backed
loopback API. Never substitute the running personal app URL.

From the Notifica checkout (Node 24, Java 21, dependencies installed in both repos):

```sh
npm --prefix functions run build
npx firebase emulators:exec --project demo-notifica --only auth,firestore "node --experimental-strip-types scripts/organization-fixture.mjs --omb ../OpenMausBot --hold"
```

The fixture asserts a real `organizacao_pessoal` tool call creates a task; a
Notifica move is read through the OpenMausBot owner route with the same version
and unchanged deadline; restart preserves it; an explicitly requested reminder
creates a durable delivery; authenticated completion is visible through both
adapters. A remote human message and reply share one local topic; continuing
locally mirrors the human line and assistant reply without re-enqueuing or
duplicating the remote request after restart.

It prints a persistent log and JSON evidence path under
`openmausbot-verification-evidence`. `--hold` retains the fixture for browser QA.
In another terminal, from Notifica:

```sh
npm --prefix web run dev -- --config vite.organization-fixture.config.ts --mode emulator
```

Open `/organization-fixture.html?source=notifica` and `?source=maus` at the
printed web URL. Both mount the shared real Organizer component against the two
real API adapters. Test create/edit, menus and native HTML drag/drop, deadlines,
week/day/month, keyboard forms and 390 px layout. This fixture does not prove the
navigation inside a packaged desktop build or physical-device push delivery.

Ctrl-C the launcher to stop only its child and remove its temporary home. Logs
remain. Stop the separate Vite process by its own terminal.

Relevant regression checks:

```sh
pnpm exec vitest run server/notifica-workspace.test.ts server/notifica-workspace-files.test.ts server/notifica.test.ts src/components/NotificaWorkspaceSettings.test.ts server/drivers/agents-catalog-wire.test.ts server/drivers/agents-call.test.ts
NODE_OPTIONS=--max-old-space-size=6144 pnpm build
```

`../notifica/docs/organizacao.md` documents contracts, versioning, permissions,
schema 1, bounded capacity, reminders, full backup/restore and deployment order.
Use `node ../notifica/scripts/sync-organizer.mjs . --check` to detect drift of the
shared panel/model. Keep the workspace key server-side and grant each bot access
through the owner's Organization preferences. New chat text mirrors only linked
topics; the header exposes the current link and other linked topics.
