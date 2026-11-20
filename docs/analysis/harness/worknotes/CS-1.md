# CS-1 worknote: move the blocks out of `contract/src/index.ts`

Packet: `docs/analysis/harness/contract-index-split-plan.md`, section "CS-1 move the blocks".
Base: `9ad8f02b` (origin/main, CS-0 merged). Branch: `phase1/sheet-cs-1-split-index`.

## Result

`contract/src/index.ts` is 45 lines (was 599). It keeps the module comment, the explicit re-exports
of `agent-text`, the program shapes and `validation` types, and one `export * from` line per domain
file. The public runtime surface and the public type surface are unchanged: the CS-0 golden
(`contract/test/public-surface.golden.json`, 93 names) and `public-types.check.ts` are untouched and green.

| Domain file | Lines | Blocks moved (marker in old index.ts) |
|---|---|---|
| `core-records.ts` | 82 | P0-01 snapshot, P0-02 thought, P0-03 records, P0-17 record events; `validateWorldEvent` (between perception exports) |
| `perception-events.ts` | 20 | evidence, observation, heard-sound and provenance re-exports; heard-muffled re-export |
| `world-tool-inputs.ts` | 68 | PX-8b reach, see-tool, view-tool |
| `thinker.ts` | 79 | P0-04 thinker |
| `mind-channel.ts` | 96 | P0-20 Mind channel |
| `sovereign.ts` | 88 | WM-01 sovereign, book, presence, day-night, action-outcome |
| `character.ts` | 53 | AN-02a character |
| `proficiency.ts` | 58 | AN-02b proficiency, chunk-visited |
| `turn-record.ts` | 17 | GX-05a turn record |

Stays in `index.ts`: the module comment, `agent-text`, the program shape re-exports, the
`ValidationResult` re-export, `SC-30a mcp` (`export * from './mcp.ts'`).

No name was renamed. No file under `contract/src/generated`, no schema, no test, no consumer changed.

## Deviations from the plan (all forced by the real code, none renames anything)

1. Cross-block dependencies. Blocks were not self-contained, so the moved files carry the imports they
   need from their neighbours:
   - `thinker.ts` imports `MAX_RESPONSE_FORMAT_BYTES` from `./mind-channel.ts` (defined in the Mind block).
   - `sovereign.ts` imports the `ActionOutcomePayload` type and `validateActionOutcomePayload` (aliased
     `validateActionOutcomePayloadSchema`) from `./generated/*` (the action-outcome validator lives in the
     sovereign block, its imports lived in the Mind block).
2. `mind-channel.ts` lost the two imports that became unused once the action-outcome validator moved to
   sovereign (`ActionOutcomePayload` in the `import type` list, and the alias). Done in the lint-fix commit.
3. Interim import during the Mind move: the Mind commit (`d301390a`) adds one line to index.ts,
   `import { MAX_RESPONSE_FORMAT_BYTES } from './mind-channel.ts';`, because the thinker block still
   used the constant. The thinker commit (`b9a8bfeb`) removes it. Both commits are green.
4. `validateWorldEvent` sat between the perception re-exports in the old file. It moved to
   `core-records.ts`, as the WorldEvent type belongs to P0-03. The evidence, observation, heard-sound
   and heard-muffled re-exports moved to `perception-events.ts`.
5. Lint-fix commit (`289eae7a`, a separate subject): biome organize-imports on `contract/src` (import and
   export order) plus the two unused imports above. It also merged the heard-muffled export into the shared
   `./generated/validators.js` export in `perception-events.ts`, and stacked the two heard comments on it. The
   fix-1 commit puts the heard-muffled comment back on its own name inside that export. A separate
   `export { validateHeardMuffledPayload } from ...` line cannot pass `biome ci`: its organize-imports merges
   same-source exports and sorts names. No behaviour change.
6. Header comment of `index.ts` still said "Each packet fills only its own marked block below", which was stale
   (there are no marked blocks). The fix-1 commit rewrote it to state the rule: a card adds its exports to its
   own domain file (or a new domain file) and adds at most one `export * from` line here. The leftover
   `// --- SC-30a mcp ---` marker above `export * from './mcp.ts'` is removed.
7. Commits: one per domain file as the brief asked, plus the lint-fix commit. Not squashed.

## Commits

- `48897725` move turn-record
- `ce330b37` move proficiency
- `e302db4e` move character
- `332a4d9c` move sovereign
- `d301390a` move mind-channel (with the interim import, see deviation 3)
- `b9a8bfeb` move thinker
- `3c23f8ed` move world-tool-inputs
- `fbf307c0` move perception-events
- `833834d5` move core-records
- `289eae7a` lint-fix (sort imports, drop two unused)
- this worknote commit

## Checks (final)

- `pnpm --filter @geldar/contract exec vitest run public-surface`: 3 of 3 pass after every move and after the lint-fix.
- `pnpm --filter @geldar/contract typecheck`: pass after every move.
- Repo-wide `pnpm typecheck` (every workspace package, including `eventsink`, `golem`, `threshold/mcp`,
  `threshold/mcp-mock`, `animus`, `tools/*`): exit 0.
- `pnpm check:generated`: "contract/src/generated is up to date."
- `pnpm lint` (`biome ci .`): no errors after the lint-fix commit (was 9 errors before: 2 unused imports,
  organize-imports on 10 files).
- `pnpm check:repo`: exit 0 (YAML `!override` tag warnings are printed; they are not errors).
- `git diff --check`: clean.
- No `export *` produced a duplicate-name error, so no pair needed reporting.

## Revert-checks (run on the committed state; restored from a scratchpad backup, not git checkout)

(a) Delete `export * from './thinker.ts';` from `index.ts`:
- public-surface test FAILS: `AssertionError: expected [ Array(90) ] to deeply equal [ Array(93) ]`,
  `- "validateThinkerFrame"`-class names missing from the received list.
- contract typecheck FAILS: `test/mind-channel.test.ts(14,3): error TS2305: Module '"../src/index.ts"' has no exported member 'validateThinkerFrame'`
  and `test/public-types.check.ts(15,3): ... has no exported member 'CancelFrame'`.
- Restored; `git diff --stat` empty.

(b) Rename `export function validateTurnRecordPayload(` to `validateTurnRecordPayloadX(` inside `turn-record.ts`:
- public-surface test FAILS on the golden: `FAIL test/public-surface.test.ts > ... exports exactly the runtime names in public-surface.golden.json`,
  `- "validateTurnRecordPayload",` / `+ "validateTurnRecordPayloadX",`.
- Restored; `git diff --stat` empty.

## Dispatch rule (for later cards)

Sentence to add: "a card adds its exports to its own domain file (or a new domain file), never to
`index.ts` beyond one `export * from` line."

Proposed home: in the work-packets dispatch rules, next to the contract gate rule (no other contract card
runs until CS-1 merges, then the rule above applies to every contract card). Not edited here.
