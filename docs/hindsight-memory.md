# Hindsight memory

Hindsight provides a semantic index for OpenMausBot's existing memory.
The local markdown files and reviewed team entries remain authoritative: edits,
undo, automatic capture, expiry and the Memory panel continue to work without
Hindsight. There is no second autonomous capture pipeline.

## Built-in desktop memory

This fork bundles Hindsight 0.10.3 with Python, embedded PostgreSQL/pgvector,
a quantized multilingual-e5-small ONNX model and its tokenizer. New packaged
desktop installations start the private memory service automatically. Users
do not install Docker, Python, a database or a model separately. Connecting
an AI account for the bots remains part of the normal first-run setup.

**Settings → Memory → Hindsight → Built into MausBot** controls the included
service. Disable/enable it without restarting the app; disabling keeps both
the canonical notes and the local index. The service runs on a private loopback
port with an ephemeral token, ends when its parent pipe closes and never
inherits the app's AI provider credentials. Its data lives in
`DATA_DIR/hindsight-runtime`; generated database/index files are excluded from
portable backups. Backups contain the original notes, from which a new
installation rebuilds its index.

Existing installations that explicitly configured a service URL retain that
external destination. They can choose the built-in service in Settings.
Source checkouts without a prepared runtime retain the external setup below.
For a development launch, explicitly set `OMB_HINDSIGHT_RUNTIME` to the staged
native bundle; packaged Electron supplies `OMB_RESOURCES_PATH` automatically.

The included profile preserves the Hindsight engine's retrieval and document
revision handling. It disables generative extraction, consolidation, reflect,
file parsers and unrestricted MCP access. It replaces only the ONNX tokenizer
loader, caps inference at two threads, and uses one worker with small database
pools. See [the distribution notes](../third_party/hindsight/README.md) for
the exact patches, versions and licenses. This is not a benchmark claim that
the smaller profile outperforms upstream Hindsight.

Build-machine prerequisite: uv 0.9.9. `pnpm build:hindsight` prepares both Mac
architectures on macOS, or the current Windows/Linux architecture. The desktop
packaging commands include this step and fail if the memory resource is missing
or its model checksum is wrong. macOS requires 15+, Windows targets x64, and
the Linux runtime requires glibc 2.35+. Native runtime CI covers all four
architecture targets; preparing foreign wheels alone is not runtime validation.

## External service

For a Mac installation with Docker Desktop, a loopback-only Compose setup is
provided in `deploy/hindsight/compose.yaml`. It sets the LLM provider to `none`
and uses `chunks` extraction, multilingual ONNX embeddings locally, and
lightweight RRF reranking. No Groq key, Ollama, or generative model is needed.
Hindsight indexes the existing notes; the Mausbot agent remains responsible
for reasoning and consolidating them. Hindsight observations/consolidation
are disabled, and its `reflect` endpoint is unavailable in this mode.
The standalone Hindsight MCP server is also disabled: bots use Mausbot's
identity-scoped memory tools, not unrestricted bank access.

Initial installation downloads the container and embedding model; notes are
not sent to a cloud LLM by this memory service. A bot using a cloud model can
still send recalled notes to its existing model provider as conversation
context. The worker is limited to one operation for smaller Macs. The
container has a 2 GiB memory limit and a two-CPU limit; Docker's VM consumes
additional resources. Database and model downloads are kept in separate
persistent Docker volumes.

From the repository root:

```sh
docker compose -f deploy/hindsight/compose.yaml up -d
docker compose -f deploy/hindsight/compose.yaml logs -f
```

On a Mac where `docker` is not on PATH yet, first run
`export PATH="/Applications/Docker.app/Contents/Resources/bin:$HOME/.docker/bin:$PATH"`.
This deployment pins Hindsight 0.10.3 by image digest; upgrades require changing
that reference. It does not automatically edit OpenMausBot's configuration or
restart the app. Wait for a healthy container before enabling the integration.
On macOS, you can also double-click `deploy/hindsight/start.command` to start
this deployment without typing the Docker commands.

Start a Hindsight instance using its [official installation guide](https://hindsight.vectorize.io/developer/installation).
An unbundled source/server deployment does not install or start Hindsight. A local instance
listening at `127.0.0.1:8888` is the
default destination.

In the modified app, open **Settings → Memory → Hindsight** (in Simple mode,
**AI → Memory**). Enable Hindsight, set the service address and choose **Save**.
Changes apply immediately without a restart. **Advanced limits** exposes search
and indexing timeouts and the token budget per bank. **Test connection** checks
only the service's health at the draft address; it does not save changes, send
notes or create banks. **Refresh status** reloads the saved enabled/indexing state,
errors and indexed-document count. These controls are owner/admin-only; personal
Cloud homes do not support the integration. Remote keys still come from
`OMB_HINDSIGHT_API_KEY` in the server environment.

Alternatively, add the following to the `memory` object in the OpenMausBot data directory's
`config.json` (normally `~/.openmausbot/config.json`), preserving any existing
upkeep settings, and restart OpenMausBot:

```json
{
  "memory": {
    "hindsight": {
      "enabled": true,
      "url": "http://127.0.0.1:8888",
      "recallTimeoutMs": 2000,
      "retainTimeoutMs": 30000,
      "maxTokens": 1024
    }
  }
}
```

Admins can also set `memory.hindsight` through the existing `PUT /api/config`
endpoint. `GET /api/config` includes `memory.hindsight.enabled`, `error`,
`pending` and `indexedDocuments`; it never returns the API key.

Installing this service does not update a previously installed OpenMausBot
desktop application. Run the modified fork or package it before expecting
these tools to exist. For development, close the installed app first so that
two servers do not write to the same data directory. From the fork, run
`pnpm dev:server`, `pnpm dev` and `pnpm dev:desktop` in three separate terminals,
as described in the repository README. To build an installable Mac version,
use `pnpm package:mac` with the required Swift/Xcode tooling. A full workspace
backup is recommended before switching application versions. This installation
does not replace or restart an already running desktop app.

For an authenticated instance, pass its key through `OMB_HINDSIGHT_API_KEY` in
the server's environment. Never put it into a bot's instructions, memory,
an MCP configuration, or the URL. Remote destinations require HTTPS and a key.
HTTP is accepted only for `localhost`, `127.0.0.1` or `::1`. Redirects are refused.
When OpenMausBot itself runs in Docker, loopback refers to that container,
not the Mac host. Configure a reachable HTTPS endpoint; Compose forwards
`OMB_HINDSIGHT_API_KEY` from `.env` into the server container.
This integration is deliberately unavailable on personal Cloud homes, whose
owner/lending memory isolation needs a separate export policy.

External Hindsight is disabled by default; bundled desktop memory is enabled.
Setting `enabled` to `false` stops indexing
and remote retrieval; existing remote data is not erased by that setting.
Switching destinations starts a fresh projection at the new endpoint, without
deleting the old destination. Delete old banks through Hindsight administration
before decommissioning it if that data must be erased.

## Scope and ownership

- One private bank per bot, one bank per team. Bank names include a persisted
  installation namespace, preventing collisions between installations.
- Team banks use persisted UUIDs, not display names. Renaming a team preserves
  its memory and bank identity. Deleting a team removes its projected entries.
  Recreating a deleted team with the same name gives it a new bank identity.
- Only accepted team entries are indexed. `propose_team_memory` retains its
  existing admin-review workflow; bot proposals cannot enter semantic recall
  before approval.
- Only durable notes are indexed, not conversation transcripts or daily logs.
  Active entries moved into the archive remain available; expired and
  superseded entries, including their continuation lines, are omitted.
- Received memories are ordinary recipient topic files, with separate
  provenance in `memory-shares.json`. They do not require a third bank.
- The integration supplies bank identity and revision filters internally.
  Bots cannot choose arbitrary banks, URLs or credentials.

The index manifest is `hindsight-index.json` in the data directory. It contains
bank mappings and document revision hashes, not note contents or API keys.
The sharing ledger contains author, source hash, conversation, recipient and
timestamp, not a second copy of the shared text. Keep both files with a full
data-directory backup to preserve identity and provenance. Imported team/bot
packages are distinct from a full data-directory backup.

## Tools

Existing `memory_update`, upkeep, journaled edits and undo trigger index refresh.
External edits are reconciled by the existing turn-boundary journal and a
30-second index scan. The index automatically picks up existing notes when
enabled; there is no separate manual migration step.

`memory_search({query})` retrieves this bot's memory and accepted knowledge from
its current team. It uses Hindsight `recall`, not `reflect`, with a low search
budget. Local lexical matches and accepted team entries remain available if
the service is down or a newly changed document has not finished indexing.
Automatic turn recall also includes bounded semantic context in the user-message
reference block, never as new system instructions. It adds at most 3,000
characters to the existing local recall block; `maxTokens` applies per bank.

`memory_share({target_bot_id, source_path, text})` explicitly copies an exact
active passage, at most 4,000 characters, from this bot's own durable notes.
Both bots must have memory enabled, be non-hidden, and belong to the same team
and audience. Restricted room turns cannot export their narrower room's notes.
Cross-team sharing is refused in this initial version. Bots are instructed to
share only when the user asks; the server enforces scope, not interpretation
of the user's intent.

The recipient receives `memory/shared-<id>.md` with author, source and timestamp.
Repeated identical shares are idempotent. Later edits are not synchronized;
share a changed passage as a new version. The recipient can edit or delete its
copy through the existing Memory panel. An identical retry does not resurrect
a deliberately deleted copy. Publishing to the whole team continues to use
`propose_team_memory`, not direct bank writes.
Provenance includes a copy hash; an edited recipient copy is marked as edited
instead of silently attributing its current contents to the original author.

## Failure and deletion behavior

Index writes use synchronous Hindsight `retain` calls in a background worker,
with stable `document_id`, replacement semantics and a persisted write intent.
An acknowledged document is not reprocessed unless its text or provenance
changes. Failed writes are retried on the next index pass; they do not block
chat or local writes. The bundled chunks/ONNX deployment uses local CPU and
memory, without cloud API calls. Other Hindsight deployments that use paid
models can incur costs independently of OpenMausBot's usage ledger and spend
cap.

Recall uses strict revision tags, requires a known document and matching tag in
each result, and checks the live source again after the response arrives.
An edited, expired, superseded or deleted revision cannot re-enter a prompt
while deletion/reindexing is pending. Observations are not recalled because
their derived provenance can outlive a source revision.

Deleting a local note, disabling a bot's memory, or deleting a bot removes its
projected documents on the next successful index pass while Hindsight is
enabled. During an outage, remote deletion is eventual, but retrieval already
refuses the absent/disabled source. Shared copies are independent: deleting the
author's note does not delete an explicit recipient copy, and deleting a copy
cannot erase answers already produced from it.

Projection limits are 256 documents per scope and 256 KiB per private document.
Larger notes remain local. Corrupt manifests fail closed instead of replacing
existing state. Restore them from backup before resuming the affected operation.

## Verification

```sh
pnpm exec vitest run server/hindsight-memory.test.ts server/memory-sharing.test.ts server/hindsight-memory.e2e.test.ts
```

The end-to-end test uses the shared isolated OpenMausBot launcher, the real
agents MCP proxy and an owned loopback Hindsight stand-in. It exercises native
recall, explicit sharing, cross-team rejection, team review/rename, deletion
and local fallback. It never accesses the user's running app or memory.
These tests prove integration and isolation, not a real Hindsight model's
retrieval quality or deployment compatibility. Test those separately against
your configured Hindsight instance before relying on it in production.

To verify the real model-free local deployment with synthetic notes only:

```sh
OMB_HINDSIGHT_VERIFY_URL=http://127.0.0.1:8888 pnpm exec vitest run server/hindsight-memory.local.e2e.test.ts
```

This opt-in test requires an explicit loopback origin. It launches an isolated
Mausbot with the fake agent engine, indexes Portuguese notes in uniquely named
Hindsight banks, verifies native search/sharing, revision replacement and
deletion, checks that `reflect` is disabled, and deletes its own banks afterward.
It does not inspect or mutate the running desktop application's data. Normal
test runs skip it when the destination is absent.
