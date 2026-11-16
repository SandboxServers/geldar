---
title: Psyche (the character engine)
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, components.md, ../concepts/character-and-memory.md, golem-body.md, cli-tools.md, ../../psyche/README.md]
sources: [psyche/README.md, psyche/package.json, psyche/RELEASE.json, psyche/src, psyche/test, tools/psyche-release, golem/package.json, eventsink/package.json, tools/mcp-tokens/package.json, ../decisions/0186-character-sheet-assumed-answers.md, ../decisions/0280-proficiency-contract-and-state-subjects.md, ../decisions/0281-psyche-package-boundary.md]
---

# Psyche (the character engine)

`psyche/` (package `@geldar/psyche`) is the character engine: the sheet rules, the seeded RNG, the roll rules, the engine version, proficiency levels, the threat policy and the temperament bank. The Mind kit in a sibling repo mirrors `psyche/src/` byte for byte, so both sides roll the same way (`psyche/README.md`; decision [0281](../decisions/0281-psyche-package-boundary.md)). The README is the mirror contract; this page lists the package's parts, users, release record and rules.

For why agents have a character sheet, see the [character and memory](../concepts/character-and-memory.md) explanation.

`psyche/src/` is mirrored into the kit, which agents run, so it is agent-read text ([agent-read paths](../agents/documentation-style.md#paths-an-agent-reads)). Never link an operator document from it.

## How this page was measured

Commit `1b114276`, 2026-11-16 (UTC), read-only. Re-derive:

```powershell
git ls-files psyche tools/psyche-release
Select-String -Path psyche/src/*.ts -Pattern "from '" | Select-String -NotMatch "from '\./"   # imports outside the package: none
git grep -l '@geldar/psyche' -- '*.ts' '*.json' ':!psyche' ':!pnpm-lock.yaml'
node tools/psyche-release/src/cli.ts --check                                                    # exit 0 when RELEASE.json matches (exit 0 on 2026-11-16)
git tag -l 'psyche-v*'; git ls-remote --tags origin 'psyche-v*'
```

## Package

| Field | Value | Evidence |
|---|---|---|
| Name and version | `@geldar/psyche` 1.1.0, private | `psyche/package.json` |
| Exports | `.` maps to `./src/index.ts` | `psyche/package.json` |
| Runtime dependencies | None. `src/` imports nothing outside itself: no `@geldar/*`, no `node:*`, no third-party package | decision 0281 point 1; the re-derive scan above found none |
| Dev dependency | `@geldar/contract`, for `psyche/test/` only | `psyche/package.json` |
| Tracked files | 23: 11 under `src/`, 8 tests under `test/`, README, `RELEASE.json`, `package.json`, `tsconfig.json` | `git ls-files psyche` |
| Engine version | `ENGINE_VERSION = 1` | `psyche/src/version.ts` |

## Modules

| File | Purpose (from its header) | Exports (`src/index.ts`) |
|---|---|---|
| `types.ts` | The character sheet's shapes (decision [0186](../decisions/0186-character-sheet-assumed-answers.md), D-CS-03); types only | `CharacterSheet`, `Domain`, `Score`, `SheetResult` |
| `sheet.ts` | The all-3 standard sheet, normalisation, canonical JSON for the sheet hash | `STANDARD_SHEET`, `normalizeSheet`, `sheetOrStandard`, `canonicalSheetJson` |
| `rng.ts` | Seeded RNG; a draw is keyed by producer, life, generation, tick, effect and decision sequence | `rngFor`, `seedFor`, `d20`, `decisionId`, `DrawKey`, `Rng` |
| `roll.ts` | d20 checks (D-CS-05): a score sets the mode (disadvantage, flat, advantage) and a bonus | `roll`, `modeFor`, `exactChance`, `DEFAULT_DCS`, `Mode`, `Roll` |
| `params.ts` | Scaled parameters: score 3 is neutral and returns the base | `factor`, `step` |
| `proficiency.ts` | Proficiency levels from XP; thresholds unmeasured and shard-configurable (D-CS-04) | `levelForXp`, `DEFAULT_THRESHOLDS`, `Level` |
| `threat.ts` | The per-life threat policy (AN-08a, D-CS-05); pure, the Body supplies the RNG | `decideThreat`, `fightFloor`, `fightLimitMs`, `ThreatCall`, `ThreatInput` |
| `alignment.ts` | An alignment label for operator views; never rendered to an agent | `alignmentLabel` |
| `temperament.ts` | The temperament bank: inactive data, read by nothing until the owner approves a delivery route (decision 0281 point 8, D-HC-13) | `TEMPERAMENT_BANK`, `temperamentFor` |
| `version.ts` | The engine version; bump on any change to the seed, sheet rules or roll rules | `ENGINE_VERSION` |
| `index.ts` | Re-exports the above | n/a |

## Users in this repo

Re-derived 2026-11-16 at `1b114276` with the `git grep` above.

| Package | Files | Uses |
|---|---|---|
| `golem` | 21 under `golem/src` | Threat policy, rolls, draw keys and proficiency levels in the Body (`golem/src/character/`) |
| `eventsink` | 10 under `eventsink/src` | XP awards, the ledger and state (`eventsink/src/xp/`, `eventsink/src/state/`) |
| `tools/mcp-tokens` | `src/players.ts` | Imports `CharacterSheet`, `canonicalSheetJson`, `normalizeSheet` and `STANDARD_SHEET`, and `node:crypto` beside them: sheet normalising and hashing for players (purpose inferred from the imports) |
| `tools/psyche-release` | release record | Hashes `psyche/src` |

The kit's copy lives in a sibling repo and is not checked here (plan decision D2).

## Rules from decision 0281

| Point | Rule |
|---|---|
| 1 | Package boundary: zero imports outside the package, so the kit can copy `src/` byte for byte. |
| 2 | `psyche/RELEASE.json` is the release record; each release is tagged `psyche-v<version>`; the kit pins the tree hash (`geldar-tree-v1`). |
| 3 | `ENGINE_VERSION` is part of the seed input and recorded with every roll and decision. |
| 4 | The sheet hash is the lower-case hex SHA-256 of `canonicalSheetJson(sheet)`; each consumer hashes, so psyche needs no `node:` import. |
| 5 | Rule R-sheet: the database baseline (`agents.character_sheet`) wins; a config sheet is a candidate; a malformed sheet is refused, never repaired. |
| 6 | The RNG stream key includes the body generation, so a restart never replays a draw. |
| 7 | Sheet data is operator-readable only and never reaches an agent context (prompts, MCP output, snapshots, agent-visible text). |
| 8 | With `rolls: false` the kit's moral hooks fail open; the temperament wordings stay inactive until the owner approves them. |

## Release record

`psyche/RELEASE.json` at `1b114276`:

| Field | Value |
|---|---|
| `format` | 1 |
| `version` | 1.1.0 |
| `engine_version` | 1 |
| `tree_hash_algorithm` | `geldar-tree-v1` |
| `tree_hash` | `f243f7c2...20182cf` (64 hex; read the file for the full value) |
| `tag` | `psyche-v1.1.0` |
| `files` | 11 entries, one per file in `src/`, each with its SHA-256 |

The tree hash rules (`geldar-tree-v1`) are in [psyche/README.md](../../psyche/README.md#the-tree-hash-geldar-tree-v1); the reference implementation is `tools/psyche-release/src/tree-hash.ts` with a pinned vector in `tools/psyche-release/test/fixture/`.

### The release tool

| Command | Effect |
|---|---|
| `node tools/psyche-release/src/cli.ts --write` | Regenerates `psyche/RELEASE.json` from `psyche/src` |
| `node tools/psyche-release/src/cli.ts --check` | Exits 1 when the committed record differs from `psyche/src` |
| no flag | Prints the usage line and fails |

`tools/psyche-release/src/release.test.ts` runs in `pnpm test` and fails when `src/` and `RELEASE.json` disagree. The tool is also listed in the [cli-tools](cli-tools.md) reference.

### Releasing a change under `psyche/src/`

The steps are in [psyche/README.md](../../psyche/README.md#the-rule-for-any-change-under-psychesrc): change `src/`, run `--write`, bump `version` in `psyche/package.json` (and `ENGINE_VERSION` only for a seed, sheet or roll change), commit, and after merge the owner's ops step tags `psyche-v<version>`.

## Build and test

| Task | Command |
|---|---|
| Tests | `./geldar.ps1 pnpm test psyche` (8 files in `psyche/test/`) |
| Release check | `./geldar.ps1 pnpm test tools/psyche-release` |
| Typecheck | `./geldar.ps1 pnpm --filter @geldar/psyche typecheck` |

`psyche/test/temperament.test.ts` is one of the agent-text checks named in the [style rules](../agents/documentation-style.md#paths-an-agent-reads).

## Conflicts and open items recorded

1. **Missing release tag.** `RELEASE.json` names tag `psyche-v1.1.0`. On 2026-11-16 the only `psyche-v*` tag in the local clone and on `origin` (`git ls-remote --tags`) is `psyche-v1.0.0`, at commit `549e7d07`. Version 1.1.0 was recorded by commit `ae35a592` (2026-11-14, the threat policy). The README's post-merge tagging step for 1.1.0 has not happened, or happened elsewhere; unverified which.
2. **"Planned for GX-02".** Decision 0281 point 2 calls the tree-hash algorithm "planned for GX-02". It exists: `tools/psyche-release/src/tree-hash.ts`, recorded by commit `63837f7b` (GX-02). The record is older than the code; records are not rewritten (plan decision D4).

## See also

- [golem-body](golem-body.md): the `fight_or_flee` reflex and the character runtime that use the threat policy.
- [eventsink](eventsink.md): XP awards and the proficiency state.
- Decision [0280](../decisions/0280-proficiency-contract-and-state-subjects.md): the proficiency contract and state subjects.
