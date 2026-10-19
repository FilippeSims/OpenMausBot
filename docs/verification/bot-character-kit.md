# Bot character kit

The owner's 24 bodies, 20 faces and 24 accessories are bundled as local SVG
layers. Open a bot's profile, select its avatar, then **Build a character**
(**Montar personagem** in Portuguese). Changes save through the profile patch
queue. Choose a fixed face or an automatic face based on activity, combine up
to eight distinct accessories, and adjust each accessory's position, scale,
rotation and layer order. **Classic** and **Reset mascot** restore the existing
mascot renderer.

`mascotAppearance` stores catalog IDs and bounded numeric transforms, never
uploaded markup or file paths. The same appearance travels through bot
creation defaults, duplication, presets, team manifests, team backups and
organization packages. Package look fingerprints include the kit while
preserving the legacy fingerprint shape. SVG gradient IDs are unique per
rendered avatar. Original PNGs and sheets are not shipped.

## Isolated checks

```sh
pnpm exec vitest run shared/mascot-kit.test.ts src/components/BotKitAvatar.test.ts src/components/Avatar.test.ts src/components/BotProfileAvatarCard.test.ts src/components/BotIdentityAvatars.test.ts src/state/bot-creation.test.ts src/state/bot-patch-queue.test.ts server/bot-profile.test.ts server/team-manifest.test.ts server/team-backup.test.ts server/new-bot-defaults.test.ts server/package-parts.test.ts server/package-export.test.ts server/package-import.test.ts server/presets.test.ts server/org-library.test.ts
pnpm exec vitest run src/state/store.test.ts server/request-auth.test.ts server/new-bot-defaults.e2e.test.ts server/team-package-skills.e2e.test.ts shared/package-format.test.ts
OMB_UI_E2E=1 pnpm exec vitest run scripts/testing/bot-kit-ui.e2e.test.ts
pnpm lint
pnpm i18n:check
pnpm build
pnpm build:server
pnpm build:companion
node scripts/smoke-packaged-server.mjs
```

The UI test launches `control-omb ui launch` with its own disposable home and
fake engine. It selects the kitten body, wink face, crown and round glasses,
moves the glasses, changes color, and checks the saved profile and multiple
rendered avatars. It also creates a second bot using that appearance, rejects
an invalid catalog ID, reloads, confirms persistence, removes accessories and
resets the mascot. A screenshot and synthetic saved-state JSON remain next to
the fixture's server log. The launcher receives SIGINT in cleanup and removes
only its owned temporary data.

## Verified 2026-10-19

The 21 focused suites passed 533 tests. The real renderer fixture passed and
produced `server-1792438702670-91408.log.bot-kit.json` and the matching
`.bot-kit.png` under the system temporary directory's
`openmausbot-verification-evidence/`. Visual inspection confirmed the layered
avatar in the sidebar, conversation header and profile preview. Lint,
translation validation, TypeScript and production builds passed. All eight
standalone packaged-server smoke checks passed without reachable node_modules.

The macOS arm64 package was built as version 0.1.114. These checks do not
qualify native Windows or Linux installers. No live bot profile or conversation
was mutated for verification.
