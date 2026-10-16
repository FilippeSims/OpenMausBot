# Hindsight settings

Start the real Settings modal and server in a disposable workspace:

```sh
node --experimental-strip-types scripts/verify-hindsight-settings.ts
```

Open the printed `previewUrl`, then **Memória** in Settings (or **AI → Memória**
in Simple mode). The launcher isolates both the home and the data directory,
uses the fake engine, and owns a synthetic Hindsight service at `serviceUrl`.
Do not use the installed app or its data for these checks.

1. Test the initial address while disabled. The UI should report a verified
   connection without enabling the integration or saving any settings.
2. Enable Hindsight, expand **Limites avançados**, set the token limit to 512,
   and save. The UI should show enabled and confirm that no restart is needed.
3. Reload the page and reopen Memory. The switch, address and token limit must
   retain their saved values. Inspect only the printed fixture's `config.json`:
   `memory.captureQuietMs` must remain 12345 and `memory.tidyHour` must remain 4.
4. Append `/bad` to the synthetic service URL and test it. The UI should show
   HTTP 401 without displaying `DO_NOT_ECHO_TEST_SECRET`. Testing must not change
   the saved address. The fixture's `/__fixture/requests` should list only GET
   health checks: no memory text or banks are submitted by connection tests.
5. Try saving `http://remote.example`. The UI must reject HTTP outside loopback
   and preserve the saved config. Remote HTTPS also requires the server-side key.
6. Restore the service URL, disable Hindsight and save. The saved state should
   be disabled, with the same address and limits. Refresh status to read back
   the index count and pending/error state.
7. Check Simple mode navigation and a narrow window: the card's form and actions
   should remain within the viewport. Disabled/unavailable Cloud-home and older
   server behavior is covered by the component tests.

Focused checks:

```sh
pnpm exec vitest run src/components/HindsightSettings.test.ts server/hindsight-memory.test.ts server/hindsight-memory.e2e.test.ts server/request-auth.test.ts src/state/store.test.ts src/components/SettingsModal.groups.test.ts src/components/SettingsModal.simple.test.ts src/components/SettingsModal.i18n.test.ts
pnpm typecheck
pnpm i18n:check
pnpm build
```

Stop the foreground fixture with Ctrl-C; it stops only its owned server and
removes its disposable home. The server log remains at the printed path.

## Verified 2026-10-09

The real settings UI was exercised through BrowserOS neo against the shared
isolated fixture. Connection check, activation, token limit, reload persistence,
HTTP error redaction, invalid URL refusal and deactivation passed. The fixture's
on-disk configuration retained `captureQuietMs: 12345` and `tidyHour: 4` after
saving. The synthetic service saw only `GET /health` and `GET /bad/health`
during connection tests; no notes were sent. Simple mode and narrow layout were
also inspected. The retained server log is:

`/var/folders/wm/_vf8496d22x63qthwrfbf7x40000gn/T/openmausbot-verification-evidence/server-1791577010956-56388.log`

This verifies the settings flow with a synthetic service, not remote provider
availability or semantic retrieval quality. The separate local Hindsight recipe
in `../hindsight-memory.md` covers indexing and retrieval against the real model.
