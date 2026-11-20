# AN-27b worknote: owner-side observation of a broken owned block

Status: code, fixtures and tests done. Inert: nothing wires `observeBreak` in; wiring is AN-28b. Activation held (D-CS-06); nothing is switched on.

Paper-only; do not enable on NeoForge until the human-handling question is decided.

## What it does

- `golem/src/perception/provenance/property-break.ts`: `observeBreak(msg, ctx)` returns a `property_broken` observation when the Body is the `prior_owner` of the broken cell, the breaker is not the Body, the cell is within 24 blocks of the Body (cell centre to `bot.entity.position`) and `ctx.canSee` is true. The breaker is named only through `ctx.resolve`; an unseen breaker gives an unattributed observation whose key carries `none`.
- The key is `brk:<tick>:<x>:<y>:<z>:<actor or none>`, lower-cased, and must pass the contract's `property_broken` key pattern (`^[a-z0-9:_-]{8,96}$`) through `validateObservationPayload` before the key takes a slot in `seen` (a `TakeKeyLru` of 256, the same bounded set AN-51b uses).
- Malformed input (non-integer or out-of-bounds numbers, negative tick, a block name outside `^[a-z_]{1,64}$`) gives null. A throwing resolver leaves the breaker unnamed; a throwing sight check sees nothing.

## Fixtures are the real captures

`golem/src/perception/provenance/fixtures/break-real.json` holds the two AN-27a captures, copied verbatim (the JSON content of each captured line, unchanged):

- `coreprotect_absent`: the line captured 2026-11-20 at commit 73788889, shard phase0, case break-coreprotect-absent (see `docs/analysis/harness/worknotes/AN-27a.md`).
- `coreprotect_present`: the line captured 2026-11-20 at commit 73788889, shard phase0, case break-coreprotect-present (same worknote).

The test `the captured real payloads validate with validateProvenance` reads `AN-27a.md`, and asserts that the two lines starting with `{"kind":"break"` equal `JSON.stringify` of the fixture values, in that order. The worknote was not edited.

Both captured breaks have the same coordinates (1313, 200, 800) and a `cobblestone` block; they differ in the prior owner (`null` with CoreProtect absent, `ag_capa_01` with CoreProtect present) and in tick (2064 and 411).

## Revert-checks (the card's three)

Each mutation changes one line of `property-break.ts`, runs `golem/src/perception/provenance/property-break`, and is restored from a backup copy.

1. Deliver when `prior_owner` is another name (guard changed to `msg.prior_owner === null`):
   - `× someone else's block gives nothing`
   - `× the captured real payloads validate with validateProvenance`
   - Tests: 2 failed, 12 passed.
2. Skip `canSee` (the sight guard removed):
   - `× a block out of sight gives nothing`
   - `× a throwing resolver leaves the breaker unnamed, and a throwing sight check sees nothing`
   - Tests: 2 failed.
3. Name the actor without `resolve` (`msg.actor` used directly):
   - `× a breaker out of sight gives an unattributed observation`
   - `× a throwing resolver leaves the breaker unnamed, and a throwing sight check sees nothing`
   - `× the raw breaker name never reaches the key or the payload when it is out of sight`
   - Tests: 3 failed.

## Mutation table (own)

| # | Mutation | Result |
|---|---|---|
| M4 | Raw actor name in the key when unseen (`actor?.name ?? msg.actor ?? 'none'`) | killed: 3 tests (`a breaker out of sight...`, `a throwing resolver...`, `the raw breaker name never reaches...`) |
| M5 | Reach rule removed | killed: `a cell 23 blocks away is in reach, one 25 blocks away is not` |
| M6 | `REACH` 24 changed to 26 | killed: the same reach test |
| M7 | `seen` not consulted (no admit) | killed: `the same message twice gives one` |
| M8 | Contract validation removed | killed by `a tick too large for the key shape gives nothing` (key carries `+`); before that test was added the mutant survived |
| M9 | `msg.actor === ctx.selfName` guard removed | survived: equivalent, because `msg.actor === msg.prior_owner` (also a guard) refuses the same input; the two guards are each redundant with the other |
| M10 | `tick >= 0` bound removed | killed: `a malformed break gives nothing` |

Mutations R1, R2, R3, M4, M5, M6, M7, M8 and M10 were each run; M9 was run and survived for the reason above.

## Index line for AN-28b

- AN-28b (Body subscription and leakage gate) calls `observeBreak` from `golem/src/perception/provenance/property-break.ts` with `canSee` built from `canSeeBlock` (`golem/src/perception/notable-blocks.ts`); `resolve` is `(u) => observedActor(bot, u)` from `visible-actor.ts`; `seen` is a `TakeKeyLru`. The module is inert until AN-28b wires it.
