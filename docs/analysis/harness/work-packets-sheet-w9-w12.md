# Sheet cards, waves W9 to W12: moral hooks, lineage, drift, measurement and rollout

## Number mapping (renumbered 2026-11-14)

| Item | Number before this commit | Number now | Note |
|---|---|---|---|
| Decision: sheet erasure covers dead lives (S9-00 cites it; no card writes it) | 0282 | 0282 (kept) | Written by PR #455 on phase1/an-04c-erase-comments (queued); S9-00 creates no decision |
| Decision: property refusal (S9-01) | 0283 | 0283 (unchanged) | Already in card order; not on origin/main or any ref checked on 2026-11-14 |
| Decision: lineage contract (S10-01a) | 0284 | 0284 (unchanged) | Same check |
| Decision: attribute drift (S11-01) | 0285 | 0285 (unchanged) | Same check |
| Decision: cohort export and protocol (S12-01) | 0286 | 0286 (unchanged) | Same check |
| Decision: adopting existing agents (S12-04) | 0287 | 0287 (unchanged) | Same check |
| Decision: rollout and rollback (S12-05) | 0288 | 0288 (unchanged) | Same check |
| Decision: spare | 0289 | 0289 (unchanged) | Spare |
| Decision overflow block | none used | 0320 to 0329 (not needed) | No card needs a ninth decision in this file |
| SQL: sheet erasure (S9-00) | 0052 | none; 0053 is free | 0052 is taken by 0052_character_erase_comments (PR #455). S9-00 is a gate with no migration, so 0053 is unused |
| SQL: lineage (S10-01b) | 0053 | 0054 | |
| SQL: drift (S11-02) | 0054 | 0055 | |
| SQL: exporter role (S12-01) | 0055 | 0056 | |
| SQL: conversion (S12-04) | 0056 | 0057 | |
| SQL: spare | 0057 to 0059 | 0058 and 0059 | 0059 is the end of the block |

Status: **proposal, nothing dispatched.** Written 2026-11-14 against geldar `origin/main` = `280b8ea9` (read in the worktree `phase1/cards-w9-w12`). Coordinator: geldar-sheet (decisions 0280 to 0289, SQL 0050 to 0059).

**What this file is.** A second, current pass over the W9 to W12 candidates in `docs/analysis/character-sheet/work-packets.md` (lines 369 to end). It differs from the older cards in [work-packets-geldar-b.md](work-packets-geldar-b.md) (W9) and [work-packets-geldar-c.md](work-packets-geldar-c.md) (W10 to W12) in four ways: (1) it uses the sheet campaign's own number ranges (those files recommended 0182+ and SQL 0037+, which other campaigns now hold); (2) every card says which **repo** it edits, and kit cards carry `HC-nn` ids; (3) anything that tells an agent who to be, or concerns birth, lineage, inheritance, moral hooks or drift, is marked **OWNER DECISION REQUIRED**, ships default-off and inactive, and names the exact question; (4) W12 adds the control-cohort design, staged enable, rollback and a separate roster-conversion card. Where an older card is still right, this file says "keep the shape of AN-xx in geldar-b/c" and states only the differences; where it is wrong or stale, the card here replaces it. The ids here are `S9-nn`, `S10-nn`, `S11-nn`, `S12-nn` (geldar) and `HC-41` and up (kit, **proposed**; the kit orchestrator owns kit numbering and confirms or renumbers). Old AN ids are cross-referenced in each card as `replaces`.

**Frozen facts every card obeys.**
- The in-house Mind (`animus/`) is frozen. The player kit (repo `geldar-scriptorium`, local checkout `C:\Users\Steve\source\projects\geldar-scriptorium`) is the one Mind. A Mind-side candidate is therefore a kit card or a Body/world card. No card here edits `animus/`.
- `psyche/` is a pure, zero-import package (decision 0281), mirrored byte for byte into the kit as `packages/psyche` (HC-17). Any change to `psyche/src/` is a psyche release (`psyche/package.json` version, `psyche/RELEASE.json` regenerated, tag `psyche-v<version>` by ops) followed by a kit re-mirror card.
- Sheet scores never reach any model context (prompts, MCP output, snapshots, Glass columns, kit workspace, child environment). Agents are never told they are watched, scored or coached. No card adds a message, hint or label that does either.
- Rule R-sheet (0281): the database baseline wins; a config sheet is a candidate.
- **Rangers run in their own containers, owned by scriptorium** (memory: Geldar registers, mints and skins only). A card that changes how a ranger behaves edits the Body (geldar, which runs every Body) or the kit (scriptorium), never a ranger's container.

## Dependency table

"Parallelizable now" means: a coder can start today from `origin/main` without waiting for another card in this file or in flight. In-flight foundations (AN-05 to AN-12, W5 to W8) are named; `no` means blocked on them or on an owner decision.

| Card | Repo | Depends on | Parallelizable now? |
|---|---|---|---|
| S9-00 erasure gate: every life_id table is erased with its life (no SQL, no decision) | geldar | none (0051 is merged; PR #455 is not an input) | **yes** |
| S9-01 refusal reason code and decision key (contract) | geldar | none for the code; OWNER decision 0283 before merge to a wave branch | **yes** (write now, merge gated) |
| S9-02 property-refusal hook (Body) | geldar | S9-01, AN-07, AN-11b (sheet and proficiency cache), AN-06b (roll producer) | no |
| S9-03 bind hook behind `morality_hooks` (Body wiring) | geldar | S9-02, AN-12 | no |
| HC-41 reflection facts leakage test (kit) | kit | HC-32, HC-26 | no |
| S9-04 W9 close (ops) | geldar | S9-02, S9-03, S9-00 | no |
| S10-01a lineage contract | geldar | AN-02a/b merged; OWNER decision 0284 (ids, formula) | no (owner) |
| S10-01b lineage SQL 0054 | geldar | S10-01a, S9-00 | no |
| S10-02 pure inherited-sheet factory (psyche 1.x) | geldar | S10-01a (field list) | no |
| HC-42 re-mirror psyche with the factory (kit) | kit | S10-02 released and tagged, HC-17 | no |
| S10-03 birth transaction and adapter | geldar | S10-01b, S10-02, C4 birth lifecycle (external) | no (BlockedDependency) |
| HC-43 child text approval gate (kit) | kit | HC-34b, HC-35b; OWNER decision 0284 | no |
| S10-04 W10 integration and ancestry query (ops) | geldar + kit | S10-03, HC-34c, HC-35c, HC-43 | no |
| S11-01 drift contract and policy config | geldar | S10-04; OWNER decision 0285 | no (owner) |
| S11-02 drift SQL 0055 | geldar | S11-01 | no |
| S11-03 evidence windows and eligibility | geldar | S11-02, AN-09a, AN-10a | no |
| S11-04 bounded transition and publication | geldar | S11-03 | no |
| S11-05 Body cache reload | geldar | S11-04, AN-11b | no |
| HC-44 persona refresh artifact and review gate (kit) | kit | S11-04, HC-25, HC-36a | no |
| S11-06 W11 integration (ops) | geldar + kit | S11-05, HC-44 | no |
| S12-01 exporter role and world exporter (SQL 0056) | geldar | S11-02 (every table exported exists), AN-04b | no (after S11-02) |
| S12-02 cohort metrics core | geldar | S12-01 run-folder format | no |
| S12-03 control equivalence proof (all-3 equals today's bot) | geldar | AN-12 | no |
| S12-04 roster conversion of existing agents (SQL 0057) | geldar | AN-05, AN-04b; OWNER decision 0287 | **partly**: loader and dry-run yes after AN-05; any write is owner-gated |
| HC-45 per-player sheet and instinct switch, stage and rollback (kit) | kit | HC-19, HC-26 | no |
| S12-05 staged enable and rollback runbook (docs and config diff) | geldar | S12-03, S12-04, HC-45; OWNER decisions 0288 | no (owner) |
| S12-06 run protocol, fixtures and run evidence (ops) | geldar + kit | S12-02, S12-03, HC-38, HC-37b; owner numbers | no |
| S12-07 campaign review and rollout close | geldar | S12-06, fresh campaign review | no |

Total: 28 cards: 23 geldar (S9-00 to S9-04, S10-01a to S10-04 with S10-01b/02/03, S11-01 to S11-06, S12-01 to S12-07; four of them are ops or close lanes) and 5 kit (HC-41 to HC-45). Cards already in the kit and only referenced: HC-17, HC-19, HC-25, HC-26, HC-32, HC-34a/b/c, HC-35a/b/c, HC-36a/b, HC-37a/b, HC-38.

**Deferred (not written, same reasons as geldar-b "Deferred"):** AN-38 law-weighted due-commitment wakes, AN-48 promise outcomes and AN-20 commitment scheduling wait for a kit commitment design (D-HC-06, question card HC-33). The `commitment_due` wake of brief 5.6 therefore has no home; this file does not invent one. AN-61 (reflection revises trust) is HC-32 plus HC-41 here; there is no `reflection/v3` because there is no in-house reflection prompt.

## Owner decisions needed

Nothing below is approved. Each is a card gate: the card may be written, tested and merged inactive, but it may not be enabled, and where stated may not be merged to a wave branch, until the owner answers. Numbers are the proposed decision record numbers (range 0280 to 0289).

| # | Gate (cards) | Exact question | Recommendation |
|---|---|---|---|
| OD-1 | 0283: property refusal (S9-01, S9-02, S9-03) | May a life's own `law` trait refuse a deliberate `mine` or `withdraw` on a cell another life placed (amending 0164, which keeps `mine` free), with `good <= 2` and starving as the exception, on the reading that principle 5 ("misbehaviour is data") is respected because the veto comes from the agent's sheet and not from a rule we impose? | Approve as an explicit trait, `morality_hooks: false` by default, disposable lives only until OD-9. |
| OD-2 | 0283: refusal wording (S9-01) | Is the agent-visible sentence "you decided against taking what is someone else's" acceptable? It is the only text an agent ever sees from this hook, and it names a decision the agent did not make in words. | Approve the sentence; if not, the owner supplies the sentence. It lives in one constant, so a change touches one line. |
| OD-3 | 0283: "starving" (S9-02) | What is starving numerically? Proposed: hunger value at or below 6 (food points out of 20) and no edible food carried. Unmeasured. | Accept as a starting value; measure in the W9 ops run before any live use. |
| OD-4 | 0283: rolls off (S9-02) | With `rolls: false`, does a hook fail open (never refuses; D-HC-14, accepted) or refuse when the exact success chance is at least 0.5 (which makes law 3 at DC 11, exactly 50 percent, refuse every time)? | Fail open (already accepted in D-HC-14); stated here so the Body hook matches the kit. |
| OD-5 | 0284: lineage on or off at all (S10-01a to S10-04) | Do actual births between lives happen in this campaign, and may a child's innate scores follow rounded mean of parents plus a -1/0/+1 mutation at 20/60/20 percent, clamped 1 to 5, using the parents' effective scores at the birth request? Or do inherited baselines replace this formula? | Approve the formula as written in the brief; keep prose seed synthesis (HC-35). Default `lineage: off`. |
| OD-6 | 0284: child text (S10-03, HC-43) | A child's identity and goals text tells the child who to be. May the synthesized text (from both parents' prose and up to two facts per parent) be used without a human reading it, or must the owner approve each child's text before the child starts? Which model synthesizes, and what budget? | Owner approves each child's text for the first N births (N chosen by the owner), then reviews a sample; the synthesis model is the parent harness's own configured model, never a silent substitute. |
| OD-7 | 0284: ids (S10-01a) | Child ids use the current `ag_` pattern (the common `LifeId`), not C4's proposed `lf_`. | Keep `ag_`; widen `LifeId` only through a C4 decision, never in this campaign. |
| OD-8 | 0285: drift (S11-01 to S11-06) | May an agent's effective attribute change over time (default off)? If yes: which fields are eligible (recommendation: the six attributes and law/good; not op modes; not proficiency), behaviour-based evidence rather than roll surplus, non-overlapping seven in-game-day windows, at most one point per eligible field per completed window, cooldown one window, and the immutable birth baseline kept? Does a sovereign agent's evaluation run at confirmed sleep? | Approve behaviour-based drift, default off; fields and numbers as recommended; sleep is the sovereign trigger. |
| OD-9 | 0285: persona refresh text (HC-44) | When drift changes an agent's temperament, may a refreshed persona text reach a sovereign agent (text that tells it who to be)? Never overwritten silently; a reviewed artifact only. | Approve an operator-reviewed artifact; the agent's own `identity.md` is never edited by code. |
| OD-10 | 0287: existing agents (S12-04) | Which sheet does each existing agent adopt (Adam and the six rangers)? The brief's Appendix A values are drafts read from prose. Also: does an existing agent adopt at all, or does only a new life get a sheet? | Adopt all-3 for every existing agent first (control equivalence), then owner-approved named sheets one ranger at a time (S12-05). |
| OD-11 | 0286, 0288: measurement and rollout (S12-01 to S12-07) | Cohort sizes, replicates, run length, spend ceiling, numeric success bars, and after results: enable, opt-in, tune or stop. | Fixed in `protocol.json` before the first run; rollout decided only on its results. |
| OD-12 | 0282: erasure covers dead lives (PR #455; gate in S9-00) | Reserved ruling (decision 0262 of registration): account erasure now also removes the sheet rows of that owner's **dead** lives. Open sub-question: when a deleted life is a parent, the child keeps its sheet but loses the ancestry edge (S10-01b deletes the edge rows). | Confirm. |

## The shared contract (names every card uses)

Existing, merged (verified at `280b8ea9`): schemas `character-sheet`, `roll-event`, `decision-event`, `sheet-adopted-event`, `proficiency-request`, `proficiency-state`, `proficiency-level` in `contract/schemas/`; tables `character_sheet_adoptions`, `rolls`, `decisions`, `xp_evidence`, `proficiency`, `proficiency_outbox` and `agents.character_sheet`, `sheet_hash`, `sheet_adopted_at`; function `sheet_erase_life(TEXT)` (0051); `psyche/src/` files `alignment`, `params`, `proficiency`, `rng`, `roll`, `sheet`, `temperament`, `types`, `version`; `golem/src/character/` (`character-config.ts`, `audit-events.ts`, `audit-publisher.ts`).

New names defined by cards here (a card using a name it does not define cites its definer):

```ts
// S9-01  contract/src/property-decision.ts
export function propertyDecisionKey(i: { lifeId: string; verb: 'mine' | 'withdraw'; x: number; y: number; z: number; day: number }): string; // "prop:<life>:<verb>:<x>,<y>,<z>:d<day>"
export const DECLINED_REASON: 'declined';
// S10-01a contract/src/lineage.ts
export type BirthId = string;                       // ^bn_[0-9A-HJKMNP-TV-Z]{26}$
export interface LineageBirth { version: 1; birth_id: BirthId; child_life_id: string; parents: [ParentRef, ParentRef]; formula_version: 1;
  birth_source: 'operator' | 'cradle' | 'spawn' | 'replacement'; born_world_tick: number; fields: InheritedField[] /* 13 */; child_sheet: InheritedSheet /* no proficiency */ }
export interface ParentRef { life_id: string; effective_revision: number }
// S11-01 contract/src/drift.ts
export interface DriftPolicy { enabled: boolean; fields: DriftField[]; window_days: 7; min_samples: number; margin: number; per_field_cap: 1; cooldown_windows: number }
export interface EffectiveSheet { life_id: string; revision: number; sheet: InnerSheet; baseline_hash: string }  // revision 0 = adopted baseline
// S12-04 tools/mcp-tokens
export type AdoptionSource = 'config' | 'roster' | 'birth' | 'conversion';   // 'conversion' added by SQL 0057
```

**Shared files and who owns them** (a card that edits one lists it under `shared-files`):

| Shared file | Owner in this file, serial order |
|---|---|
| `contract/src/index.ts` (534 lines, over the soft cap; AN-02b block still to move out) | S9-01, S10-01a, S11-01: each adds **one re-export line only**; the code goes in its own new file. Serial. Contract regeneration is serial: ask geldar-3b for the slot |
| `contract/schemas/action-outcome-event.schema.json`, `contract/src/outcome-words.ts` | S9-01 only |
| `golem/src/adam/adam-body.ts` (311 lines), `golem/src/character/character-config.ts` | S9-03, then S11-05; AN-12 and AN-60b-era edits elsewhere come first |
| `golem/src/actions/mine.ts` (405), `golem/src/actions/container.ts` (365) | S9-02 only (one call line each) |
| `eventsink/src/main.ts`, `eventsink/src/writer.ts` dispatch | S10-03, S11-04 (serial) |
| `sql/` and `.github/workflows/ci.yml` psql line | S9-00 (`sql/test/check-schema-erase.sql`, no migration), S10-01b (0054), S11-02 (0055), S12-01 (0056), S12-04 (0057): serial, one `-f sql/test/<file>` line each |
| `sql/README.md`, `docs/decisions/README.md`, ledger, RESUME, `tools/migrate` test list | orchestrator and ops, from "index line to add" in worknotes |
| `psyche/package.json`, `psyche/RELEASE.json`, `psyche/src/index.ts` | S10-02, then any later psyche change; serial; tag by ops |
| `pnpm-lock.yaml` and any `package.json` | S12-01 (new exporter package) only; others request an index line |
| `geldar.ps1` (`Get-NatsUsers`), `compose/*.yml`, `shards/*.yaml` | none edits a production shard. S12-05 produces a diff for the owner; fixtures go in new non-live files |

**Numbers.** Decisions: 0282 is PR #455's record (no card writes it); 0283 S9-01; 0284 S10-01a; 0285 S11-01; 0286 S12-01 (cohort export and protocol); 0287 S12-04; 0288 S12-05 (rollout and rollback); 0289 spare. Decisions 0280 and 0281 are used. SQL: 0053 is free (S9-00 is a gate with no migration, and no card uses it); 0054 S10-01b; 0055 S11-02; 0056 S12-01; 0057 S12-04; 0058 and 0059 spare. 0050 to 0052 are used (0052 is the comment-only erase migration on phase1/an-04c-erase-comments). Re-check the registry (`docs/analysis/phase1/packets/decision-number-registry.md` and the remote branches) at dispatch; a coder never picks a number, the dispatch gives it. If a number moves, the card's text says `<allocate via registry>`.

## Rules common to every card

- **R1 size.** One Haiku-class coder, about 50k working tokens (kit cards about 40k, D-HC-10). Over that, split before dispatch.
- **R2 branch and worktree.** `phase1/<id-lower>-<slug>` for geldar cards from the wave branch `phase1/sheet-w<N>`; `scriptorium/hc-<nn>-<slug>` from `scriptorium/hw0` for kit cards. Worktree `.claude/worktrees/<id-lower>`. The dispatch gives the absolute path. The coder never pushes, tags, opens a PR or merges.
- **R3 worknote.** geldar: `docs/analysis/harness/worknotes/<ID>.md`; kit: the kit's `docs/analysis/.../worknotes/` named in the dispatch. Shared-file needs go there as "index line to add".
- **R4 commit.** `feat(sheet): <result>` or `docs(sheet): <result>` (kit: the kit's convention); attribution lines supplied verbatim in the dispatch.
- **R5 on-cap.** Commit what passes, record base SHA, passing tests and unfinished steps in the worknote, leave a clean branch, stop. Never weaken a test or invent a design.
- **R6 must-not-edit baseline.** `docs/spec.md`, accepted decisions, merged migrations, merged prompts, hand edits to `contract/src/generated/`, other cards' worknotes, `pnpm-lock.yaml` and every `package.json` unless the card names them, any file not in may-edit, and always `animus/`. Never run `adam up`.
- **R7 GATE** (coder, no database, no shard): `git diff --check`; `./geldar.ps1 pnpm format` then `lint`; `./geldar.ps1 pnpm --filter <pkg> typecheck` per touched package; `./geldar.ps1 pnpm check:repo` (file caps 500 soft, 700 hard); `git merge-tree --write-tree phase1/sheet-w<N> HEAD` shows no conflict. **GATE-C** adds `./geldar.ps1 pnpm --filter @geldar/contract generate` then `./geldar.ps1 pnpm check:generated`. **GATE-S** (ops): apply `sql/[0-9]*.sql` in order to a scratch DB, run the `sql/test/check-schema*.sql` files with `psql -v ON_ERROR_STOP=1`, repeat on a DB migrated from `origin/main` (upgrade lane) and re-apply the new file (reapply lane). Real-DB sink cases: `$env:GELDAR_IT = '1'; ./geldar.ps1 pnpm test eventsink` (ops). Kit GATE: the kit's own `pnpm check` (name `(to confirm)` in the dispatch) plus the psyche mirror-hash test.
- **R8 inactive means inactive.** Every card in W9 to W11 adds behaviour behind a flag whose default is false, ships no production config change, and has a test that with the flag false (or `character` omitted, or `mode: off`) behaviour and bytes equal today's. Off draws no RNG, writes no row, emits no event, adds no prompt text.
- **R9 erasure rule.** Any new table whose rows are keyed by a life id **must** be added to `sheet_erase_life` (sql/0051) by the card that creates the table: the same migration re-creates the function (`CREATE OR REPLACE`) with the full list including the new table, adds the table to the `sheet_append_only` guard (delete permitted only under `geldar.erase_life`), grants nothing to PUBLIC, `geldar_mcp`, `geldar_glass`, `geldar_register` (except EXECUTE on the function), and adds a `COMMENT ON TABLE` with export and retention text. A schema check in `sql/test/` asserts the function deletes from the new table; the S9-00 gate runs a coverage check over every `life_id` table in the catalog. Tables not keyed by a life id say so on the card.
- **R10 honesty.** No true score, sheet, label or drift event appears in any agent-visible text, MCP output, snapshot, Glass column, prompt or kit workspace file. No card tells an agent it is observed, measured or coached. Refusal text names no owner, score, roll or operator. Each card with agent-visible text lists the exact string and its owner decision.
- **R11 revert-checks.** Every behaviour change has a test that fails when the change is reverted; the card names the reversal and the test. The coder runs each and records the failure in the worknote.
- **R12 pins.** Exact versions, no ranges; Docker images by digest; GitHub Actions by SHA; new dependencies at least two weeks old.

---

# Wave W9: moral hooks and reflective trust (inactive; OWNER DECISION REQUIRED OD-1 to OD-4)

W9 here is a trimmed world and kit wave: one Body hook, its contract, its wiring, a kit leakage test and the ops close. The due-commitment wake is deferred (see top).

## S9-00: sheet erasure gate (no migration; decision 0282 is PR #455's)

- **id** S9-00 **wave** W9 **repo** geldar **replaces** none (new) **depends-on** none (0051 is merged; PR #455 changes comments only and is not an input) **size** 20k. **branch** `phase1/s9-00-erase-gate`.
- **why.** The owner's ruling (geldar-registration decision 0262) says account erasure covers every life of the owner, alive or dead. Decision 0282 records it and migration 0052 corrects the 0051 comments; both are on `phase1/an-04c-erase-comments` (PR #455, queued). `sheet_erase_life` (0051) already deletes by life id with no alive-only condition, so dead lives need no SQL change. What later cards still need is a guarantee (R9): every table keyed by `life_id` is erased with its life, and a check fails when one is not. That is this card.
- **may-edit** `sql/test/check-schema-erase.sql` (new); `.github/workflows/ci.yml` (one `-f`); `sql/README.md` (one index line, if it indexes its checks `(to confirm)`); the worknote.
- **must-not-edit** R6; `sql/0050` to `sql/0052` and the `sheet_erase_life` body in `sql/0051` (no change here); `threshold/register/**` (the caller; whether register must pass dead lives is a note for geldar-registration, not an edit here); `docs/decisions/0282-*` (PR #455's).
- **decisions** none written. Cites 0282 and the 0171 open question on events. **OD-12** is answered in S10-01b, where the child-edge question arises.
- **shape.** No migration and no SQL number. The check file runs in CI with the other `sql/test/` files (one `-f` line) and has two parts:
  1. **Behaviour.** Seed a dead life (an `agents` row with `died_at` set) with one row in each of the six sheet tables; `SELECT sheet_erase_life(<dead id>)` removes all six; a second life's rows stay; a call with NULL raises; `geldar_mcp` and `geldar_glass` cannot execute it; the append-only trigger still refuses `DELETE` outside the function.
  2. **Coverage.** Read every table in schema `public` that has a column named `life_id` from `information_schema.columns`. For each, the body of `sheet_erase_life` (`pg_get_functiondef`) must contain `DELETE FROM <table>`. Any table that does not is reported by name and the check fails. The table list comes from the catalog, not a hard-coded list, so a later card cannot add a life-keyed table without the gate failing until it joins the function. The check matches the column name `life_id`; R9 makes that the name for every life-keyed table, and the card that adds one confirms it.
- **tests.** The behaviour cases above, and a coverage probe: inside one transaction the check creates `public.erase_gate_probe (life_id TEXT)`, expects the coverage query to report it, and rolls back. The real catalog must report nothing missing.
- **checks** GATE; GATE-S (ops, against the test database).
- **revert-checks** In a scratch run (not merged), add `IF died_at IS NOT NULL THEN RETURN;` to the function: "dead life rows are erased" fails. Drop `proficiency_outbox` from the function body: "all six tables empty after erase" and the coverage check fail. Make the coverage query skip every table (`WHERE false`): the probe test fails because nothing is reported.
- **worknote** `S9-00.md`; index line for `sql/README.md` if it applies. **commit** `test(sheet): gate that every life_id table is erased with its life`. **split line** none.

## S9-01: refusal reason code and decision key (contract)

- **id** S9-01 **wave** W9 **repo** geldar **replaces** AN-52 (geldar-b), trimmed: no reflection shapes, no commitment identity **depends-on** none to write; **OWNER DECISION REQUIRED** (OD-1, OD-2) before it merges to the wave branch **size** 35k. **branch** `phase1/s9-01-refusal-contract`.
- **may-edit** `contract/schemas/action-outcome-event.schema.json` (add `declined` to the reason enum); `contract/src/outcome-words.ts` (`REASON_PHRASE.declined`); `contract/src/property-decision.ts` (new); `contract/src/index.ts` (one export line); `contract/src/generated/**` by `generate` only; `contract/test/property-decision.test.ts` (new); `contract/test/outcome-detail.test.ts` (one fixture row); `golem/src/actions/outcome.ts` (one `FailReason` union member); `golem/src/metrics.ts` (one reason-list entry); `threshold/mcp/src/events/handlers/intent.ts` (one line mapping the `declined` prefix to the same fixed words) `(file names to confirm at dispatch; the older card cites them)`; `docs/decisions/0283-property-refusal-by-trait.md` (new, status Proposed); the worknote.
- **must-not-edit** R6; `golem/src/actions/mine.ts`, `container.ts` (S9-02); `protected-blocks.ts` and `goto*.ts` (decision 0164 protection is unchanged).
- **shapes.** Reason code `declined`. Agent text (**exactly one string, OD-2**): `REASON_PHRASE.declined = "you decided against taking what is someone else's"`, so the player reads `Your mine failed: you decided against taking what is someone else's.` It contains no owner name, number or marker word (`markedWords` in `contract/src/agent-text.ts`; "someone else's" passes). Key builder:
  ```ts
  export function propertyDecisionKey(i: { lifeId: string; verb: 'mine' | 'withdraw'; x: number; y: number; z: number; day: number }): string; // throws on a lifeId that fails LifeId, on a non-integer coordinate or day
  // "prop:ag_xxx:mine:12,64,-3:d41"; day = floor(worldTick / 24000)
  ```
  One reconsideration per in-game day: the same life, verb and cell inside one day always reuse the same decision, so repeated submission cannot reroll until success. The key is the `decision_id` of the `decision` audit event (AN-02a shape); no new field.
- **tests.** Old action outcomes validate unchanged; `declined` validates; the rendered sentence contains no digits, no name, no marker word; key stable for equal input, different for day, verb, each coordinate; malformed life id rejected.
- **checks** GATE-C; `./geldar.ps1 pnpm test contract/test/property-decision`, `contract/test/outcome-detail`.
- **revert-checks** Remove `declined` from the enum: "declined validates" fails. Drop `day` from the key: "a new day is a new decision" fails. Put a name in the phrase: "no name or digit" fails.
- **worknote** `S9-01.md`. **commit** `feat(sheet): declined reason code and property decision key`. **split line** the key builder is the second half.

## S9-02: the property-refusal hook (Body)

- **id** S9-02 **wave** W9 **repo** geldar **replaces** AN-37 (geldar-b; keep its design, differences below) **depends-on** S9-01, AN-07, AN-11b, AN-06b **OWNER DECISION REQUIRED** (OD-1, OD-3, OD-4) **size** 50k. **branch** `phase1/s9-02-property-refusal`.
- **may-edit** `golem/src/actions/property-refusal.ts` (new) and `property-refusal.test.ts` (new); `golem/src/actions/mine.ts` (one call line after the unbreakable/hazard checks and before the dig); `golem/src/actions/container.ts` (one call line in the withdraw action before the container is opened); `golem/src/actions/mine.test.ts`, `container-withdraw.test.ts` (one case each); the worknote. Verified at `280b8ea9`: `mine.ts` 405 lines, `container.ts` 365, `till.ts` already refuses another life's recorded block with `ownerRecordAt` and `isOwnPlacement` (use that pattern; names `(to confirm)` by reading `till.ts` and `protected-blocks.ts`).
- **must-not-edit** R6; `protected-blocks.ts`, `till.ts`, `goto*.ts`; `adam-body.ts` (S9-03); `contract/**`.
- **shape.**
  ```ts
  export interface RefusalPolicy {
    sheet(): { law: number; good: number; rolls: boolean; lawProficiency: 0 | 1 | 2 | 3 } | null;
    check(decisionKey: string, score: number, proficiency: 0 | 1 | 2 | 3, dc: 11): { success: boolean }; // the engine call from AN-06b/psyche; records the roll
    starving(): boolean;                 // OD-3: hunger <= 6 and no edible food carried
    day(): number;
  }
  export function setRefusalPolicy(p: RefusalPolicy | null): void;     // default null = today's behaviour
  export function refuseProperty(ctx: ActionContext, verb: 'mine' | 'withdraw', cell: Vec3): ActionOutcome | null; // null = proceed
  ```
  Refuses only when all hold: a policy is set; the cell is not the life's own placement; the recorded owner is known and is another life (**unknown ownership is never refused**; `goto`'s unknown-is-protected rule is a separate path); not (`good <= 2` and `starving()`); and `sheet.rolls` is true and `check(key, law, lawProficiency, 11).success`. **`rolls: false` never refuses (fail open, OD-4, D-HC-14).** The decision for a key is cached in a bounded map of 256 (oldest dropped) so a retry inside the day reuses it. A refusal returns the `declined` outcome with the S9-01 text, no detail beyond what existing failed outcomes carry, consumes no world time and leaves the cell untouched. The roll audit event (decision id = the key) is recorded by the engine call.
- **tests.** Self, other, unknown ownership; law 1 to 5 with injected draws; `rolls: false` (policy returns no refusal and `check` is never called); `good <= 2` starving proceeds, not starving can refuse; same cell and verb twice in one day (one decision, one roll record); new day decides again; action cancelled mid-action leaves no stale decision; restart (new policy instance, same key, same seeded result); refusal text and detail contain no owner name or number; **no policy set**: the existing `mine` and `container` suites pass unchanged.
- **checks** GATE; `./geldar.ps1 pnpm test golem/src/actions/property-refusal`, `golem/src/actions/mine`, `golem/src/actions/container`.
- **revert-checks** Refuse for unknown ownership: "unknown is never refused" fails. Drop the cache: "one decision per day" fails. Drop the starving exception: "good 2 starving proceeds" fails. Make `rolls: false` call `check`: "rolls false never refuses" fails. Give `policy` a non-null default: "no policy keeps today's behaviour" fails.
- **worknote** `S9-02.md`. **commit** `feat(sheet): trait-based refusal to take another life's recorded property`. **split line** `S9-02a` the module and unit tests, `S9-02b` the two call sites and their action tests.

## S9-03: bind the hook behind `morality_hooks` (Body wiring)

- **id** S9-03 **wave** W9 **repo** geldar **replaces** AN-53 world half **depends-on** S9-02, AN-12 **OWNER DECISION REQUIRED** (OD-1; activation is OD-11) **size** 35k. **branch** `phase1/s9-03-morality-binding`.
- **shared-files** `golem/src/adam/adam-body.ts` (owner this wave), `golem/src/character/character-config.ts`.
- **may-edit** `golem/src/character/character-config.ts` and `.test.ts` (recognize `morality_hooks: boolean`, default false; today the brief's keys are tolerated and ignored by AN-05); `golem/src/adam/adam-body.ts` and `adam-body.test.ts`; the player Body path `golem/src/players/main.ts` only if the player Bodies are built elsewhere than `adam-body.ts` `(to confirm: the older cards say one seam builds both)`; a new non-live fixture shard file `shards/fixtures/character-morality.yaml` (disposable lives only); the worknote.
- **must-not-edit** R6; `shards/phase0.yaml`, `shards/colo.yaml`, `shards/colo-mind.yaml` (no production config); `compose/*`; NATS ACL.
- **shape.** `CharacterConfig` gains `morality_hooks: boolean`. When `mode: sheet` and `morality_hooks: true`, the Body builds a `RefusalPolicy` from its own-life sheet, proficiency cache and roll producer and calls `setRefusalPolicy`; `setRefusalPolicy(null)` runs in `stop()` and in failed-start cleanup. Any other combination calls nothing.
- **tests.** `morality_hooks` true with `mode: off` does nothing; false or omitted does nothing; true with sheet sets exactly one policy; stop and failed start clear it; restart rebuilds it with the same life's sheet; the production shard files, parsed through the loader, give `morality_hooks: false`.
- **checks** GATE; `./geldar.ps1 pnpm test golem/src/adam`, `golem/src/character`.
- **revert-checks** Call `setRefusalPolicy` without testing the flag: "flag false sets no policy" fails. Skip the clear in `stop()`: "stop clears the policy" fails.
- **worknote** `S9-03.md`. **commit** `feat(sheet): bind the property-refusal hook behind morality_hooks (default off)`. **split line** none.

## HC-41: reflection facts never carry hidden truth (kit)

- **id** HC-41 (proposed) **wave** W9 **repo** geldar-scriptorium **replaces** AN-61 proof half **depends-on** HC-32 (estimates reach the reflect skill as facts, BlockedDecision today), HC-26 (child-environment test) **size** 30k. **branch** `scriptorium/hc-41-reflection-leakage`.
- **why.** The reflection input is kit-local now. The risk the older AN-61 named is real here too: a trust update must come from the model's own reading of bounded, uncertain facts, not from a true sheet. This card adds the proof; it adds no feature.
- **may-edit** a new test module in the package HC-32 touched (name from HC-32's worknote) and its fixtures; nothing else. Message the kit orchestrator before touching `packages/supervisor/src`, `mind-loop`, `messages.d`, `seams.json`, `template-src/instructions.md`.
- **shape (test only).** Build the reflect-skill facts for a fixture life whose true sheet is extreme (law 1, good 1) and whose estimates are all-3 priors; assert the rendered facts text (a) contains no digit that equals a true score used as a score, no `law`, `good`, `aggression` or other field name, no "estimate" number, only bounded wording; (b) is identical when the true sheet changes and the evidence does not; (c) marks an unobserved field as unknown; (d) the child environment (`childEnv`) has no variable carrying the sheet.
- **checks** the kit's check bundle plus the new test. **revert-checks** Add the true sheet to the facts builder: (a) and (b) fail. Render a prior as observed: (c) fails.
- **commit** `test(reflect): estimates and facts never carry a true sheet`. **split line** none.

## S9-04: W9 close (ops, serial)

- **id** S9-04 **wave** W9 **repo** geldar (ops lane, no code) **depends-on** S9-00, S9-02, S9-03, HC-41 **size** n/a (ops).
- **deliver (ops, one lane at a time; `bench` and live cases mutate the shard).** Disposable shard only (`shards/fixtures/character-morality.yaml`, never a ranger). Evidence: one real refused `mine` on another life's recorded block and one real `good <= 2` starving exception; a control run with `morality_hooks: false` and one with `mode: off` that show today's behaviour; a `rolls: false` run that never refuses; full `./geldar.ps1 check`; a 20 TPS body bench. Raw results go in the worknote with UTC time and source. A missing run is incomplete, not a pass.
- **proof** the refusal event, the decision row and the unchanged `mine` under both controls. W9 is closed only when OD-1 is answered; if unanswered, the wave closes **merged inactive** and the ledger says so.

---

# Wave W10: inherited sheets and actual births (OWNER DECISION REQUIRED OD-5 to OD-7; default off, inactive)

Nothing in W10 creates a child on its own. A mocked birth is not completion evidence. The general birth lifecycle (Cradle, population, server allocation) belongs to the existing C4 birth campaign; these cards add the sheet and ancestry record and the adapters, and record `BlockedDependency` when C4 is not on `origin/main`.

## S10-01a: lineage contract

- **id** S10-01a **wave** W10 **repo** geldar **replaces** AN-54a (keep its `LineageBirth` shape) **depends-on** AN-02a/b merged **OWNER DECISION REQUIRED** (OD-5, OD-7: decision 0284 must be Accepted before merge) **size** 40k. **branch** `phase1/s10-01a-lineage-contract`.
- **shared-files** `contract/src/index.ts` (one export line), generated output.
- **may-edit** `contract/schemas/lineage-birth.schema.json` (new); `contract/src/lineage.ts` (new, the types and validator wrapper); `contract/src/index.ts` (one line); `contract/src/generated/**` by `generate`; `contract/test/lineage-birth.test.ts` (new); `docs/decisions/0284-lineage-and-child-sheets.md` (new, Proposed); the worknote.
- **must-not-edit** R6; `contract/schemas/common.schema.json` (the `LifeId` pattern stays `ag_`), `character-sheet.schema.json`, `contract/src/subjects.ts` (no lineage subject: the database is the record).
- **shape.** As in AN-54a of geldar-c, with: `child_sheet` has attributes (4 innate), alignment (2) and op modes (7), no `proficiency`, `additionalProperties: false`, written out in full; `fields` is exactly 13 entries `{field, parent_a, parent_b, mean_rounded, u, mutation, child}` where `u` is the recorded draw in [0,1) and `mutation` is -1, 0 or 1 at 20/60/20 percent (the formula is S10-02's, the schema only records it); `parents` exactly two, each `{life_id, effective_revision}`; `birth_id` matches `^bn_[0-9A-HJKMNP-TV-Z]{26}$`; `child_life_id` is a common `LifeId` (`lf_` ids are rejected, with a test named so, expected to change only when C4 widens `LifeId`).
- **tests** valid example parses; rejects missing `birth_id`, lowercase in `bn_`, one parent, three parents, score 0 and 6, mutation 2, `formula_version` 2, unknown key, 12 fields, `child_sheet` with `proficiency`, `lf_abc` child.
- **checks** GATE-C. **revert-checks** Remove `additionalProperties: false` from `InheritedSheet`: "child sheet rejects proficiency" fails. Allow three parents: "rejects three parents" fails.
- **worknote** `S10-01a.md`. **commit** `feat(sheet): lineage birth contract (two parents, 13 recorded fields, no proficiency)`. **split line** none.

## S10-01b: lineage SQL (0054)

- **id** S10-01b **wave** W10 **repo** geldar **replaces** AN-54b **depends-on** S10-01a, S9-00 **OWNER** gate as S10-01a **size** 45k. **branch** `phase1/s10-01b-lineage-sql`.
- **shared-files** `sql/`, `ci.yml` psql line, `sql/README.md` index line (to add).
- **may-edit** `sql/0054_lineage.sql` (new); `sql/test/check-schema-lineage.sql` (new); `.github/workflows/ci.yml` (one `-f`); the worknote.
- **must-not-edit** R6; 0050 to 0052 (0053 is free).
- **shape.** Two tables, both keyed by a life id and so both added to `sheet_erase_life` in this migration (R9; the function is re-created with the eight-table list):
  ```sql
  CREATE TABLE IF NOT EXISTS lineage_births (
    birth_id TEXT PRIMARY KEY CHECK (birth_id ~ '^bn_[0-9A-HJKMNP-TV-Z]{26}$'),
    child_life_id TEXT NOT NULL UNIQUE REFERENCES agents (agent_id),
    source_event_id TEXT NOT NULL UNIQUE REFERENCES events (source_event_id),
    formula_version SMALLINT NOT NULL CHECK (formula_version = 1),
    birth_source TEXT NOT NULL CHECK (birth_source IN ('operator','cradle','spawn','replacement')),
    born_world_tick BIGINT NOT NULL,
    fields JSONB NOT NULL, child_sheet_hash TEXT NOT NULL CHECK (child_sheet_hash ~ '^[0-9a-f]{64}$'),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS lineage_parents (          -- the ancestry edges
    birth_id TEXT NOT NULL REFERENCES lineage_births (birth_id),
    slot SMALLINT NOT NULL CHECK (slot IN (1, 2)),
    parent_life_id TEXT NOT NULL REFERENCES agents (agent_id),
    effective_revision INT NOT NULL CHECK (effective_revision >= 0),
    PRIMARY KEY (birth_id, slot), CHECK (true));
  ```
  A trigger refuses a birth whose two parents are the same life, a parent that is not an existing life, and a child that already has a sheet from another source. Zero learned proficiency is by construction: no `proficiency` row is written at birth. `child_life_id UNIQUE` and `birth_id` primary key make a second birth of the same child or the same request impossible. Erasure: `sheet_erase_life(x)` deletes `lineage_births` where `child_life_id = x` and every `lineage_parents` row where `parent_life_id = x` or whose birth was deleted (OD-12: a surviving child loses the edge to an erased parent). Append-only guard as the 0051 tables.
- **tests** (GATE-S, ops): valid birth; duplicate birth id; duplicate child; same parent twice; missing parent; erase of a child deletes the birth and edges; erase of a parent keeps the child's sheet and birth but deletes the edge; role denial for `geldar_mcp`, `geldar_glass`.
- **revert-checks** Remove `child_life_id UNIQUE`: "second birth for one child refused" fails. Leave `lineage_parents` out of the function: "erase deletes the edge" fails.
- **worknote** `S10-01b.md`. **commit** `feat(sheet): lineage tables and their erase path (0054)`. **split line** `lineage_births` first, `lineage_parents` second.

## S10-02: pure inherited-sheet factory (psyche)

- **id** S10-02 **wave** W10 **repo** geldar (`psyche/`) **replaces** AN-42 **depends-on** S10-01a (the field list) **size** 40k. **branch** `phase1/s10-02-inherit`. Pure and inactive: nothing calls it yet.
- **may-edit** `psyche/src/inherit.ts` (new); `psyche/src/index.ts` (exports); `psyche/package.json` (minor version); `psyche/RELEASE.json` (regenerated by the release tool); `psyche/test/inherit.test.ts` (new); the worknote. **`ENGINE_VERSION` is bumped to 2 only if the seed input or roll rules change; this adds a function, so it stays 1.** Zero imports outside the package (0281): no `node:` and no `@geldar/*`.
- **must-not-edit** R6; `golem/*`, `eventsink/*`, `contract/*`.
- **shape.**
  ```ts
  export interface InheritInput { birthId: string; parentA: InnerSheet; parentB: InnerSheet; seed: string }   // parents' effective sheets as snapshotted at the request
  export interface InheritedField { field: string; parent_a: number; parent_b: number; mean_rounded: number; u: number; mutation: -1 | 0 | 1; child: number }
  export function inheritSheet(i: InheritInput): { sheet: InnerSheet; fields: InheritedField[] };  // 13 fields, deterministic in (birthId, seed, parents)
  ```
  Per field: `mean_rounded = round half up of (a + b) / 2`, `u` from `rngFor(birthId, field)`, mutation -1 if `u < 0.2`, +1 if `u >= 0.8`, else 0; `child = clamp(mean_rounded + mutation, 1, 5)`. The input type has no proficiency, learned-skill or relationship field, so none can enter by construction; the output has no proficiency.
- **tests.** 20/60/20 over an exhaustive sweep of `u` boundaries (0.19999, 0.2, 0.79999, 0.8); rounding of 2.5 to 3 and 3.5 to 4; clamp at 1 and 5; same input same output; different `birthId` different draws; all 13 fields recorded; a drifted parent's effective score is used, not its baseline (the caller snapshots; the test passes both).
- **checks** GATE; `./geldar.ps1 pnpm test psyche/test/inherit`; the release check `node tools/psyche-release/src/cli.ts --check`; after merge ops tags `psyche-v<minor>`.
- **revert-checks** Change `0.2` to `0.25`: the boundary test fails. Round half down: the 2.5 case fails. Remove the clamp: the extremes fail.
- **worknote** `S10-02.md`. **commit** `feat(sheet): pure inherited-sheet factory in psyche`. **split line** none.

## HC-42: re-mirror psyche with the factory (kit)

- **id** HC-42 (proposed) **wave** W10 **repo** geldar-scriptorium **depends-on** S10-02 merged and tagged, HC-17 **size** 20k. **branch** `scriptorium/hc-42-remirror-inherit`.
- **may-edit** `packages/psyche/src/**` (byte copy of `psyche/src/` at the tag); the pin file holding the tree hash; the mirror CI test fixture. Nothing else. Message the kit orchestrator first.
- **shape.** Copy `psyche/src/` at tag `psyche-v<minor>` byte for byte; record the new `geldar-tree-v1` hash from `psyche/RELEASE.json`; the existing CI test fails when the mirror and pin differ.
- **checks** the mirror-hash test. **revert-checks** Edit one byte in the mirror: the hash test fails. **commit** `chore(psyche): re-mirror psyche v<minor> with the inheritance factory`. **split line** none. The kit does not call `inheritSheet`; the world adapter (S10-03) does.

## S10-03: birth transaction and adapters

- **id** S10-03 **wave** W10 **repo** geldar **replaces** AN-55a/b **depends-on** S10-01b, S10-02, **C4 birth lifecycle on `origin/main` (external)** **OWNER DECISION REQUIRED** (OD-5, OD-6; ships `lineage: off`) **size** 50k. **status** BlockedDependency until C4 is present. **branch** `phase1/s10-03-birth-adapter`.
- **shared-files** `eventsink/src/main.ts` (one wiring line), `eventsink/src/writer.ts` dispatch (one case). Serial with S11-04.
- **may-edit** `eventsink/src/lineage/birth.ts` (new: one transaction), `birth.test.ts`; `tools/mcp-tokens/src/birth-cli.ts` (new operator verb `birth create --parents <life> <life> --birth-id <bn_...>`, dry-run default) `(placement to confirm against C4's own birth CLI)`; `golem/src/character/character-config.ts` (`lineage: boolean`, default false, shared with S9-03 so serial after it); the worknote.
- **must-not-edit** R6; any second life allocator (the child's life id comes from the C4 allocation); parents' game accounts (never reused); `animus/*`.
- **shape.** One SQL transaction: verify two living, distinct, eligible parents; read each parent's effective revision and sheet (baseline until drift exists); call the pure factory (the sink imports `@geldar/psyche`, which it already does for XP); insert `agents.character_sheet` for the child (source `birth`, via the existing adoption path, `result: 'adopted'`), one `lineage_births` row, two `lineage_parents` rows and the audit events, all or nothing. A retry with the same `birth_id` returns the committed row and draws nothing. Child proficiency: no row. The handoff of the child to a headless Body or to the kit's launcher is a separate step (HC-34c); a pending handoff never causes a second birth.
- **tests.** (unit with a fake `Sql`; real-DB cases are ops under `GELDAR_IT=1`) duplicate birth id; crash before commit leaves nothing; crash after commit then retry returns the same child; dead, missing or the same parent refused; `lineage: off` refuses with a clear code and writes nothing; no parent state is mutated; child XP zero.
- **checks** GATE; `./geldar.ps1 pnpm test eventsink/src/lineage`; GATE-S; ops `GELDAR_IT`.
- **revert-checks** Remove the unique check on `birth_id` handling: "retry returns the same child" fails. Write a proficiency row: "child XP zero" fails. Ignore the flag: "lineage off writes nothing" fails.
- **worknote** `S10-03.md`. **commit** `feat(sheet): birth transaction for inherited sheets (lineage off by default)`. **split line** transaction first, CLI second.

## HC-43: child text approval gate (kit)

- **id** HC-43 (proposed) **wave** W10 **repo** geldar-scriptorium **depends-on** HC-34b, HC-35b **OWNER DECISION REQUIRED** (OD-6) **size** 35k. **branch** `scriptorium/hc-43-child-text-gate`.
- **why.** The synthesized `identity.md` and goals tell a new agent who to be. Identity is write-once, so it must be approved before it exists.
- **may-edit** the `geldar-play` creation path HC-34c touches (`new --parents`) and its tests; a new `pending/` handling module; docs line in the launcher help. Message the kit orchestrator first (launcher files are his).
- **shape.** With the gate on (the default), `new --parents` writes the synthesized text to `<persona-dir>.pending/identity.md` and `goals.md`, prints a one-line instruction for the operator to review, and exits **without creating the player**. `geldar-play approve <pending-dir> --by <operator>` (flag name `(to confirm)`) moves it into place and then creates the player exactly once; a second approve is a no-op; reject deletes the pending directory. The text is never shown to any model before approval. With the gate off (an explicit owner setting, OD-6), creation proceeds as HC-34c.
- **tests.** Gate on: nothing is created before approval; approve creates exactly one player; duplicate approve creates none; a changed pending file after approval is refused; gate off equals HC-34c behaviour.
- **revert-checks** Create the player before approval: "no creation before approval" fails. Allow a second approve to create: "approve is idempotent" fails.
- **commit** `feat(play): child identity text waits for owner approval`. **split line** pending file first, approve verb second.

## S10-04: W10 integration and ancestry query (ops, serial)

- **id** S10-04 **wave** W10 **repo** geldar and kit **depends-on** S10-03, HC-34c, HC-35c, HC-43 **size** n/a plus a small code card for the query (below).
- **code part (35k, geldar):** `tools/admin/src/lineage-query.ts` (new, read-only) `(placement to confirm)` prints ancestry for a life id (parents, revisions, fields recorded, mutation draws) from `lineage_births` and `lineage_parents`; it never prints an owner; read through the operator path only, no MCP exposure. Tests: unknown life, a life with no parents, an erased parent edge. Revert-check: print the owner column: the "no owner in output" test fails.
- **ops evidence:** two disposable parent lives yield two distinct children (one headless, one sovereign through the kit), each with the recorded scores, owner-approved text and zero XP; duplicate and restart create no twin; `lineage: off` follows its accepted behaviour. W10 stays pending until both real handoffs are verified; if C4 is absent the wave closes **BlockedDependency**, not done.

---

# Wave W11: default-off attribute drift (OWNER DECISION REQUIRED OD-8, OD-9; default off, inactive)

Design (OD-8 recommendation, adopted by these cards if approved): behaviour-based drift; baseline immutable; windows of exactly seven in-game days (168,000 ticks at 24,000 per day) that never overlap; at most one point per eligible field per completed window; a window with an audit gap is ineligible; proficiency stays in its own table; op modes and evidence-free fields are never drifted. **The coder never chooses a formula or a threshold**: S11-01 fixes them in config and S11-03 reads them.

## S11-01: drift contract and policy config

- **id** S11-01 **wave** W11 **repo** geldar **replaces** AN-58a **depends-on** S10-04 (wave order; hard prerequisites S10-01a, AN-02) **OWNER DECISION REQUIRED** (OD-8; decision 0285 Accepted before merge) **size** 40k. **branch** `phase1/s11-01-drift-contract`.
- **shared-files** `contract/src/index.ts` (one export line), generated output, `golem/src/character/character-config.ts` (`drift` block).
- **may-edit** `contract/schemas/drift-policy.schema.json`, `effective-sheet.schema.json`, `drift-evaluation.schema.json` (new); `contract/src/drift.ts` (new); `contract/src/index.ts` (one line); `contract/src/generated/**`; `contract/test/drift.test.ts` (new); `golem/src/character/character-config.ts` and test (parse `drift: { enabled: false }` and the policy fields; default off); `docs/decisions/0285-attribute-drift-policy.md` (new, Proposed); the worknote.
- **must-not-edit** R6; `character-sheet.schema.json` (the baseline shape is unchanged); any formula.
- **shape.** `DriftPolicy` as in the shared contract section, with `enabled: false` the default, `fields` a subset of the six attributes and `law`, `good` (an unknown or op-mode field is rejected), `window_days` fixed at 7, `min_samples` integer at least 1, `margin` number in (0, 1], `per_field_cap` fixed at 1, `cooldown_windows` integer at least 1. The numbers have no default in code: a shard that enables drift supplies them, and the config loader rejects `enabled: true` without them. `EffectiveSheet.revision` starts at 0 (the adopted baseline) and rises by one per applied drift; `DriftEvaluation = { life_id, window_start_tick, window_end_tick, field, observed, expected, samples, decision: 'up'|'down'|'none'|'ineligible', reason }`.
- **tests.** Valid and invalid policies; `enabled: true` without numbers rejected; op-mode field rejected; seven-day tick conversion (168000); old config without `drift` loads unchanged and yields `enabled: false`.
- **checks** GATE-C; `./geldar.ps1 pnpm test contract/test/drift`, `golem/src/character/character-config`.
- **revert-checks** Default `enabled` to true: "default is off" fails. Accept `op_modes.*` as a field: "op modes are not eligible" fails.
- **worknote** `S11-01.md`. **commit** `feat(sheet): drift policy and effective-sheet contract (default off)`. **split line** schemas first, config parse second.

## S11-02: drift SQL (0055)

- **id** S11-02 **wave** W11 **repo** geldar **replaces** AN-58b **depends-on** S11-01 **OWNER** gate as S11-01 **size** 45k. **branch** `phase1/s11-02-drift-sql`.
- **shared-files** `sql/`, `ci.yml` psql line.
- **may-edit** `sql/0055_drift.sql` (new); `sql/test/check-schema-drift.sql` (new); `ci.yml` (one `-f`); the worknote.
- **shape.** Two tables keyed by life id, **both added to `sheet_erase_life`** (R9: the function is re-created with the ten-table list):
  ```sql
  CREATE TABLE IF NOT EXISTS sheet_revisions (            -- revision 0 is the adopted baseline copy; later rows are drift
    life_id TEXT NOT NULL REFERENCES agents (agent_id), revision INT NOT NULL CHECK (revision >= 0),
    sheet JSONB NOT NULL, sheet_hash TEXT NOT NULL CHECK (sheet_hash ~ '^[0-9a-f]{64}$'),
    evaluation_key TEXT NOT NULL, applied_at_tick BIGINT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (life_id, revision), UNIQUE (life_id, evaluation_key));
  CREATE TABLE IF NOT EXISTS drift_evaluations (
    evaluation_key TEXT PRIMARY KEY,                       -- "drift:<life>:<field>:<window_start_tick>"
    life_id TEXT NOT NULL REFERENCES agents (agent_id), field TEXT NOT NULL,
    window_start_tick BIGINT NOT NULL, window_end_tick BIGINT NOT NULL, samples INT NOT NULL,
    observed NUMERIC, expected NUMERIC, decision TEXT NOT NULL CHECK (decision IN ('up','down','none','ineligible')),
    reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (window_end_tick - window_start_tick = 168000));
  ```
  Append-only guard as the 0051 tables. `agents.character_sheet` is never updated (the baseline is immutable; a trigger on `agents` refuses an update of `character_sheet` once set, `(to confirm it does not already exist in 0050)`). A function `effective_sheet(p_life)` returns the highest revision row, or the baseline.
- **tests.** (GATE-S) duplicate evaluation key; revision gap refused; window length check; baseline update refused; erase removes both tables' rows; roles denied.
- **revert-checks** Drop `UNIQUE (life_id, evaluation_key)`: "same-window duplicate refused" fails. Leave `sheet_revisions` out of the erase function: "erase removes revisions" fails.
- **worknote** `S11-02.md`. **commit** `feat(sheet): drift evaluation and revision tables (0055)`. **split line** `drift_evaluations` first.

## S11-03: seven-day evidence and eligibility

- **id** S11-03 **wave** W11 **repo** geldar **replaces** AN-59a/b **depends-on** S11-02, AN-09a, AN-10a **OWNER DECISION REQUIRED** (OD-8: the per-field evidence and direction rule is the owner's; the card implements the rule written in decision 0285, it never invents one) **size** 50k. **branch** `phase1/s11-03-drift-eligibility`.
- **may-edit** `eventsink/src/drift/window.ts`, `evidence.ts`, `eligibility.ts` and tests (new); the worknote.
- **must-not-edit** R6; `psyche/*` unless 0285 puts a pure comparison in psyche (then it is a separate psyche card); any actual-score read for another agent; lifecycle trigger wiring (S11-04).
- **shape.** `evaluateWindow(lifeId, fieldPolicy, windowStartTick): DriftEvaluation`. Reads `rolls` and `decisions` for the life (decision ids and audit-gap flags from AN-06). A window is eligible only if its audit coverage is complete; samples below `min_samples` give `none`/`ineligible` with a reason; the difference between observed behaviour and the policy-expected behaviour must exceed `margin` to give `up` or `down`; a random roll surplus is never relabelled behaviour. Pure given a row reader injected as a function.
- **tests.** Exact window boundaries (first and last tick); samples just below, at and above `min_samples`; margin just below, at and above; mixed DCs and proficiencies; a gapped window; overlapping windows refused; an unsupported field returns `ineligible`; drift disabled returns before any read.
- **checks** GATE; `./geldar.ps1 pnpm test eventsink/src/drift`. **revert-checks** Use `>=` for `>` at the margin: the "at margin" case fails. Skip the gap check: "gapped window is ineligible" fails.
- **worknote** `S11-03.md`. **commit** `feat(sheet): seven-day drift evidence windows and eligibility (default off)`. **split line** windows and reader first, rule second.

## S11-04: bounded transition and publication

- **id** S11-04 **wave** W11 **repo** geldar **replaces** AN-43 and AN-60a **depends-on** S11-03 **OWNER** gate as S11-03 **size** 50k. **branch** `phase1/s11-04-drift-transition`.
- **shared-files** `eventsink/src/main.ts`, `eventsink/src/writer.ts`; `contract/src/subjects.ts` only if a new push subject is needed (then it is S11-01's change; prefer reusing the `state.<life>.level` pattern with a new `sheet` token, `(to confirm)` with geldar-3b, serial).
- **may-edit** `eventsink/src/drift/transition.ts`, `publish.ts`, `trigger.ts` and tests (new); the two shared sink files (one wiring line each); the worknote.
- **must-not-edit** R6; ACL files (a Body subscription needs the NATS conf change: record it as a handoff note for geldar-93, who applies it by hand).
- **shape.** One transaction: insert the `drift_evaluations` row (idempotent on `evaluation_key`) and, for `up` or `down`, the next `sheet_revisions` row with the single field moved by one and clamped to 1 to 5, refused if another revision exists with a higher number (stale). Then publish the new revision (outbox pattern, as proficiency) to the life's own Body. `trigger.ts` evaluates when a headless life reflects or a sovereign agent confirms sleep (`OD-8`); with `drift.enabled` false it returns before any read, any RNG and any write.
- **tests.** Min and max clamp; same-window duplicate; concurrent evaluations produce one revision; publication failure after commit republishes without a second revision; stale revision refused; baseline untouched; disabled drift writes nothing.
- **checks** GATE; `./geldar.ps1 pnpm test eventsink/src/drift`; GATE-S; ops `GELDAR_IT`. **revert-checks** Remove the clamp: the extremes fail. Apply two points: "one point per field per window" fails. Ignore `enabled`: "disabled writes nothing" fails.
- **worknote** `S11-04.md`. **commit** `feat(sheet): bounded drift transition and publication (default off)`. **split line** transition first, trigger and publication second.

## S11-05: Body cache reload

- **id** S11-05 **wave** W11 **repo** geldar **replaces** AN-60b **depends-on** S11-04, AN-11b **size** 40k. **branch** `phase1/s11-05-body-reload`.
- **shared-files** `golem/src/adam/adam-body.ts`, `golem/src/character/character-config.ts`.
- **may-edit** `golem/src/character/effective-sheet-cache.ts` and test (new); `adam-body.ts` (one subscription wiring); the worknote.
- **shape.** The Body keeps the effective revision of its own life; a push with a higher revision replaces it; a stale or lower revision is ignored; with `drift.enabled` false it subscribes to nothing and keeps the baseline. The threat policy (AN-08b) and S9-02 read the cache, so no component sees an older revision than another within one tick.
- **tests.** Higher accepted; equal and lower ignored; restart reloads from the request/reply path; drift disabled never subscribes; two readers see the same revision.
- **revert-checks** Accept a lower revision: "stale ignored" fails. Subscribe when disabled: "disabled subscribes to nothing" fails.
- **worknote** `S11-05.md`. **commit** `feat(sheet): Body reloads its effective sheet revision (default off)`. **split line** none.

## HC-44: persona refresh artifact and review gate (kit)

- **id** HC-44 (proposed) **wave** W11 **repo** geldar-scriptorium **depends-on** S11-04, HC-25, HC-36a **OWNER DECISION REQUIRED** (OD-9) **size** 35k. **branch** `scriptorium/hc-44-persona-refresh`.
- **why.** Changed temperament must not silently rewrite a sovereign agent's approved identity (the text tells it who to be). Replaces HC-36b's export with a reviewed artifact; HC-36a/b may be merged into this card by the kit orchestrator.
- **may-edit** the persona generator package (HC-25) for a refresh mode; the `geldar-play` verb `persona-refresh` (both launchers) and tests. Message the kit orchestrator first.
- **shape.** `geldar-play persona-refresh <player> --out <dir>` reads the player's own effective revision through the owner-authenticated read (GX-03; the supervisor-only copy), runs the HC-25 generator, and writes `refresh-<revision>.md` to the operator's out directory with a diff against the current wording. It never writes `identity.md`, never runs unattended and never prints a score. The agent is not told. With drift off it exits with "nothing to refresh".
- **tests.** No write into the persona directory; output has no digits as scores or field names; drift off yields nothing; the same revision yields the same file (deterministic).
- **revert-checks** Write to `identity.md`: "never writes the persona" fails. **commit** `feat(play): persona refresh artifact for operator review`. **split line** generator mode first, verb second.

## S11-06: W11 integration (ops, serial)

- **depends-on** S11-05, HC-44. **ops evidence:** a simulated seven-day boundary with the world clock advanced on a disposable shard, a real confirmation trigger for one headless and one sovereign life, restart and cooldown, a stale notification, drift disabled (no change, no RNG draw), two components on one revision, old journals unchanged. A pending kit refresh is reported as pending; the wave is not labelled full success until both paths are shown. If OD-8 is unanswered, close **merged inactive**.

---

# Wave W12: measurement and rollout

## Control-cohort design (the rule every W12 card serves)

- **The control rule.** `character` omitted or `mode: off` is today's bot. An **all-3 sheet with `rolls: false` is equal to today's bot** in every Body decision the sheet touches (floor 6, fight limit 30 s, no courage band, no refusal, no drift): S12-03 proves it by test, not by assertion. Any deviation is a bug in the card that introduced it, not a finding.
- **Treatments** (the older D-CS-11 four, extended by the harness dimension of the v3 plan): **A** off; **B** all-3, `rolls: false`; **C** all-3, `rolls: true`; **D** varied sheets, `rolls: true`. A vs B isolates the plumbing (must be equal); B vs C isolates the dice; C vs D isolates diversity. Harness (claude, chatgpt, local) and model are comparison dimensions stamped on events (GX-01), never confounds hidden in a cell. Morality, lineage and drift are separate registered on/off pairs run only after OD-1, OD-5, OD-8.
- **Cohorts.** Fresh lives per treatment, immutable world clone per run, distinct run and life ids, fresh RNG streams (generation in the stream key, 0281), no state from one run read by the next. Sizes, replicates, length and spend ceiling live in `protocol.json` (OD-11), accepted before the first run. A missing run is incomplete, not a pass.
- **Staged enable per ranger** and **rollback** are S12-05.

## S12-01: exporter role and world exporter (SQL 0056)

- **id** S12-01 **wave** W12 **repo** geldar **replaces** AN-33a (keep its run-folder design) **depends-on** S11-02, AN-04b **size** 50k. **branch** `phase1/s12-01-export`.
- **shared-files** `pnpm-lock.yaml` and the new package's `package.json` (sole owner), `sql/`, `ci.yml`.
- **may-edit** `tools/cohort-export/**` (new package `@geldar/cohort-export`, `pg` pinned exactly as `tools/mcp-tokens` does); `sql/0056_exporter_role.sql` (new); `sql/test/check-schema-exporter.sql` (new); `ci.yml` (one `-f`); `docs/decisions/0286-cohort-export-and-protocol.md` (new); `docs/runbooks/cohort-export.md` (new); the worknote.
- **must-not-edit** R6; `tools/progress-metrics/**`; `tools/admin/**`.
- **shape.** `geldar_exporter NOLOGIN` role with column-level SELECT only on the tables listed in the run (events columns without owner data, `agents` columns without `owner`, the six sheet tables, `lineage_*`, `sheet_revisions`, `drift_evaluations`); never `thoughts.model_input`, `mcp_*`, `register_audit`, `personality_seed`. Run folder `<out>/<run-id>/` (an existing folder is refused), files mode 0600, NDJSON: `manifest.json`, `public/` (event facts, no owner link, no sheet), `owner/lives.ndjson` (life id, harness, model, mode; no owner id), `private/` (true sheets, rolls, decisions, lineage, drift: **offline scoring only**). Flags `--run-id --lives --since-tick --until-tick --max-rows` (exceeding the bound fails the run, never truncates). Every statement is `SELECT` inside `BEGIN READ ONLY`. Read-only, no agent or MCP exposure. No tables created, so R9 adds nothing; the migration states so.
- **tests.** A spy asserts every statement starts with `SELECT` or `BEGIN READ ONLY`; out-of-scope lives yield no row; the row bound fails; no output contains a fixture owner id; public files have no `character_sheet` key; manifest marks `complete: false` on an audit gap; real read-role denial cases are ops under `GATE-S` (write fails, `SELECT owner FROM agents` fails).
- **revert-checks** Add `owner` to the column list: "no owner in output" fails. Drop the read-only transaction: "write denied" fails. Replace the row-bound failure with `LIMIT`: "bound fails the run" fails.
- **worknote** `S12-01.md`. **commit** `feat(sheet): operator cohort exporter and read-only role (0056)`. **split line** role and SQL first, exporter second.

## S12-02: cohort metrics core

- **id** S12-02 **wave** W12 **repo** geldar **replaces** AN-34a/b **depends-on** S12-01 (run-folder format), HC-37b (kit ledger file names) for the kit dimensions **size** 50k. **branch** `phase1/s12-02-cohort-metrics`.
- **may-edit** `tools/progress-metrics/src/cohort/*.ts` and `tools/progress-metrics/test/cohort/*` (new); `tools/progress-metrics/src/cli.ts` (new options only); fixtures; docs for the CLI; the worknote.
- **must-not-edit** R6; no database connection, no agent-facing output; existing inputs and results stay supported.
- **shape.** File-based: program-choice distributions per life, mean pairwise Jensen-Shannon divergence, model calls per useful autonomous minute, outcomes and survival, XP per domain, field-specific ToM error, program yields, refusals and trust revisions, parent-child inheritance, drift-window scores; each with an `insufficient_data` state rather than a number when samples are too few.
- **tests.** Hand-calculable distributions; empty samples; equal and disjoint choice sets (JS 0 and ln 2); every model retry counted; incomplete audits flagged; unsupported field estimates excluded; the old CLI inputs still produce the old report.
- **revert-checks** Swap JS arguments or drop a retry from the count: the matching hand-calculated case fails. **commit** `feat(sheet): cohort metrics from exported files`. **worknote** `S12-02.md`. **split line** distributions first, the rest second.

## S12-03: control equivalence proof (all-3 equals today's bot)

- **id** S12-03 **wave** W12 **repo** geldar **depends-on** AN-12 (and S9-03 if merged) **size** 35k. **branch** `phase1/s12-03-control-proof`.
- **may-edit** `golem/test/character-control/*.test.ts` (new, tests and fixtures only; no product code); the worknote.
- **must-not-edit** R6; every non-test file. If a difference is found, the card records it and stops; the fix is a new card.
- **shape (test).** Drive the Body decision functions twice per scenario, once with `character` omitted and once with `mode: sheet`, the standard sheet, `rolls: false`, `morality_hooks: false`, `drift.enabled: false`: threat decisions for health 0 to 20 armed and unarmed with each hostile kind; fight time limit; refusal hook (never refuses); proficiency bonus (zero at level 0). Assert equal outcomes, equal action sequences, **zero RNG draws, zero audit events for decisions that use no roll**, and equal prompt text bytes (the Body has no prompt; the kit side of this proof is HC-45's test).
- **revert-checks** Change the all-3 floor to 5 in the policy under test: "threat equals legacy over health 0 to 20" fails. Let `rolls: false` draw: "zero draws" fails.
- **commit** `test(sheet): all-3 sheet with rolls off equals today's Body`. **split line** none.

## S12-04: roster conversion of existing agents (one-time adoption; SQL 0057)

- **id** S12-04 **wave** W12 **repo** geldar **depends-on** AN-05 (loaders and roster adoption), AN-04b **OWNER DECISION REQUIRED** (OD-10; decision 0287) **size** 45k. **branch** `phase1/s12-04-roster-conversion`.
- **why.** Lives created before the sheet campaign (Adam and the six rangers) have `agents.character_sheet` NULL. AN-05 adopts a sheet only at `player add`. This card converts existing agents once, without ever overwriting a baseline.
- **shared-files** `tools/mcp-tokens/src/players.ts`, `cli.ts` (extends AN-05's edits; serial after it), `sql/`, `ci.yml`.
- **may-edit** `tools/mcp-tokens/src/convert-sheets.ts` and `.test.ts` (new); `tools/mcp-tokens/src/cli.ts` (one verb `player adopt-sheets`); `sql/0057_adoption_source_conversion.sql` (new: widens the `character_sheet_adoptions.source` CHECK to add `'conversion'`; alternative if the owner prefers no migration: reuse `'config'`, then this migration is dropped and the number is spare); `sql/test/check-schema-conversion.sql` (new); `ci.yml` (one `-f`); `docs/decisions/0287-adopting-existing-agents.md` (new, Proposed); `docs/runbooks/sheet-conversion.md` (new); the worknote.
- **must-not-edit** R6; ranger containers and scriptorium files (they are owned there); `agents.owner` (never read); production shard files (the candidate sheets come from a file the operator supplies, not from the repo).
- **shape.**
  ```
  geldar player adopt-sheets --shard <shard-file> --sheets <yaml|json file: life_id -> sheet | "standard"> [--apply]
  ```
  Default is a **dry run** that prints, per life: `would-adopt`, `same` (baseline already equals the candidate: no change), `conflict` (a different baseline exists: **the database baseline wins, nothing changes**, one `conflict` adoption row only under `--apply`), `refused` (malformed sheet, naming the life and field, never repaired) or `not-found`. `--apply` runs one transaction per life: write `agents.character_sheet`, `sheet_hash`, `sheet_adopted_at` and one `character_sheet_adoptions` row with source `conversion` and the matching result, only where the baseline is NULL (the same transaction guard as the roster path); a life already adopted is never updated. Idempotent: a second run reports `same` for every adopted life. Dead lives are skipped and reported. `"standard"` writes the all-3 sheet. The tool prints no sheet values for lives it did not touch and never prints an owner.
- **tests.** (fake `Sql`; real-DB lane is ops under GATE-S) NULL baseline adopts; equal baseline reports `same`; a different baseline reports `conflict` and changes nothing (the baseline row is byte-identical afterward); malformed sheet refused with life and field; dry run writes nothing (a spy sees no statement beyond `SELECT`); second apply is a no-op; dead life skipped; `--sheets` naming a life outside the shard refused.
- **checks** GATE; `./geldar.ps1 pnpm test tools/mcp-tokens/src/convert-sheets`; GATE-S.
- **revert-checks** Make the guard `UPDATE` unconditionally: "conflict changes nothing" fails. Default to apply: "dry run writes nothing" fails. Repair a malformed sheet: "malformed is refused" fails.
- **worknote** `S12-04.md`. **commit** `feat(sheet): one-time adoption of sheets for existing agents (dry run by default)`. **split line** `S12-04a` dry-run planner and loader, `S12-04b` apply transaction and SQL.
- **order of use (no code).** All lives adopt the **standard** sheet first (this changes nothing, by S12-03, and gives every life a baseline for audit). Named sheets for Adam and the rangers, from the brief's Appendix A or the owner's replacement, are a **second conversion run** the owner approves per life (OD-10): a life already holding a baseline is `conflict`, so changing a ranger from standard to a named sheet is not this tool's job and needs its own owner-approved decision (not designed here).

## HC-45: per-player sheet and instinct switch, staged enable and rollback (kit)

- **id** HC-45 (proposed) **wave** W12 **repo** geldar-scriptorium **depends-on** HC-19, HC-26 **size** 35k. **branch** `scriptorium/hc-45-stage-switch`.
- **may-edit** the supervisor settings reader for a per-player `sheet_mode` and `instinct` switch (the kit's existing per-world switch D-HC-09 made per player), `geldar-play` verbs `sheet on|off <player>` (both launchers) and tests. Message the kit orchestrator first.
- **shape.** Per player, default `off`. `off` is byte-identical to today: no `geldar-instinct` run, no descriptor-4 value, no new ledger rows. Turning a switch is an operator command and takes effect at the next waking, never mid-waking; a rollback is the same verb with `off`; the files already written (`instinct.jsonl`, the supervisor copy of the sheet) are kept, not deleted. The model is never told the state changed. Test (the kit half of S12-03): with `off`, the prompt handed to the model and the child environment are byte-identical to a build without this card.
- **revert-checks** Default `on`: "default off" fails. Delete ledgers on rollback: "rollback keeps history" fails. **commit** `feat(play): per-player sheet switch, default off`. **split line** settings first, verbs second.

## S12-05: staged enable per ranger and rollback (runbook and reviewed diff)

- **id** S12-05 **wave** W12 **repo** geldar (docs, plus the diff handed to the owner) **depends-on** S12-03, S12-04, HC-45, S12-06 evidence for each stage **OWNER DECISION REQUIRED** (OD-10, OD-11; decision 0288 records the rollout and rollback) **size** 30k docs. **branch** `phase1/s12-05-rollout-runbook`.
- **may-edit** `docs/runbooks/sheet-rollout.md` (new); `docs/decisions/0288-sheet-rollout-and-rollback.md` (new, Proposed); the worknote. **No shard file, ACL, compose or ranger container is edited by this card.** Activation is a separate diff the owner approves line by line.
- **content.**
  1. **Stages, one ranger at a time, each gated on the previous stage's evidence and an owner "go":** (0) standard sheet adopted for every life, everything else off (S12-04, changes nothing); (1) a disposable life with the Body flags on (proves wiring); (2) one ranger, **sheet mode with `rolls: false` and all-3** (the control equivalence, S12-03; expected to change nothing); (3) the same ranger with `rolls: true` (dice only); (4) one named sheet (OD-10); (5) then the next ranger. Hooks (`morality_hooks`), lineage and drift are **not** stages of the first rollout; each is its own later owner decision.
  2. **Each stage records:** the config diff (lines named), UTC time, the lives, the evidence expected, and the stop condition (any of: unexplained death rate change, stuck minutes above the protocol bar, an audit gap, a leak finding, an owner say-so).
  3. **Rollback, in this order:** set the per-player kit switch `off` (HC-45); set the life's Body `character.mode: off` in the shard file and restart that Body only (the Body's off path is today's, R8); leave the database untouched: **no schema, row or history is deleted** (the baseline stays, so a later re-enable resumes the same life under R-sheet); confirm with the S12-03 equivalence cases on the live life's recorded decisions (none new after the restart). Rollback is rehearsed on a disposable life before stage 2.
  4. **Never:** restart all six rangers at once; edit a ranger's own container; announce anything to an agent.
- **checks** `pnpm check:repo`; link check by reading. **commit** `docs(sheet): staged enable and rollback runbook`. **split line** none.

## S12-06: run protocol, fixtures and run evidence (ops, serial)

- **id** S12-06 **wave** W12 **repo** geldar and kit **replaces** AN-35a/b **depends-on** S12-02, S12-03, HC-37b, HC-38; **OWNER DECISION REQUIRED** (OD-11: numbers accepted before the first run) **size** 45k for the coder part (protocol file validator and non-live fixture shard files and collection scripts under `tools/cohort-run/` `(placement to confirm)`); runs are ops.
- **coder part.** A `protocol.json` schema and validator (treatments, sizes, replicates, run length, spend ceiling, bars; the validator refuses a protocol with a missing number); immutable world-clone manifest; fixture shard files per treatment (non-live); collection scripts that call S12-01 and the kit export (HC-37b); a fixed report protocol. Tests: a protocol missing a bar fails; two treatments differ only in declared factors (diff of the resolved configs); distinct run and life ids; model-call counters agree with the journal. Revert-check: remove the missing-number rule: the validator test fails.
- **ops part.** One case at a time, raw results in the worknote with UTC time and source, never re-running a failure away, no production shard edit, no journal truncation. At least one full seven-day drift window plus its evaluation boundary only if OD-8 is approved; actual births only if OD-5 is approved. A missing run is incomplete.

## S12-07: campaign review and rollout close

- **id** S12-07 **wave** W12 **repo** geldar **replaces** AN-36 **depends-on** S12-06, a fresh campaign review, OD-11 **size** 25k docs plus review and ops.
- **deliver.** Reconcile every feature claim against its evidence (a default-off feature needs its code and test evidence, not a live run); a docs sweep; the retro with owned, sized actions; the ledger and RESUME (at most 40 lines) updated; an explicit enable, opt-in, tune or stop ruling by the owner. **Rollback is shown working** without deleting schema or history. The kit close (HC-39) runs alongside. Product fixes found here are new coder cards, not edits in this one. Mind profile removal is a separate gateway decision.
- **may-edit** the campaign's ledger, worknotes and retro; named runbooks; only owner-approved config diffs. **commit** `docs(sheet): campaign review and rollout close`.

---

## Wave close (applies to W9 to W12)

Targeted and whole-wave evidence; a fresh read-only review per card and one per wave; a docs sweep from findings; a retro with owned, sized actions; ledger and RESUME updates; reports retained before removing only the completed worktrees. Database and NATS cases need real service evidence before their gate is complete. A wave with an unanswered owner decision closes **merged inactive**, and the ledger says which decision it waits for. Default-off or a blocker never marks a missing feature done.

## Open items

1. **Older cards exist for the same candidates** (geldar-b W9, geldar-c W10 to W12). The orchestrator should mark them superseded by this file or merge the two; the ids differ on purpose so neither set collides in the ledger.
2. **Names I did not verify** (no code read beyond file listings): the `FailReason` union and `metrics.ts` reason list, `intent.ts` mapping, the roll-producer call from AN-06b, `ownerRecordAt`/`isOwnPlacement` signatures, whether the player Bodies are built through `adam-body.ts`, an existing `agents.character_sheet` update guard in 0050, the exact check-schema file names, `tools/admin` as the home of the ancestry query. Each is marked `(to confirm)`; a card holding one is not Ready until the orchestrator confirms it.
3. **`contract/src/index.ts` is 534 lines** (soft cap 500). Cards add one export line each and put their code in new files; moving the AN-02b block out is still owed (RESUME follow-up).
4. **Decision 0262 (registration) is not on `origin/main`** at `280b8ea9`; decision 0282 (PR #455) records the ruling text, and S9-00 gates on the function, not on the ruling.
5. **The refusal and temperament text** (OD-2, and the HC-25 wordings D-HC-13) are agent-visible and unapproved; no card enables either.
6. **Kit numbering.** HC-41 to HC-45 are proposals; the kit orchestrator may renumber and may merge HC-44 with HC-36a/b.
