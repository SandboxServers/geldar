# CS-0 worknote: public-surface golden for @geldar/contract

Packet: `docs/analysis/harness/contract-index-split-plan.md`, section "CS-0". Inert: no change to `contract/src`, schemas or generated code.

## Files

- `contract/test/public-surface.test.ts`: imports `@geldar/contract` as a namespace, compares `Object.keys(ns).sort()` with the golden file. Also checks that the golden list is sorted and has no duplicates.
- `contract/test/public-surface.golden.json`: 93 runtime export names (sorted).
- `contract/test/public-types.check.ts`: `import type` of 106 type-only exports from `../src/index.ts`, plus `export type PublicTypeNames = [...]` so every name is used. `tsc -p contract` compiles it. `ValidationResult` is written as `ValidationResult<unknown>` in the tuple because it is generic.

## How the lists were made

The lists come from a one-off script kept outside the repo (scratchpad). It walks `index.ts` and the `export * from` targets recursively, collects every top-level export name by pattern, and takes the runtime names from `Object.keys` of the imported module. Type-only names are the collected names minus the runtime names. Total collected: 199 (93 runtime + 106 type). Every runtime name was found by the pattern walk.

TypeScript 7.0.2 (the version pinned in the repo) ships a native binary with no JS compiler API (`createProgram` and `getExportsOfModule` are absent), so the compiler API the packet suggested was not available. The pattern walk is the substitute. Its coverage check is the revert-check below: a removed type export must fail `tsc`.

## Revert-checks (run in this worktree, restored by copying a backup)

1. `contract/src/index.ts`: `export function validateSnapshot(` changed to `function validateSnapshot(` (one line). `vitest run contract/test/public-surface.test.ts` fails: `expected [ Array(92) ] to deeply equal [ Array(93) ]`, with `-  "validateSnapshot"` in the diff. Restored; `git diff --stat` empty.
2. `contract/src/index.ts`: line `export type { ValidationResult } from './validation.ts';` deleted. `tsc -p contract --noEmit` fails: `test/public-types.check.ts(97,3): error TS2724: '"../src/index.ts"' has no exported member named 'ValidationResult'`. Restored; `git diff --stat` empty.

## Checks

- `biome check` on the three new files: clean.
- `tsc -p contract --noEmit`: clean.
- `vitest run contract/test`: 45 files, 741 tests, all pass.

## Next

CS-1 moves the blocks. Any move that drops or renames an export fails `public-surface.test.ts`; any drop of a type fails `tsc`.
