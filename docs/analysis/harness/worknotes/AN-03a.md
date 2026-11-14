# AN-03a worknote

- Base sha (first pass, HEAD at session start): `fd4990ea` on `phase1/an-03a-psyche`. `origin/main` has since moved to `6fdc7738`; `git merge-tree` of this branch against it is conflict-free.
- Branch: `phase1/an-03a-psyche` (dispatch name; the card said `codex/an-03a-psyche-skeleton`).
- Commit: `AN-03a: psyche package` (dispatch message; the card said `feat(character): psyche package with sheet normalization and seeded RNG`).
- Decisions: D-CS-03 and D-CS-05 cited as assumed; D-HC-02 (portable engine). Recorded in ADR 0186 (Proposed, on main).
- Worknote path: `docs/analysis/harness/worknotes/AN-03a.md` (dispatch path; the card's `.../AN-03a.md` resolves to the same name).

## Needs a number

- The P0 ADR for the psyche boundary (card: `<allocate via registry>`). Not written; ADR 0186 is the only record of the assumed answers.

## Files

- New: `psyche/package.json`, `psyche/tsconfig.json`, `psyche/src/{index,types,sheet,rng,version}.ts`, `psyche/test/{sheet,rng}.test.ts`.
- Changed (manifest and image lines, all in the card's may-edit):
  - `pnpm-workspace.yaml`: `- psyche` in `packages`.
  - `pnpm-lock.yaml`: `pnpm install --lockfile-only`, then `--frozen-lockfile` passes (pnpm 12.15.0).
  - `golem/package.json`, `eventsink/package.json`, `tools/mcp-tokens/package.json`: `"@geldar/psyche": "workspace:*"`.
  - `golem/Dockerfile`, `eventsink/Dockerfile`, `tools/admin/Dockerfile`: `COPY psyche ./psyche`.
  - `golem/Dockerfile.dockerignore`, `eventsink/Dockerfile.dockerignore`: `!psyche` (both are allowlists). `tools/admin/Dockerfile.dockerignore` is a denylist, so it needed no change.

## Index lines to add

- Shared manifest and image lines are now AN-03a's. A later need for a manifest or COPY line goes through an "index line to add" here, not an edit to these files by another card.
- `psyche/README.md` and `psyche/RELEASE.json` are GX-02's. AN-03b adds the rolls under `psyche/src/` and its own tests.
- No decision number, migration or prompt is allocated by this card.

## Checks

- `pnpm test psyche/test`: 22 passed (sheet 13, rng 9).
- `pnpm --filter @geldar/psyche typecheck`, and the same for `@geldar/golem`, `@geldar/eventsink`, `@geldar/mcp-tokens`: exit 0.
- `pnpm test tools/repo-checks/src/colo-images tools/repo-checks/src/admin-image`: 21 passed.
- `pnpm check:repo`: ok. Its warnings are pre-existing line-cap warnings in other files.
- `pnpm format` changed only the new psyche files. `pnpm lint` (the full repo) reports 49 pre-existing warnings; `biome ci` on the touched files exits 0.
- `git diff --check`: clean.
- Not run: the ops lane (`docker build` of the three images with the frozen lockfile), and the full `./geldar.ps1 check` (it needs Gradle and the compose config).

## Mutations (revert-checks, run on the committed code, then restored)

- M1 `decisionId` without `generation` (`rng.ts`): 4 rng tests fail, including "gives a restart a new stream". Restored, `git diff --stat` empty.
- M2 `normalizeSheet` ignores unknown keys inside a score group (`sheet.ts`): "refuses an unknown key at every level" fails (`attributes`).
- M3 `normalizeSheet` ignores unknown top-level keys (`sheet.ts`): "refuses an unknown key at every level" (top level) and "refuses a sheet that carries proficiency" fail.

## Ambiguities and deviations

- Test-first: tests and code were written together, so no red run preceded the fix. The three mutations above are the evidence that the tests bite.
- Seed vectors (`rng.test.ts`): the three first draws and `seedFor` were taken from this implementation, so they pin the engine's behaviour rather than checking it against an external oracle. A change to the FNV or mulberry constants fails them, which is the intent.
- `sheetOrStandard` returns the frozen `STANDARD_SHEET` object itself for a missing sheet, not a copy.
- `STANDARD_SHEET` is typed `CharacterSheet` (as the card says), so the frozen check is runtime only.
- Card line "a source scan test asserts no file in psyche/src imports anything not starting with ./": implemented as a scan of from and import( specifiers that requires ./<name>.ts.

## Review fixes

- Finding 3 decision: the engine validates the key. `decisionId` throws `RangeError` when `lifeId` or `fx` is empty or contains `:`, and when `generation`, `tick` or `decisionSeq` is not a non-negative safe integer. `seedFor` and `rngFor` throw the same way, since they hash the id. The id format stays as the card gives it (no escaping).
- Callers: none outside `psyche/` (repo grep for `decisionId`, `DrawKey`, `seedFor`, `rngFor`). No existing psyche test key was refused; the colliding pair is now refused in both forms.
- Import scan: single, double and backtick quotes for `from`, `import` and `import(`; `require(` fails; a non-literal `import(` fails. Three appended lines in `psyche/src/version.ts` each fail it (revert-check).
- Score bound: `normalizeSheet` accepts every score at 1 and at 5. `score > 1` in `sheet.ts` fails it (revert-check).
- Seed vectors for non-ASCII `lifeId` (`é`, and an emoji surrogate pair). `charCodeAt(i) & 0x7f` fails them (revert-check). `fnv1a32` now says ports must hash UTF-16 code units.
- `eventsink/Dockerfile.dockerignore` excludes `psyche/test`, next to `eventsink/test`.
- `Score` import and `export type { Score }` removed from `sheet.ts`; typecheck passes.
