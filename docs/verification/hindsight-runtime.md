# Bundled Hindsight

Prepare the native bundle (uv 0.9.9 on the build machine):

```sh
pnpm build:hindsight
OMB_HINDSIGHT_VERIFY_BUNDLE="$PWD/dist-native/hindsight/darwin-arm64" pnpm exec vitest run server/hindsight-memory.local.e2e.test.ts server/memory-acceptance.local.e2e.test.ts server/hindsight-runtime.test.ts --maxWorkers=1
```

Select `darwin-x64`, `win32-x64` or `linux-x64` on their native runners. The
`Bundled Hindsight` workflow does that on each supported target. The tests never
use an installed Mausbot or a live Hindsight destination. They launch the
standard `launchVerificationServer` with an explicit bundled-engine resource,
temporary HOME/data and the fake bot provider; the memory database is confined
to that fixture. The persistent server log path is printed as evidence.

The actual engine checks automatic startup, Portuguese semantic recall through
the bot's tool, private bot isolation before sharing, explicit same-team share
with provenance, document replacement without stale recall, deletion, disabled
state and recall after service restart without rebuilding unchanged documents.
Native lifecycle checks verify the private API rejects missing credentials,
reflect/MCP/admin routes stay unavailable, and Python/PostgreSQL both exit.
Another owned fixture copies the full bundle to a different directory containing
spaces, crashes its parent and proves the parent pipe closes both subprocesses.

For the real settings UI:

```sh
node --experimental-strip-types scripts/verify-hindsight-runtime.ts
```

Open the printed `previewUrl`. Select **AI → Memory** in Simple mode, or
**Memory** in Advanced mode. The card initially selects **Built into MausBot**,
shows enabled/starting and has no service-address field. Test the connection:
only health is queried, without notes or tokens exposed. Disable and save,
refresh and verify stopped; enable and save, refresh to verify ready. Reload
and verify the persisted built-in selection and limits. Check a 390px viewport.
The external-mode form is covered by the separate settings fixture recipe.
Stop this launcher with Ctrl-C; it stops only its owned server and removes its
temporary data. The printed server log remains.

The native smoke does not prove a notarized installer passes Gatekeeper,
physical sleep behavior, retrieval quality at scale, or Windows/Linux execution
when run on a Mac. Package signing and OS acceptance need their native release
smokes. Do not call a foreign target validated just because wheel preparation
or an integrity check passed.

The unsaved-mode regression was verified on 2026-10-09 using the real settings
UI and an isolated native fixture. Its saved configuration initially selected
an unreachable external endpoint at `http://127.0.0.1:1`. Selecting built-in
memory and testing before saving displayed the enable/save instruction, without
an API request. Saving started the included service; refresh and connection
test then reported a verified connection (6 ms). Seven settings component
tests, type checking, locale validation and the production UI build passed.
The retained fixture log is:

`/var/folders/wm/_vf8496d22x63qthwrfbf7x40000gn/T/openmausbot-verification-evidence/server-1791582842315-66614.log`

The 2026-10-16 integration with upstream `55d4cd812` (0.1.113) passed the native
memory lifecycle and semantic-recall suites, including a run against the built
`dist-server/index.js`. The external-service fixture covers accepted team notes
using legacy name-based ownership, rename continuity and reusing the old team
name without inheriting its notes. Shared-memory approvals supply the upstream
API's required `expectedRevision`.

The production UI/server builds, type checking, lint, locale validation and the
standalone packaged-server smoke passed. Focused suites also covered settings,
tool catalogs with/without the bridge, authorization, Cloud lending, room-memory
prompts, capture restart and workspace backup. The real settings panel connected
to the bundled service in an isolated fixture (12 ms); its retained log is:

`/var/folders/wm/_vf8496d22x63qthwrfbf7x40000gn/T/openmausbot-verification-evidence/server-1792160905160-23016.log`

This validates the merged source and compiled server on Mac Apple Silicon. It
does not install the merged version into the user's live desktop application or
qualify new Windows/Linux installers.

## Conversation-to-team acceptance, 2026-10-22

The installed macOS arm64 0.1.120 server and native bundle passed the existing
local-recall recipe and `server/memory-acceptance.local.e2e.test.ts` in separate
disposable homes. The latter sends a Portuguese project fact through a chat,
waits for automatic capture into a topic file, and opens a new conversation
whose transcript does not contain the fact. Both automatic Hindsight context
and the bot's actual `memory_search` tool recover the captured file, with its
source and bot provenance. The test uses the installed two-second recall and
thirty-second indexing timeouts; capture's quiet period is shortened to one
second in the fixture only.

A second bot in the same team cannot retrieve the first bot's private fact.
After a `propose_team_memory` call registers an accepted team decision, that
second bot recalls the shared decision, while a bot in another team cannot.
The Global Chief recalls both scopes and loses those cross-bot reads on
demotion. Stopping Hindsight falls back to the accepted local team entry;
starting it again retrieves the same team entry without rebuilding the index.
The private topic remains in its original bot's workspace throughout.

The scripted capture model is disabled after the initial capture, and upkeep
is explicitly off on every other fixture bot. This prevents a scripted model
reply from manufacturing the private fact in another bot's notebook. The
fallback and post-restart assertions also require that no private copy exists.

The native acceptance evidence is retained beside the fixture log as:

`server-1792674509517-46914.log.memory-acceptance.json`

under `openmausbot-verification-evidence/` in the OS temporary directory. It
contains only synthetic notes and records the scope, source, backend and result
of every check. Eight related suites passed 127 capture, restart, store,
sharing, team-memory and access checks. Together with both native workflows,
129 tests passed. The live desktop was only read: its included service was
ready, enabled and had 22 documents indexed, without an error or pending work.
All fourteen live bots reported upkeep enabled and a currently available
background text model; existing upkeep metadata also included a successful
capture with saved notes. No private note text was needed for this check.
No test bots, notes, grants or conversations were added to the live workspace.

The Hindsight engine, embedding model, storage, scope checks and MCP tools are
real. The conversational and capture-model replies are scripted, so this does
not prove that a particular real model will choose or phrase every fact well.
To check that model in the app, give one bot a harmless, fictional project
fact, stop chatting for two minutes, confirm it appears in Profile → Memory,
and ask about it in a new conversation without repeating the answer. Inspect
the saved note and cited source as well as the reply: history search alone
could otherwise make a missing long-term note look successful. Test sharing
with a separate team fact explicitly registered for the team; ordinary private
bot notes are not automatically shared with teammates.
