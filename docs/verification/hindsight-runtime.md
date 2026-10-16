# Bundled Hindsight

Prepare the native bundle (uv 0.9.9 on the build machine):

```sh
pnpm build:hindsight
OMB_HINDSIGHT_VERIFY_BUNDLE="$PWD/dist-native/hindsight/darwin-arm64" pnpm exec vitest run server/hindsight-memory.local.e2e.test.ts server/hindsight-runtime.test.ts
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
