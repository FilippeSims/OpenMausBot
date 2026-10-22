# Shared team files

Open **Times → a team → Arquivos do time**. The team's action menu also has
**Arquivos do time**. Each team starts with **Referências** and **Entregas**;
custom folders can be created at the root or inside another folder. For example,
open Referências, create Identidade Visual, and upload the original logo and
brand guide. Files can also be dropped into the current folder. Image and small
text previews, download, rename, trash and restore are available in the dialog.
The desktop offers **Mostrar pasta neste computador** for the actual directory.

Bots receive a directory index and instructions to inspect relevant references
before producing material. `team_files` lists folders, reads UTF-8 text or raster
images, creates folders and saves text deliverables. Other binary formats return
metadata and the host path for compatible file tools. Host paths are not
automatically mounted on a remote computer or VM. References are not appended
wholesale to every prompt, and this workflow does not guarantee a model's
judgment or its compliance with brand guidelines.

New final file attachments delivered by a bot in chat are copied into
`Entregas/<bot name>/`; text created with `team_files` is saved at its requested
relative path. Unattached scratch files and historical chat attachments are not
collected. A failed collection is reported in the file browser; the original chat
attachment remains available. Global Chiefs specify an authorized destination
team when using the tool and do not get a home-team attachment collector.

Files are stored under `DATA_DIR/team-files/<stable team identity>`, so renaming
a team preserves them and reusing an old team name creates an independent
directory. Individual files are limited to 25 MB, with a 2 GiB/10,000-entry team
limit including trash and delivery records. Same-name uploads retain different
contents as numbered copies and deduplicate identical content. Tool replacements
require the current SHA-256. Trash can be restored without overwriting another
item; it is retained on disk. Full workspace backups include these directories;
legacy partial team-copy files do not. Deleted teams' directories are retained
on disk without being granted to a new team with the same name.

Owner HTTP routes use the normal administrative authentication. Bot access is
limited to the home team or authorized Chief teams, with peer/audience checks.
Writes and attachment collection cannot spread content across mixed-audience
teams or restricted rooms. Paths are relative, portable, and reject traversal,
reserved internal names, symbolic links and hard-linked files. Active turn
authority is rechecked before committing bot writes. Concurrent uploads, moves
and trash operations are serialized per team.

## Isolated verification

```sh
pnpm exec vitest run server/team-files.test.ts server/team-files.e2e.test.ts scripts/testing/team-files-ui.e2e.test.ts server/workspace-backup.test.ts
```

The server acceptance test calls `launchVerificationServer` with a temporary
home/data directory and a scripted fake engine. Real tool requests prove SVG
content and PNG image delivery, text saves, automatic document/image attachment
collection, isolation from other teams, Chief scope, revocation, safe paths,
rename continuity and trash restoration. Its persistent evidence is printed as
`<server log>.team-files.json`. No real model credentials are used; model quality
is outside this test.

The UI test launches `control-omb ui launch`, drives the actual renderer by
accessible names, and creates Referências/Identidade Visual. It delivers a
synthetic SVG through a FileList change event and the real upload handler, checks
image decoding, renames, trashes and restores it, and checks geometry at 1280×900
and 390×844. This proves the handler and upload transport, not the operating
system's file picker. It saves screenshots and `<server log>.team-files-ui.json`.
Both launchers close only their owned fixture processes and temporary data.

The workspace backup round trip includes a binary team logo and checks its
restored bytes. Unit tests exercise revision conflicts, interrupted and oversized
streams, symlink/hard-link refusal and moving a folder while uploading into it.
