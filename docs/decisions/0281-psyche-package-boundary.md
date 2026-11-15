# 0281. Psyche package boundary

- Status: Accepted.
- Date: 2026-11-14
- Spec: none. This is a contract record for the character-sheet campaign; `docs/spec.md` is not edited.
- Related: 0186 (the assumed answers D-CS-03, D-CS-05 and D-CS-07, and D-HC-02), 0280 (proficiency contract and state subjects); `docs/analysis/harness/work-packets-geldar-a.md` (AN-03a, AN-03b, GX-02 and the shared contract section); branch `phase1/an-03a-psyche` (the psyche sources as AN-03a wrote them); kit decisions D-HC-12, D-HC-13 and D-HC-14 (decision 79)

## Context

AN-03a writes the `@geldar/psyche` package in geldar. It holds the sheet rules, the seeded RNG and the engine version. The Mind kit mirrors `psyche/src/` as `packages/psyche` (HC-17), so both sides roll the same way. This record fixes the boundary that the mirror depends on, the sheet hash, the sheet rule, the RNG stream key, and where the sheet may appear.

## Decision

1. **Package boundary.** `psyche/` is `@geldar/psyche`. The files under `psyche/src/` have zero imports outside the package: no `@geldar/*` package, no `node:*` module and no third-party package. Relative imports use the `.ts` extension. Tests in `psyche/test/` may import `@geldar/contract`, as a dev dependency only. Because `psyche/src/` imports nothing else, the kit can copy it byte for byte.
2. **Release record.** `psyche/RELEASE.json` is the release record, created by GX-02. Each release is tagged `psyche-v<version>`. The kit's mirror is pinned by a tree hash with the algorithm `geldar-tree-v1` (planned for GX-02), and a CI test in the kit fails when the mirror and the pin differ (D-HC-02).
3. **Engine version.** `ENGINE_VERSION` (1 at this record) is part of the seed input. Every roll and every decision records it. It is bumped on any change to the seed, the sheet rules or the roll rules, so a replay can tell which engine produced a result.
4. **Sheet hash.** The sheet hash is the lower-case hex SHA-256 of `canonicalSheetJson(sheet)`: keys sorted at every level, no whitespace. psyche returns the canonical string only. Each consumer does the hashing with one `node:crypto` line, so psyche has no `node:` import.
5. **Rule R-sheet.** The database baseline (`agents.character_sheet`) wins. A config sheet is a candidate. The first adoption sets the baseline. A later candidate that differs from the baseline is logged as `conflict` and changes nothing. Config initialises a life; restarting or editing YAML does not reseed it. A respawn keeps the life. A missing configured sheet normalises to the standard all-3 sheet, and a malformed sheet is refused, never repaired.
6. **RNG stream.** A draw is identified by `producer`, `lifeId`, `generation`, `tick`, `fx` and `decisionSeq`. The body generation is part of that key. Each generation starts a new stream with `decisionSeq` from 0, so a restart never replays a draw from an earlier generation. A retry of the same decision reuses its key and so its result.
7. **Where the sheet may appear.** Sheet data is operator-readable only: the database and operator tools. The sheet never reaches an agent context, which covers prompts, MCP output, snapshots and agent-visible text. For owned-loop harnesses, one derived integer (the sanity input, `common_sense`) is delivered on descriptor 4. The model never sees it (D-HC-12).
8. **Rolls off.** With `rolls: false` the kit's moral hooks fail open: a hook never refuses (D-HC-14). The temperament wordings (D-HC-13) are inactive until the owner approves them.

## Why

- The kit runs outside geldar's checkout, so its copy of the engine has to be byte-identical and self-contained. A single import outside the package would break the mirror.
- Recording the engine version on each result lets a replay identify the rules that produced it.
- The database baseline, the stream key and the operator-only rule keep one adopted sheet per life and keep sheet values out of agent-visible text.

## Consequences

- AN-03a implements the package. AN-03b adds the rolls under `psyche/src/` inside the same boundary. GX-02 adds the release record and the tag.
- A new import in `psyche/src/` is a boundary change. It needs an amendment to this record first.
- Changing the canonical JSON form, the hash input or the seed input changes results. Bump `ENGINE_VERSION` with the change.

## Not decided here

- The implementation of the `geldar-tree-v1` tree hash (GX-02).
- The owner's approval of the temperament wordings (D-HC-13).
