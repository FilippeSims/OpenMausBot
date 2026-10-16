# Global Chief

Create a bot, then open **Profile → Permissions → Global Chief** (Portuguese:
**Chefe Geral**). An owner or admin grants the role explicitly. The bot leaves
its home team, appears above the teams in the sidebar and in a separate map
node, and coordinates current and future teams without individual team grants.
There is one Global Chief per workspace; transferring the role demotes the old
holder without replacing General's team Chief. Remove group membership and stop
the selected bot before promotion. The global role cannot be replayed through
creation defaults, imported personas or an agent's team-setup proposal.

The Global Chief's instructions prefer delegating to each team's Chief, who
can delegate to specialists. Results resume the requesting Chief automatically.
Normal approvals, peer restrictions, hidden bots, runtime depth and execution
limits remain in effect. Incidents from team Chiefs can escalate to the Global
Chief; a specialist's own team Chief remains the first recipient.

`memory_search` searches active notes of authorized bots and accepted team
memory through Hindsight, with local fallback and provenance. Disabled memories
are excluded. `session_search` and `session_read` also search/read authorized
bot conversations and rooms, naming the source bot/team. Recall does not change
other bots' memories. General's standing team instructions are not inherited by
the independent Chief.

Global authority does **not** bypass audience visibility. A public Chief cannot
recall restricted bots, and a restricted Chief cannot pass their context to a
public teammate. Sources and recipients must have matching audiences and fit
the Chief's peer allow-list. Whole-team recall also requires all members to fit
that scope. Align visibility explicitly when the desired teams have different
audiences. Cloud homes retain their existing local recall restrictions.

Read grants are checked for every call and after asynchronous semantic recall.
Demotion revokes future cross-team reads and delivery of pending child results.
Previously received messages and notes are preserved. An unpaired loopback
caller cannot grant global authority while bots are working, even with a forged
Origin header. The packaged desktop or a paired admin session can grant it.

Run against disposable fixtures only:

```sh
corepack pnpm exec vitest run server/global-chief-access.test.ts server/store.test.ts server/team-setup-requests.test.ts src/state/store.test.ts src/lib/sidebar-layout.test.ts src/lib/team-map.test.ts --maxWorkers=2
corepack pnpm exec vitest run server/global-chief.e2e.test.ts --maxWorkers=1
OMB_UI_E2E=1 corepack pnpm exec vitest run scripts/testing/global-chief-ui.e2e.test.ts scripts/testing/team-access-ui.e2e.test.ts --maxWorkers=1
OMB_HINDSIGHT_VERIFY_BUNDLE="$PWD/dist-native/hindsight/darwin-arm64" corepack pnpm exec vitest run server/hindsight-memory.local.e2e.test.ts --maxWorkers=1
```

The server recipe creates both teams **after** the global grant, seeds notes,
accepted team facts and historical messages, and drives real MCP tools through
the fake engine. It proves both nested delegation branches and consolidated
completion, restricted/disabled memory exclusion, historical message reads,
blocked group/team membership, refused loopback elevation during work, and
withholding a child result when the global role is revoked mid-task. The JSON
with tool responses, assignments and final state is retained beside the server
log as `.global-chief.json`.

The real UI recipe grants/removes the role, checks the independent sidebar
placement and preservation of General's Chief, and retains `.global-chief.png`
and `.global-chief-ui.json`. The native Hindsight recipe additionally proves
cross-team semantic recall and revocation against an actual bundled engine in
an isolated home. Fake-engine coordination proves routing and lifecycle, not
live model judgment.

Verified on macOS arm64, 2026-10-16: 727 focused regression checks; 51 server
workflow checks across peer access, direct coordination, Hindsight and reviewed
team setup; both settings UI recipes; the Global Chief workflow including
mid-task revocation; and the bundled Hindsight recipe. TypeScript, lint, locale
validation, production renderer/server builds and all eight standalone packaged
server smoke checks passed. The native engine verification is macOS arm64;
this does not qualify Windows, Linux or macOS x64 installers.

Evidence retained under the launcher's `openmausbot-verification-evidence`
directory in the OS temporary directory:

- `server-1792168244224-26675.log.global-chief.json`
- `server-1792168386151-33199.log.global-chief-ui.json`
- `server-1792168386151-33199.log.global-chief.png`

The same Global Chief workflow and native Hindsight recipe also passed using
`release/mac-arm64/OpenMausBot.app/Contents/Resources/server/index.js` and that
app's `hindsight-runtime` tree. The installed app was updated from 0.1.103 to
0.1.113 after a normal quit; the previous app and complete data directory were
saved in the user's private `OpenMausBot Local Backups` directory. The arm64
DMG is built locally without Developer ID signing/notarization and has not been
published. No live role grants or verification conversations were created.
