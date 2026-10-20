# Search and focused team navigation

Expanded sidebars in Simple and Advanced modes keep a global search field,
Recent / Teams / Bots tabs and an independent Global Chief shortcut visible.
Search combines words across names, teams, roles, descriptions, thread titles
and project names, ignoring case and accents. Conversation-history search is
explicitly opened from the results. Archived bots stay out of the navigation.

Teams open as a focused roster with a back button, favorites, existing team
actions and group conversations. Recent and global bot rows include their
team and role; focused rows show the role. The chat header identifies the
selected bot's team, or its independent Global Chief role. The footer keeps
Today and the other workspace tools in a compact toolbar.

Navigation preferences live in `openmausbot.sidebarNavigation.v1` in local
storage. They contain the current view, focused team, bounded recent bot IDs
and favorite team names. Renaming a team through its menu migrates the focus
and favorites. These preferences do not change membership or memory access.
The collapsed avatar rail, bot context menus and thread controls remain
available. Cmd/Ctrl+K focuses expanded navigation search; the command palette
remains available when the sidebar is collapsed or hidden.

## Isolated verification

```sh
pnpm lint
pnpm typecheck
pnpm i18n:check
pnpm exec vitest run src/components/Sidebar src/components/ChatView.controls.test.ts src/lib/sidebar-navigation.test.ts --maxWorkers=2
OMB_UI_E2E=1 pnpm exec vitest run scripts/testing/sidebar-navigation-ui.e2e.test.ts --maxWorkers=1
OMB_UI_E2E=1 pnpm exec vitest run scripts/testing/portuguese-ui.e2e.test.ts scripts/testing/bot-kit-ui.e2e.test.ts scripts/testing/global-chief-ui.e2e.test.ts scripts/testing/control-omb-ui.e2e.test.ts --maxWorkers=1
pnpm build
pnpm build:server
pnpm build:companion
node scripts/smoke-packaged-server.mjs
```

The navigation fixture owns a `control-omb ui launch` process with a disposable
home and fake engine. It seeds duplicate bot names in different teams, an
independent Global Chief, an archived bot, an empty team, a group conversation
and more than forty bots. It checks accent-insensitive search, Cmd+K, opening
a bot and its breadcrumb, team focus, favorites and reload persistence,
pagination, recent ordering and both interface modes. It measures the search
and scrolling area at 1280×900, 1024×600 and 390×844, and opens the mobile drawer
through its accessible button. Console errors fail the fixture. SIGINT stops
only its owned launcher and children.

## Verified 2026-10-20

Navigation evidence is retained as
`server-1792525049023-19107.log.navigation.json`, `.navigation-1280.png`,
`.navigation-1024.png`, `.navigation-390.png` and `.navigation-simple.png` under
`openmausbot-verification-evidence/` in the OS temporary directory.

Lint, TypeScript and catalog validation passed, including complete Portuguese
coverage. The focused component check passed 35 suites and 485 tests. The
navigation fixture and all six existing profile, character, Global Chief and
chat UI checks passed, including the updated conversation-history search.
The production renderer, server, companion and updater builds passed, as did
all eight packaged-server smoke checks. A local macOS arm64 0.1.120 app and
DMG were generated with the existing native runtime bundles.

The source-size ratchet has pre-existing failures in the merged baseline
`0a698c3b9`. This change reduces Sidebar and ChatView and lowers their limits;
the remaining unrelated limits are not raised. These renderer checks do not
qualify native Windows or Linux packages.
