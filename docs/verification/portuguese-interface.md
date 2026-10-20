# Portuguese interface

Portuguese (Brazil) covers every English catalog key, including bot profiles,
permissions, memory, routines, settings, files, approvals, accessibility labels,
avatar shapes and expressions. `generate-locale.mjs --check` requires a complete
`pt-br` pack and validates placeholders and source hashes. Missing Portuguese
entries fail the check instead of silently passing with English fallback.

UI copy embedded in components uses the same catalog. Module-level label
tables expose translated labels when read, so switching languages does not
freeze their initial values. Calendar names and date/time formatters follow
the selected app language. Catalog lookups are applied to application copy;
bot names, models and conversation text are not rewritten.

Shared parsing and log helpers use `shared/ui-copy.ts`: their default server
contract stays English, while the renderer installs its catalog resolver.
The desktop shell reads the same English/Portuguese catalogs, follows language
changes from its main renderer through a bounded IPC handler, and remembers
the choice for the next startup. Native menu/tray commands retain their actions.

Replacement and deletion confirmations display localized words. Their exact
native/API confirmation tokens remain unchanged, and controls stay disabled
until the localized word is entered exactly.

## Isolated verification

```sh
pnpm lint
pnpm typecheck
pnpm i18n:check
pnpm exec vitest run src scripts/generate-locale.test.mjs electron/menu.test.mjs shared/cron-label.test.ts server/composer-attachments.test.ts server/task-timeline.test.ts --maxWorkers=2
OMB_UI_E2E=1 pnpm exec vitest run scripts/testing/portuguese-ui.e2e.test.ts scripts/testing/bot-kit-ui.e2e.test.ts --maxWorkers=1
node --test electron/preload.node-test.mjs electron/company-backup-preload.node-test.mjs electron/cloud-sync-preload.node-test.mjs electron/local-origin.node-test.mjs electron/capabilities.node-test.mjs electron/startup-tray.node-test.mjs
OMB_VERIFY_LOCALE=pt-br node scripts/verify-startup-tray.mjs
pnpm build
pnpm build:server
pnpm build:companion
node scripts/smoke-packaged-server.mjs
```

The renderer fixture starts `control-omb ui launch` with a disposable home and
fake engine. It checks translated settings and avatar choices, grants and
revokes the Global Chief role, switches Portuguese → English → Portuguese,
reloads and checks persistence. Synthetic English profile content remains exact.
It also opens the real app settings through the profile menu. The existing
character-kit fixture exercises appearance persistence using English, proving
that the original language still works.

Both fixtures stop their own launcher with SIGINT. Their screenshots and JSON
remain beside the temporary server log. The real-Electron startup fixture uses
its own user-data directory and rejects external network requests. Do not run
verification mutations against a live user installation.

## Verified 2026-10-20

All 6,456 source keys have Portuguese translations. The broad renderer and
shared-helper check passed 508 suites and 5,464 tests; focused appearance and
activity checks also passed after the final label review. Both renderer
fixtures passed. The native preload/origin/capability/startup checks passed
36 tests. Portuguese native menus, startup markup and tray behavior passed
in unit checks and the real-Electron startup fixture.

Renderer evidence is retained as
`server-1792505659735-17141.log.portuguese.json`, `.portuguese.png` and
`.portuguese-settings.png` under `openmausbot-verification-evidence/` in the OS
temporary directory. Portuguese native startup evidence is in
`openmausbot-startup-evidence-uZuEtY/`.

The local macOS arm64 release is 0.1.115. These checks do not qualify native
Windows or Linux installers, nor translate arbitrary provider responses or
previously written conversation content.
