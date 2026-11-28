# Sheet cards, waves W9 to W12: erasure gate, lineage, drift, measurement and rollout

Status: **proposal, nothing dispatched.** Revised 2026-11-18 against geldar `origin/main` = `a8063b0a` and kit `origin/scriptorium/hw0` = `673d756`, applying [sheet-cards-verification-2026-11-18.md](sheet-cards-verification-2026-11-18.md) and the operator rulings of 2026-11-18 (numbered as the operator gave them):

- **Ruling 4** (decision 0323, "Erasure scope is every life-keyed table; OD-12 confirmed"). S9-00 covers **every life-keyed table**, not only the six sheet tables, and checks the union of the two erase functions. `turn_records` is a real gap, fixed by the new card **S9-00a** (SQL 0053) before S9-00 can pass.
- **Ruling 7** (decision 0326, "No property-refusal hook: mining stays free"). OD-1 no. The W9 property-refusal hook (S9-01, S9-02, S9-03) is **not built**; W9 closes **merged inactive**. OD-2, OD-3 and OD-4 are approved only for the case that OD-1 is revisited, kept below as dormant text. Decision 0283 is not written and is never marked Accepted.
- **Ruling 8** (decision 0327, "No births, no attribute drift and no persona refresh in this campaign"). OD-5 no births. W10 closes merged inactive: **no W10 card is dispatched**, lineage stays off; anything later written for W10 merges inactive only. OD-6 and OD-7 are moot. Decision 0284 is not written; SQL 0054 stays free.
- **Ruling 9** (decision 0327). OD-8 no drift: **no W11 card is dispatched**; decision 0285 is not written; SQL 0055 stays free. OD-9 no persona refresh text at all: HC-44 (and the kit's HC-36a/b) are retired; nothing writes agent-visible persona text.
- **Ruling 10** (decision 0328, "Existing agents adopt the all-3 control sheet first"). Existing agents adopt the all-3 control sheet first (S12-04); the write half writes the all-3 sheet only; named sheets come one ranger at a time with operator approval; all of it behind the held-live ruling.
- **Ruling 11** (decision 0323 item 3). OD-12 confirmed: account erasure also removes the sheet rows of dead lives (decision 0282 as merged, with `sql/0052_character_erase_comments.sql`).

The W10 and W11 cards below are kept as **dormant design** (status "Inactive (0327), not dispatched") so a later campaign can pick them up; their verified facts are corrected in place, but no coder is dispatched from them in this campaign.

Every card is written for one Haiku `packet-coder` at low effort: the dispatch pastes **one card** plus "Rules common to every card"; a card that meets a name it does not give **stops** and reports. Coordinator: geldar-sheet.

## Numbers

| Item | Number | State on `a8063b0a` |
|---|---|---|
| Decision: sheet erasure covers dead lives | 0282 | merged; OD-12 confirmed by 0323; no card writes it |
| Operator rulings of 2026-11-18 | 0320 (kit-b authoritative), 0321 (combat key), 0322 (NeoForge inert), 0323 (erasure scope), 0324 (observation positions and ids), 0325 (`psyche-v1.1.0` tag approved), 0326 (no refusal hook), 0327 (no births, drift or persona refresh), 0328 (existing agents adopt all-3 first) | Accepted records, written outside these cards |
| Decision: property refusal by trait | 0283 | **not written** (0326 item 4); never marked Accepted by a card |
| Decision: lineage and child sheets | 0284 | **not written** (0327); number released |
| Decision: attribute drift policy | 0285 | **not written** (0327); number released |
| Decision: cohort export and protocol (S12-01a) | 0286 | free |
| Decision: adopting existing agents (S12-04b) | 0287 | free; cites 0328 |
| Decision: sheet rollout and rollback (S12-05) | 0288 | free |
| Decision: spare | 0289, 0329 | free |
| SQL | **0053 S9-00a** (`turn_records` erase path); 0054, 0055 stay free (0327); 0056 S12-01a; 0057 S12-04b; 0058, 0059 spare | highest used 0066; 0053 to 0059 free |

A coder never picks a number; the dispatch confirms it in `docs/analysis/phase1/packets/decision-number-registry.md` first. Each SQL card appends ` -f sql/test/<file>.sql` to the **one** `psql ... -f sql/test/check-schema.sql ... -f sql/test/check-schema-body-host.sql` command in `.github/workflows/ci.yml` (it does not add a line), serially in the order S9-00a, S9-00, S12-01a, S12-04b.

## Owner decisions

| # | Question | State |
|---|---|---|
| OD-1 | May a life's own `law` trait refuse a deliberate `mine` or `withdraw` of another life's cell? | **No** (0326). Mining stays free; decision 0164 unchanged |
| OD-2 | The refusal sentence | Approved for the revisit case only, **dormant** (0326): `you decided against taking what is someone else's` |
| OD-3 | What is starving? | Approved for the revisit case only, **dormant** (0326): hunger at or below 6 (food points out of 20) and no edible food carried |
| OD-4 | Rolls off | Approved for the revisit case only, **dormant** (0326): fail open (never refuses; D-HC-14) |
| OD-5 | Births this campaign | **No** (0327); W10 not dispatched, lineage off |
| OD-6, OD-7 | Child text approval; child id pattern | Moot (0327) |
| OD-8 | Attribute drift | **No** (0327); W11 not dispatched |
| OD-9 | Persona refresh text | **No text at all** (0327); HC-44 retired |
| OD-10 | Which sheet each existing agent adopts | All-3 first; named sheets one ranger at a time with operator approval; behind the held-live ruling (0328) |
| OD-11 | Cohort sizes, replicates, run length, spend ceiling, numeric bars; rollout after results | **Open** |
| OD-12 | Account erasure covers dead lives | **Confirmed** (0323) |

## The shared contract (names every card uses)

Merged (verified at `a8063b0a`): schemas `character-sheet`, `roll-event`, `decision-event`, `sheet-adopted-event`, `proficiency-request`, `proficiency-state`, `proficiency-level`; tables `character_sheet_adoptions`, `rolls`, `decisions`, `xp_evidence`, `proficiency`, `proficiency_outbox` and `agents.character_sheet`, `sheet_hash`, `sheet_adopted_at`; trigger function `agents_sheet_immutable()` (0050: refuses any change of the three columns once `character_sheet` is set); function `sheet_erase_life(TEXT)` (0051; deletes from `public.rolls`, `public.decisions`, `public.xp_evidence`, `public.character_sheet_adoptions`, `public.proficiency`, `public.proficiency_outbox`); function `register_account_delete(BYTEA)` (0040; calls `sheet_erase_life` for every life of the owner, dead or alive, then deletes the other per-life rows); `psyche/src/` files `alignment`, `params`, `proficiency`, `rng`, `roll`, `sheet`, `temperament`, `threat`, `types`, `version` (`psyche/package.json` 1.1.0; only tag `psyche-v1.0.0`); `golem/src/character/character-config.ts` (140 lines; `KNOWN_KEYS = ['mode','rolls','proficiency']`; `LATER_KEYS` tolerated and ignored: `idle_think_probability`, `max_heuristic_picks`, `failure_hard_cap`, `sanity_check`, `tom`, `morality_hooks`, `drift`).

New names defined by cards here:

```ts
// S10-01a contract/src/lineage.ts
export type BirthId = string;                       // ^bn_[0-9A-HJKMNP-TV-Z]{26}$
export interface LineageBirth { version: 1; birth_id: BirthId; child_life_id: string; parents: [ParentRef, ParentRef]; formula_version: 1;
  birth_source: 'operator' | 'cradle' | 'spawn' | 'replacement'; born_world_tick: number; fields: InheritedField[] /* 13 */; child_sheet: InheritedSheet /* no proficiency */ }
export interface ParentRef { life_id: string; effective_revision: number }
// S11-01 contract/src/drift.ts
export interface DriftPolicy { enabled: boolean; fields: DriftField[]; window_days: 7; min_samples: number; margin: number; per_field_cap: 1; cooldown_windows: number }
export interface EffectiveSheet { life_id: string; revision: number; sheet: CharacterSheet; baseline_hash: string }  // revision 0 = adopted baseline
// S12-04b sql/0057
// character_sheet_adoptions.source gains 'conversion'
```

**Shared files and who owns them** (one owner at a time, in this order):

| Shared file | Owners |
|---|---|
| `contract/src/index.ts` (557 lines) and generated output | no live card here (S10-01a and S11-01 are inactive, 0327) |
| `sql/0040` function `register_account_delete` (re-created) | S9-00a only (by a new migration; 0040 itself is never edited) |
| `sql/` and the `ci.yml` psql command | S9-00a, then S9-00, then S12-01a, then S12-04b |
| `tools/mcp-tokens/src/cli.ts` (545 lines), `tools/mcp-tokens/src/players.ts` | S12-04a (one `export` keyword in `players.ts`, one dispatch branch), then S12-04b |
| `pnpm-lock.yaml` and any `package.json` | S12-01b only |
| (dormant, 0327) `golem/src/character/character-config.ts`, `golem/src/adam/adam-body.ts`, `eventsink/src/main.ts`, `writer.ts`, `psyche/**` | no owner this campaign; the dormant W10 and W11 cards name them for a later campaign |
| `geldar.ps1`, `compose/*.yml`, `shards/*.yaml` | nobody; S12-05 produces a diff for the owner |

## Rules common to every card

- **R1 size.** One Haiku coder, about 50k working tokens (kit cards about 40k). Over that, split at the card's split line.
- **R2 branch and worktree.** Geldar: card branch `phase1/<id-lower>-<slug>` from the wave branch `origin/phase1/sheet-w<N>`, which the orchestrator creates from `origin/main` and pushes before the first dispatch. Kit: `scriptorium/hc-<nn>-<slug>` from `origin/scriptorium/hw0` in the sibling `geldar-scriptorium` checkout. The dispatch gives the absolute worktree path. The coder never pushes, tags, opens a PR or merges.
- **R3 worknote.** Geldar `docs/analysis/harness/worknotes/<ID>.md`; kit `docs/analysis/harness/worknotes/HC-<nn>.md` in the kit repo. Base SHA, steps done, each revert-check and the test that failed, every STOP verbatim, and "index line to add" for `sql/README.md`, `docs/decisions/README.md`, ledger and RESUME.
- **R4 commit.** The subject on the card, then the attribution lines the dispatch gives, verbatim.
- **R5 on-cap.** Commit what passes, record base SHA, passing tests and unfinished steps, leave a clean branch, stop. Never weaken a test or invent a design.
- **R6 must-not-edit baseline.** `docs/spec.md`, accepted decisions, merged migrations, released prompts, `contract/src/generated/` by hand, other cards' worknotes, `pnpm-lock.yaml` and every `package.json` unless named, any file not in may-edit, and always `animus/`. Never run `adam up`.
- **R7 GATE** (coder, no database, no shard): `git diff --check` prints nothing; `./geldar.ps1 pnpm format` then `./geldar.ps1 pnpm lint`; `./geldar.ps1 pnpm --filter <pkg> typecheck` per touched package; `./geldar.ps1 pnpm check:repo`; `git merge-tree --write-tree origin/phase1/sheet-w<N> HEAD` prints no `CONFLICT`. **GATE-C** adds `./geldar.ps1 pnpm --filter @geldar/contract generate` then `./geldar.ps1 pnpm check:generated`. **GATE-S** (ops): apply `sql/[0-9]*.sql` in order to a scratch database, run the CI psql command with the new `-f` appended (`psql -v ON_ERROR_STOP=1`), repeat on a database migrated from `origin/main` (upgrade lane), re-apply the new migration (reapply lane). Real-database sink cases: `$env:GELDAR_IT = '1'; ./geldar.ps1 pnpm test eventsink` (ops). **Kit GATE:** `./scriptorium.ps1 pnpm test <files>`, `./scriptorium.ps1 pnpm typecheck`, `./scriptorium.ps1 pnpm format`, `./scriptorium.ps1 pnpm lint`, `./scriptorium.ps1 pnpm check:repo`, and `git merge-tree --write-tree origin/scriptorium/hw0 HEAD`.
- **R8 inactive means inactive.** Every W10 and W11 card adds behaviour behind a flag whose default is false, ships no production config change, and has a test that with the flag false (or `character` omitted, or `mode: off`) behaviour and bytes equal today's. Off draws no RNG, writes no row, emits no event, adds no prompt text.
- **R9 erasure rule.** A new table with a `life_id` (or `agent_id`) column is erased with its life: a sheet-campaign table joins `sheet_erase_life` in the migration that creates it (`CREATE OR REPLACE FUNCTION` with the full list, the `sheet_append_only` guard, no grant to PUBLIC, `geldar_mcp`, `geldar_glass`, `geldar_register` beyond EXECUTE on the function, a `COMMENT ON TABLE` with export and retention text), and a `sql/test/` check asserts the delete; a life-keyed table outside the sheet joins `register_account_delete` instead (0323 consequence 3), as S9-00a does for `turn_records`. The S9-00 coverage check then passes; it fails for any life-keyed table that neither erase function deletes and that is not on its exemption list.
- **R10 honesty.** No true score, sheet, label or drift event appears in any agent-visible text, MCP output, snapshot, Glass column, prompt or kit workspace file. No card tells an agent it is observed, measured or coached. No card writes agent-visible persona text (0327).
- **R11 revert-checks.** Make the one edit, run the named test, see the named case fail, restore with `git checkout -- <path>`, rerun green, record it.
- **R12 pins.** Exact versions; Docker images by digest; GitHub Actions by SHA; new dependencies at least two weeks old.

## Dependency and status table

| Card | Repo | Depends on | Status |
|---|---|---|---|
| S9-00a `turn_records` erase path (SQL 0053) | geldar | none | **READY** |
| S9-00 erasure coverage gate (every life-keyed table) | geldar | S9-00a merged | **READY** after S9-00a |
| S9-01 refusal reason and decision key | geldar | (0326) | **Retired / not built** |
| S9-02 property-refusal hook | geldar | (0326) | **Retired / not built** |
| S9-03 bind hook behind `morality_hooks` | geldar | (0326) | **Retired / not built** |
| HC-41 reflection facts leakage test | kit | HC-32 (BlockedDecision), HC-26 | BLOCKED; travels with HC-32, not needed to close W9 |
| S9-04 W9 close, merged inactive (worknote only) | geldar | S9-00 merged | READY after S9-00 (its old hook-evidence lanes are retired by 0326) |
| S10-01a, S10-01b, S10-02, HC-42, S10-03, HC-43, S10-04 | geldar, kit | (0327) | **Inactive (0327), not dispatched**; dormant design below |
| S11-01 to S11-06 | geldar | (0327) | **Inactive (0327), not dispatched**; dormant design below |
| HC-44 persona refresh artifact | kit | (0327, OD-9) | **Retired** |
| S12-01a exporter role (SQL 0056, decision 0286) | geldar | AN-04b (merged); OD-11 for the export scope | BLOCKED (OD-11) |
| S12-01b cohort exporter package | geldar | S12-01a | BLOCKED (S12-01a) |
| S12-02 cohort metrics core | geldar | S12-01; kit HC-37b names | BLOCKED |
| S12-03 control equivalence proof | geldar | AN-12 (merged) | **READY** |
| S12-04a adoption planner and dry run | geldar | AN-05 (merged) | **READY** |
| S12-04b apply (all-3 only), SQL 0057, decision 0287 | geldar | S12-04a | code READY after S12-04a; any apply on a live agent held (0328, held-live ruling) |
| HC-45 per-player sheet switch | kit | HC-19 (kit-b), HC-26 | BLOCKED (HC-19 names the settings file) |
| S12-05 staged enable and rollback runbook | geldar | S12-03, S12-04b, HC-45 | BLOCKED (HC-45, OD-11) |
| S12-06 run protocol and run evidence | geldar and kit | S12-02, S12-03, HC-37b, HC-38 | BLOCKED (OD-11) |
| S12-07 campaign review and close | geldar | S12-06 | BLOCKED |

---

# Wave W9: erasure gate (refusal hook not built; closes merged inactive)

## S9-00a: `turn_records` joins the account-deletion path (SQL 0053)

- **id** S9-00a **wave** W9 **repo** geldar **status** READY **depends-on** none **size** 30k. **branch** `phase1/s9-00a-turn-records-erase`.
- **why.** Decision 0323 item 2: `turn_records` (0060) is life-keyed and neither erase function deletes it; it is fixed in its own migration, and S9-00 does not pass until this merges. The turn-record campaign owns the table (its GX-05c planned this path): write "handoff: `turn_records` erase path added by 0053 (S9-00a)" in the worknote for its orchestrator.
- **may-edit** `sql/0053_turn_records_erase.sql` (new); `sql/test/check-schema-account-delete.sql` (APPEND one new `DO $tr_erase$ ... $tr_erase$;` block at the end of the file; change no existing line; the file is already named in `.github/workflows/ci.yml`, so no workflow file is touched); `tools/migrate/src/migrate.test.ts` (add exactly one line, `'0053_turn_records_erase.sql',`, in sorted position in the exact migration list; the test asserts every file in `sql/`); the worknote.
- **must-not-edit** R6; every file under `.github/` (no workflow file, ruling of 2026-11-18: the token has no workflow scope); `sql/0040_account_deletion_all_lives.sql` and `sql/0060_turn_records.sql` (merged); every other test file except the two named above; no new `sql/test/check-schema-*.sql` file (the CI wiring test would then require a ci.yml line).
- **Step 1.** Create `sql/0053_turn_records_erase.sql`: a header comment (`-- Migration 0053 (S9-00a, decision 0323): register_account_delete also erases turn_records rows of every life of the owner, dead or alive. The function is re-created from 0040 with one added line; nothing else changes.`), then copy **verbatim** the whole `CREATE OR REPLACE FUNCTION register_account_delete(p_identity_hash BYTEA)` statement from `sql/0040_account_deletion_all_lives.sql` (from the `CREATE OR REPLACE FUNCTION` line through `$acct_delete$;`), and in the copy insert, directly after the line `  DELETE FROM public.skill_runs WHERE life_id = ANY (lives);`, the line `  DELETE FROM public.turn_records WHERE life_id = ANY (lives);`. Then copy the two lines `REVOKE ALL ON FUNCTION register_account_delete(BYTEA) FROM PUBLIC;` and `GRANT EXECUTE ON FUNCTION register_account_delete(BYTEA) TO geldar_register;`, and end with `INSERT INTO schema_migrations (version) VALUES ('0053') ON CONFLICT DO NOTHING;`. Check with `git diff --no-index` of the two function texts (extract both to scratch files) that the only difference is the one added line; record that in the worknote.
- **Step 2.** Append to the END of `sql/test/check-schema-account-delete.sql` one new `DO $tr_erase$ ... $tr_erase$;` block (keep the file under 500 lines; it is 420 now): build two owners and their lives by copying the owner fixture inserts of `sql/test/check-schema-account-delete.sql` (the `mcp_owners`, `mcp_identities` and `agents` rows of owners a and b), with new ids: owner `trerase-a` with lives `ag_trerasea_01` (alive) and `ag_trerasea_02` (`died_at` set), owner `trerase-b` with `ag_treraseb_01`, and new identity hashes (`sha256('trerase-a')`, `sha256('trerase-b')`). Insert one `turn_records` row per life with this exact insert, repeated per life with `<n>` = 1, 2, 3 and `<life>` the life id: `INSERT INTO turn_records (turn_id, life_id, harness, model, template_version, wake_reason, world_day, world_tick, model_input, raw_output, tokens_in, tokens_out, usage_source, latency_ms, context_tokens, context_window) VALUES ('tn_' || lpad('<n>', 26, '0'), '<life>', 'test', 'm', repeat('a', 64), 'wake', 0, 0, 'in', 'out', 0, 0, 'estimated', 0, 0, 1);` (the columns and checks are in `sql/0060_turn_records.sql`; `check-schema-turn-records.sql` is a privilege check and has no insert to copy). Call `PERFORM register_account_delete(<hash of trerase-a>)`. Raise unless `ag_trerasea_01` and `ag_trerasea_02` have no `turn_records` row and `ag_treraseb_01` still has one. The `register_audit` row the call writes stays (that table refuses DELETE; this file runs once on a fresh database, as CI does).
- **tests** the appended block (ops runs it with the existing file); every existing assertion in `sql/test/check-schema-account-delete.sql` still passes unchanged.
- **checks** R7 GATE; GATE-S (ops: fresh, upgrade and reapply lanes).
- **revert-checks** (ops, scratch database) delete the added `turn_records` line from 0053 and re-apply it: the appended block in `check-schema-account-delete.sql` raises. Run the S9-00 coverage file without 0053 applied: it raises naming `turn_records`.
- **exit criteria** ops reports the three GATE-S lanes green and both revert-checks failing; the one-line function diff is recorded.
- **worknote** `S9-00a.md` with index lines for `sql/README.md` (0053) and the handoff line. **commit** `feat(sheet): erase turn_records with every life of a deleted account (0053)`. **split line** none.

## S9-00: erasure coverage gate for every life-keyed table

- **id** S9-00 **wave** W9 **repo** geldar **status** READY after S9-00a merges **depends-on** S9-00a **size** 25k. **branch** `phase1/s9-00-erase-gate`.
- **why.** Ruling 4 (decision 0323): every table keyed by a life is erased with its life, and a check fails when a new one is not. Two functions erase a life today, and the check reads both: `sheet_erase_life(TEXT)` (0051, the six sheet tables) and `register_account_delete(BYTEA)` (0040, everything else per life; it calls `sheet_erase_life` for every life of the owner, dead or alive, so ruling 11 needs no SQL change). The function bodies write table names with the `public.` prefix (`DELETE FROM public.rolls WHERE ...`), so the match must accept the prefix.
- **The life-keyed tables on `a8063b0a`** (every base table in schema `public` with a column `life_id` or `agent_id`; enumerated from `sql/0001` to `sql/0066`):

| Table | Key column(s) | Erased by | Migration |
|---|---|---|---|
| `rolls`, `decisions`, `character_sheet_adoptions` | `life_id` | `sheet_erase_life` | 0051 |
| `xp_evidence`, `proficiency`, `proficiency_outbox` | `life_id` | `sheet_erase_life` | 0050 |
| `mcp_players` | `life_id` | `register_account_delete` (`WHERE owner_id = who`) | 0002 |
| `mcp_budget`, `mcp_journal` | `life_id` | `register_account_delete` | 0002 |
| `mcp_sleep_marks` | `life_id` | `register_account_delete` | 0003 |
| `mcp_life_deaths`, `mcp_death_events` | `life_id` | `register_account_delete` | 0023 |
| `thoughts`, `intents`, `actions`, `receipts`, `suppressed_wakeups`, `skill_runs` | `life_id` | `register_account_delete` | 0001 |
| `memories`, `goals`, `skill_library`, `ledger`, `votes` | `agent_id` | `register_account_delete` | 0001 |
| `relationships` | `agent_id`, `other_id` | `register_account_delete` | 0001 |
| `events` | `agent_id` (and `thinker_id`) | `register_account_delete` | 0001 |
| `agents` | `agent_id` (the life row itself) | **exempt**: retired in place by `register_account_delete` (`UPDATE ... SET died_at, death_cause = 'owner-erased'`, owner link removed); the row stays as world history | 0001 |
| `kino_audit` | `agent_id` (the viewed life; the viewer is `login_hash`) | **exempt, reported**: erased by the viewer's `login_hash`, not by the viewed life; whether the viewed life's rows go is unruled (index line to add: open question for the owner) | 0015 |
| `turn_records` | `life_id` | `register_account_delete` **after S9-00a** (0053); on `a8063b0a` neither function deletes it (decision 0323 item 2: a real gap, not an exemption) | 0060 |

  Twenty-eight tables: 26 covered once S9-00a has merged, 1 exempt by design (`agents`), 1 exempt and reported (`kino_audit`). Temporary tables of other check files live in `pg_temp`, not `public`; the one persistent fixture table (`check_account_delete_capture`) has no key column and is excluded by the `check\_%` rule anyway. The exemption list lives in the check file, each entry with its reason; adding a table to it is a reviewed change.
- **may-edit** `sql/test/check-schema-erase-coverage.sql` (new); `.github/workflows/ci.yml` (append ` -f sql/test/check-schema-erase-coverage.sql` to the end of the one psql command that ends with `-f sql/test/check-schema-body-host.sql`); the worknote.
- **must-not-edit** R6; every `sql/0*.sql` (no migration); `threshold/register/**`; `docs/decisions/0282-*`, `0323-*`.
- **decisions** none written. Cites 0323 (scope), 0282, 0262, 0171.
- **Step 0.** `Test-Path sql/0053_turn_records_erase.sql` prints `True`; otherwise STOP `blocked: S9-00a`.
- **Step 1.** Create `sql/test/check-schema-erase-coverage.sql`. First line comment: `-- S9-00 (decision 0323): every life-keyed public table is erased by sheet_erase_life or register_account_delete, or is on the exemption list below. Run after the migrations and the other check files.` Then one `DO $erase_cov$ ... $erase_cov$;` block that:
  1. builds `missing TEXT[]` from:
     ```sql
     WITH keyed AS (
       SELECT DISTINCT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public' AND c.column_name IN ('life_id', 'agent_id')
         AND c.table_name NOT LIKE 'check\_%' ESCAPE '\'
     ), bodies AS (
       SELECT string_agg(pg_get_functiondef(p.oid), E'\n') AS body
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN ('sheet_erase_life', 'register_account_delete')
     ), exempt(table_name) AS (
       VALUES ('agents'), ('kino_audit')
     )
     SELECT array_agg(k.table_name ORDER BY k.table_name)
     FROM keyed k, bodies b
     WHERE k.table_name NOT IN (SELECT table_name FROM exempt)
       AND b.body !~* ('DELETE\s+FROM\s+(public\.)?' || k.table_name || '\M')
     ```
  2. raises `RAISE EXCEPTION 'erase coverage: no erase path for %', missing` when `missing` is not null;
  3. raises when the `bodies` row is null or does not contain both function names (`'erase coverage: an erase function is missing'`);
  4. **probe** inside a sub-block: `CREATE TABLE public.erase_gate_probe (life_id TEXT);`, re-run the same query, raise `'erase coverage: the probe was not reported'` unless the result contains `erase_gate_probe`, then `DROP TABLE public.erase_gate_probe;` (a `BEGIN ... EXCEPTION WHEN ... END` is not needed; the block raises on failure and CI stops);
  5. **prefix probe**: assert that the pattern built for `rolls` matches the text `DELETE FROM public.rolls WHERE` and the text `DELETE FROM rolls WHERE`, and does not match `DELETE FROM public.rolls_archive WHERE` (raise otherwise).
- **Step 2.** A second `DO` block (behaviour, OD-12 confirmed by 0323): insert an `agents` row for `ag_erasecov_01` (copy the column list and values of the `INSERT INTO agents` at `sql/test/check-schema-character-sheet.sql` line 20, changing only the id and adding `died_at = now()`), then `INSERT INTO proficiency (life_id, domain, xp, level) VALUES ('ag_erasecov_01', 'mining', 5, 0)`; `PERFORM sheet_erase_life('ag_erasecov_01')`; raise unless that life has no `proficiency` row. Leave the `agents` row (other check files leave fixtures too; this file runs last).
- **tests** (all inside the SQL file, run by ops under GATE-S): the real catalog reports nothing missing; the probe is reported; the prefix probe; the dead-life erase.
- **checks** R7 GATE (the file is SQL only: `git diff --check`, `./geldar.ps1 pnpm check:repo`, merge-tree); GATE-S (ops).
- **revert-checks** (ops, scratch database, never merged): (1) remove `('kino_audit'), ` from the exemption list: the check raises naming `kino_audit` (proves the list is live). (2) change `'(public\.)?'` to `''`: the check raises naming every covered table (proves the prefix matters). (3) replace the `WHERE k.table_name NOT IN ...` condition with `WHERE false`: the probe raise fires. (4) in a scratch copy of `sql/0053_turn_records_erase.sql`, delete the line `DELETE FROM public.skill_runs WHERE life_id = ANY (lives);` and re-apply it: the check raises naming `skill_runs`. (5) run the file on a database without 0053: the check raises naming `turn_records`.
- **exit criteria** ops reports the CI psql command green with the new file and the five revert-checks failing as stated; if ops reports any other table name as missing, STOP: the orchestrator rules (new exemption with reason, or a migration card).
- **worknote** `S9-00.md` with: the table list above as found; index lines "`sql/README.md`: check-schema-erase-coverage.sql" and "owner question: `kino_audit` rows of an erased viewed life". **commit** `test(sheet): every life-keyed table is erased with its life (erase coverage gate)`. **split line** none.

## S9-01: refusal reason code and decision key: Retired / not built

- **status** Retired, not built. **reason** OD-1 answered no (decision 0326): mining and withdrawing stay free; there is no refusal, so there is no `declined` reason, no key and no decision record. Decision 0283 is not written (0326 item 4); revisiting OD-1 needs a new record that amends 0164 explicitly, and no card marks 0283 Accepted.
- **dormant text (OD-2 approved by 0326 only for the revisit case, unused):** the only agent-visible string would have been `REASON_PHRASE.declined = "you decided against taking what is someone else's"`, rendered as `Your mine failed: you decided against taking what is someone else's.`; key `prop:<life>:<verb>:<x>,<y>,<z>:d<day>` with `day = floor(worldTick / 24000)`. Resolved file names, for a future card: `FAIL_REASONS` in `golem/src/actions/outcome.ts`, `OUTCOME_REASON_LABELS` in `golem/src/metrics.ts`, `threshold/mcp/src/events/handlers/intent.ts`.

## S9-02: property-refusal hook: Retired / not built

- **status** Retired, not built (would have been split S9-02a/b). **reason** OD-1 no (0326). `golem/src/actions/mine.ts` and `container.ts` are not touched by this campaign.
- **dormant text (OD-3 and OD-4 approved by 0326 only for the revisit case, unused):** starving = hunger at or below 6 and no edible food carried; with `rolls: false` the hook fails open and never refuses (D-HC-14); unknown ownership is never refused; law has no psyche `Domain`, so a future card would need a ruling on the `prof` argument (proposal was `prof = 0`).

## S9-03: bind the hook behind `morality_hooks`: Retired / not built

- **status** Retired, not built. **reason** OD-1 no (0326). `morality_hooks` stays in `LATER_KEYS` (tolerated and ignored); no fixture shard file is added.

## HC-41: reflection facts never carry hidden truth (kit)

- **id** HC-41 (proposed) **repo** kit **status** BLOCKED: HC-32 (estimates reach the reflect skill as facts) is BlockedDecision and its package is not named. **Not needed to close W9**: it moves with HC-32 and is dispatched with it. **size** 30k. **branch** `scriptorium/hc-41-reflection-leakage`.
- **may-edit (when unblocked)** a new test module in the package HC-32 names in its worknote, and its fixtures; nothing else.
- **shape (test only).** For a fixture life whose true sheet is extreme (law 1, good 1) and whose estimates are all-3 priors, the rendered reflect facts (a) contain no digit used as a score, no field name (`law`, `good`, `aggression`, `curiosity`, `common_sense`, `cleverness`), no "estimate"; (b) are identical when the true sheet changes and the evidence does not; (c) mark an unobserved field as unknown; (d) the supervisor's child environment has no variable carrying the sheet.
- **revert-checks** add the true sheet to the facts builder: (a) and (b) fail. Render a prior as observed: (c) fails. **commit** `test(reflect): estimates and facts never carry a true sheet`.

## S9-04: W9 close, merged inactive (worknote only)

- **id** S9-04 **repo** geldar **status** READY after S9-00 merges **depends-on** S9-00a, S9-00 **size** 15k (worknote) plus one ops check.
- **scope.** Decision 0326 item 2 retires the old S9-04 (the hook-evidence close: refused mines, starving exception, control runs); none of those lanes runs. What remains is the inactive close the operator asked for: a record that W9 is closed, with nothing of the hook in the code.
- **deliver.** Ops: the CI psql command green on the wave branch; `./geldar.ps1 check`. Worknote `docs/analysis/harness/worknotes/S9-04.md` states: W9 closed **merged inactive**; S9-00a and S9-00 merged (commit SHAs); S9-01, S9-02, S9-03 retired and not built (0326, mining stays free); OD-2 to OD-4 recorded dormant in those cards; HC-41 moved to travel with HC-32; the reported table `kino_audit` handed to the owner. Index lines for ledger and RESUME. No bench and no live run are needed: nothing in W9 changes Body behaviour.
- **commit** `docs(sheet): W9 closed merged inactive (refusal hook not built)`.

---

# Wave W10: inherited sheets (dormant: no births this campaign, decision 0327)

**Every W10 card is "Inactive (0327), not dispatched".** Decision 0327: no births between lives in this campaign; W10 closes merged inactive with no W10 card dispatched; lineage stays off; decisions 0284 and SQL 0054 are released and stay free. The cards below are kept as a corrected design for a later campaign only; where they say "0284" or "0054", a later dispatch takes fresh numbers from the registry. If anything is ever written for W10, it merges inactive and default off. The general birth lifecycle belongs to the C4 campaign; S10-03 would in any case wait for C4 on `origin/main`. W10's close needs no card: the ledger already marks it.

## S10-01a: lineage contract

- **id** S10-01a **repo** geldar **status** Inactive (0327), not dispatched **replaces** AN-54a **size** 40k. **branch** `phase1/s10-01a-lineage-contract`.
- **may-edit** `contract/schemas/lineage-birth.schema.json` (new); `contract/src/lineage.ts` (new, types and validator); `contract/src/index.ts` (named export lines only); `contract/src/generated/**` by GATE-C; `contract/test/lineage-birth.test.ts` (new); a lineage decision record (number assigned in the registry at that later dispatch; 0284 is released by 0327); the worknote.
- **must-not-edit** R6; `contract/schemas/common.schema.json` (`LifeId` stays `ag_`), `character-sheet.schema.json`, `contract/src/subjects.ts`.
- **shape.** `child_sheet` has `attributes` (4), `alignment` (2) and `op_modes` (7), no `proficiency`, `additionalProperties: false` at every level, written out in full; `fields` exactly 13 entries `{field, parent_a, parent_b, mean_rounded, u, mutation, child}` (`u` in [0,1), `mutation` in -1, 0, 1); `parents` exactly two `{life_id, effective_revision}`; `birth_id` `^bn_[0-9A-HJKMNP-TV-Z]{26}$`; `child_life_id` a common `LifeId` (`lf_` rejected, test so named).
- **tests** valid example parses; rejects missing `birth_id`, lowercase in `bn_`, one parent, three parents, score 0 and 6, mutation 2, `formula_version` 2, unknown key, 12 fields, `child_sheet` with `proficiency`, `lf_abc` child.
- **checks** GATE-C; `./geldar.ps1 pnpm test contract/test/lineage-birth`. **revert-checks** remove `additionalProperties: false` from the child sheet: "child sheet rejects proficiency" fails. Allow three parents: "rejects three parents" fails.
- **exit criteria** GATE-C clean; test passes; two revert-checks recorded. **worknote** `S10-01a.md`. **commit** `feat(sheet): lineage birth contract (two parents, 13 recorded fields, no proficiency)`.

## S10-01b: lineage SQL (0054)

- **id** S10-01b **repo** geldar **status** Inactive (0327), not dispatched (would follow S10-01a and S9-00) **replaces** AN-54b **size** 45k. **branch** `phase1/s10-01b-lineage-sql`.
- **may-edit** `sql/0054_lineage.sql` (new); `sql/test/check-schema-lineage.sql` (new); `.github/workflows/ci.yml` (append ` -f sql/test/check-schema-lineage.sql` to the one psql command); the worknote.
- **must-not-edit** R6; `sql/0050` to `sql/0052`, `sql/0040`.
- **shape.** Two tables (exactly as below), both keyed by a life, both added to `sheet_erase_life` (R9; the function is re-created with the eight-table list, keeping 0051's `SET search_path`, `lock_timeout`, `set_config('geldar.erase_life', ...)` and the NULL refusal exactly):
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
  CREATE TABLE IF NOT EXISTS lineage_parents (
    birth_id TEXT NOT NULL REFERENCES lineage_births (birth_id),
    slot SMALLINT NOT NULL CHECK (slot IN (1, 2)),
    parent_life_id TEXT NOT NULL REFERENCES agents (agent_id),
    effective_revision INT NOT NULL CHECK (effective_revision >= 0),
    PRIMARY KEY (birth_id, slot));
  ```
  A trigger refuses a birth whose two parents are the same life. Erasure (OD-12 confirmed): `sheet_erase_life(x)` deletes `lineage_parents` rows where `parent_life_id = x` or whose birth's `child_life_id = x`, then `lineage_births` where `child_life_id = x`; a surviving child loses the edge to an erased parent. The `lineage_*` tables join the `sheet_append_only` guard. Note: the column is `child_life_id`/`parent_life_id`, not `life_id`, so the S9-00 coverage check does not see these tables; `check-schema-lineage.sql` asserts both deletes itself.
- **tests** (GATE-S, ops): valid birth; duplicate birth id; duplicate child; same parent twice; erase of a child deletes the birth and edges; erase of a parent keeps the child's birth but deletes the edge; role denial for `geldar_mcp`, `geldar_glass`; the S9-00 coverage check still passes.
- **revert-checks** remove `child_life_id UNIQUE`: "second birth for one child refused" fails. Leave `lineage_parents` out of the function: "erase deletes the edge" fails.
- **exit criteria** ops reports GATE-S green (three lanes) and both revert-checks failing. **worknote** `S10-01b.md`. **commit** `feat(sheet): lineage tables and their erase path (0054)`. **split line** `lineage_births` first, `lineage_parents` second.

## S10-02: pure inherited-sheet factory (psyche)

- **id** S10-02 **repo** geldar (`psyche/`) **status** Inactive (0327), not dispatched; no psyche release after 1.1.0 is planned. If revived: the tag `psyche-v1.1.0` (approved by 0325, pushed by ops) must exist first, or the release tool records two versions at once. **replaces** AN-42 **size** 40k. **branch** `phase1/s10-02-inherit`. Pure and inactive: nothing calls it.
- **Step 0.** `git tag --list psyche-v1.1.0` prints `psyche-v1.1.0`; otherwise STOP `blocked: psyche-v1.1.0 tag`.
- **may-edit** `psyche/src/inherit.ts` (new); `psyche/src/index.ts` (named exports, one per line); `psyche/package.json` (`1.1.0` to `1.2.0`); `psyche/RELEASE.json` (by `node tools/psyche-release/src/cli.ts --write`); `psyche/test/inherit.test.ts` (new); the worknote. `ENGINE_VERSION` stays 1 (a function is added; seed and roll rules are unchanged). Zero imports outside the package.
- **shape.**
  ```ts
  export interface InheritInput { birthId: string; parentA: CharacterSheet; parentB: CharacterSheet }   // effective sheets snapshotted at the request
  export interface InheritedField { field: string; parent_a: number; parent_b: number; mean_rounded: number; u: number; mutation: -1 | 0 | 1; child: number }
  export function inheritSheet(i: InheritInput): { sheet: CharacterSheet; fields: InheritedField[] };  // 13 fields, deterministic in (birthId, parents)
  ```
  The earlier `seed` input is dropped (planner ruling, record in the worknote): `birthId` is unique per birth, so the draw key needs nothing else. Per field (order: the four attributes, `law`, `good`, the seven op modes, as in `CharacterSheet`): `mean_rounded = Math.floor((a + b) / 2 + 0.5)`; `u = rngFor({ producer: 'body', lifeId: birthId, generation: 0, tick: 0, fx: 'inherit_' + field, decisionSeq: 0 }).next()`; mutation -1 if `u < 0.2`, +1 if `u >= 0.8`, else 0; `child = Math.min(5, Math.max(1, mean_rounded + mutation))`.
- **tests** boundaries with an injected draw (0.19999, 0.2, 0.79999, 0.8): make `u` injectable through a second, internal function `inheritWith(i, draw: (field: string) => number)` exported only to the test file; rounding 2.5 to 3 and 3.5 to 4; clamp at 1 and 5; same input same output; different `birthId` different draws; all 13 fields recorded.
- **checks** R7 GATE; `./geldar.ps1 pnpm test psyche/test/inherit`; `node tools/psyche-release/src/cli.ts --check`. After merge ops tags `psyche-v1.2.0` (owner approval).
- **revert-checks** change `0.2` to `0.25`: the boundary test fails. Round half down: the 2.5 case fails. Remove the clamp: the extremes fail.
- **worknote** `S10-02.md`. **commit** `feat(sheet): pure inherited-sheet factory in psyche`.

## HC-42: re-mirror psyche with the factory (kit)

- **id** HC-42 (proposed) **repo** kit **status** Inactive (0327), not dispatched (would need S10-02 tagged and the kit 1.1.0 re-mirror, G13, first). **size** 20k. **branch** `scriptorium/hc-42-remirror-inherit`.
- **may-edit** `packages/psyche/engine/**` (byte copy of `psyche/src/` at the tag), `packages/psyche/MIRROR.json` (tag and tree hash from `psyche/RELEASE.json`); nothing else. The kit's `packages/psyche/src/index.ts` is not touched (the kit does not call `inheritSheet`).
- **checks** `./scriptorium.ps1 pnpm test packages/psyche/src/mirror.test.ts`. **revert-checks** edit one byte in the mirror: the mirror test fails. **commit** `chore(psyche): re-mirror psyche v1.2.0 with the inheritance factory`.

## S10-03: birth transaction and adapters

- **id** S10-03 **repo** geldar **status** Inactive (0327), not dispatched; also BlockedDependency (C4 birth lifecycle not on `origin/main`; S10-01b, S10-02). Would ship `lineage` off. **replaces** AN-55a/b **size** 50k. **branch** `phase1/s10-03-birth-adapter`.
- **may-edit (when unblocked)** `eventsink/src/lineage/birth.ts` (new: one transaction), `birth.test.ts`; `golem/src/character/character-config.ts` (`lineage: boolean`, default false; today `lineage` is neither known nor tolerated, so add it to `KNOWN_KEYS`); the operator verb placed where C4's own birth CLI lives (the orchestrator names the file when C4 lands); the worknote.
- **shape.** One SQL transaction: two living, distinct, eligible parents; each parent's baseline sheet (drift is off); `inheritSheet`; the child's `agents.character_sheet` through the adoption path (source `birth`, result `adopted`), one `lineage_births` row, two `lineage_parents` rows and the audit events, all or nothing. A retry with the same `birth_id` returns the committed row and draws nothing. No proficiency row. `lineage: off` refuses with a clear code and writes nothing.
- **tests** duplicate birth id; crash before commit leaves nothing; retry after commit returns the same child; dead, missing or same parent refused; `lineage: off` writes nothing; no parent state mutated; child XP zero.
- **revert-checks** ignore the flag: "lineage off writes nothing" fails. Write a proficiency row: "child XP zero" fails. **commit** `feat(sheet): birth transaction for inherited sheets (lineage off by default)`. **split line** transaction first, CLI second.

## HC-43: child text approval gate (kit)

- **id** HC-43 (proposed) **repo** kit **status** Inactive (0327), not dispatched (would also need HC-34b, HC-35b, which 0327 does not dispatch either). OD-6 is moot; the gate design stands as written (gate on by default, nothing created before approval), so if births are ever revisited it is already safe. **size** 35k. **branch** `scriptorium/hc-43-child-text-gate`.
- **may-edit (when unblocked)** the `geldar-play` creation path HC-34c touches (`new --parents`) and its tests; a new `pending/` module; one launcher help line (launcher owner's go first).
- **shape.** Gate on (default): `new --parents` writes the synthesized text to `<persona-dir>.pending/` and exits without creating the player; `geldar-play approve <pending-dir>` creates the player exactly once; a second approve is a no-op; reject deletes the pending directory. The text is never shown to a model before approval.
- **revert-checks** create before approval: "no creation before approval" fails. Second approve creates: "approve is idempotent" fails. **commit** `feat(play): child identity text waits for owner approval`.

## S10-04: W10 close and the ancestry query

- **id** S10-04 **repo** geldar **status** Inactive (0327), not dispatched (the ancestry query has nothing to read without S10-01b) **size** 30k.
- **code part.** `tools/mcp-tokens/src/lineage-query.ts` (new) and `lineage-query.test.ts` (new): `export async function lineageOf(sql: Sql, lifeId: string): Promise<string[]>` returns printable lines (parents and their revisions, the 13 recorded fields, mutation draws) read from `lineage_births` and `lineage_parents` only; it never selects `agents.owner`. `tools/mcp-tokens/src/cli.ts`: one import line and one dispatch branch `} else if (command === 'player' && rest[0] === 'lineage') { return await runLineage(...); }` placed before the existing `command === 'player'` branch, with a `runLineage` wrapper of at most 12 lines in the style of `runPlayerFlags` (cli.ts line 369). `cli.ts` must stay under 600 lines; if it would not, STOP. Tests (fake `Sql`): unknown life; a life with no parents; an erased parent edge; a spy asserts no statement mentions `owner`.
- **checks** R7 GATE; `./geldar.ps1 pnpm test tools/mcp-tokens/src/lineage-query`. **revert-checks** add `a.owner` to the select: the "no owner" test fails.
- **close.** Not a card in this campaign: W10 is closed merged inactive by 0327 and the ledger.
- **worknote** `S10-04.md`. **commit** `feat(sheet): read-only ancestry query for the operator`.

---

# Wave W11: attribute drift (dormant: no drift this campaign, decision 0327)

**Every W11 card is "Inactive (0327), not dispatched".** Decision 0327: no attribute drift (a life's effective sheet stays its adopted baseline) and no persona refresh text; decision 0285 and SQL 0055 are released and stay free. The cards below are kept as a corrected design for a later campaign only (fresh numbers from the registry then). S11-03 could not be written in any case: no evidence rule exists, and a coder may not invent one. Nothing in W11 writes agent-visible text, and HC-44 is retired.

## S11-01: drift contract and policy config

- **id** S11-01 **repo** geldar **status** Inactive (0327), not dispatched **replaces** AN-58a **size** 40k. **branch** `phase1/s11-01-drift-contract`.
- **may-edit** `contract/schemas/drift-policy.schema.json`, `effective-sheet.schema.json`, `drift-evaluation.schema.json` (new); `contract/src/drift.ts` (new); `contract/src/index.ts` (named export lines only); `contract/src/generated/**`; `contract/test/drift.test.ts` (new); `golem/src/character/character-config.ts` and its test (move `drift` from `LATER_KEYS` to `KNOWN_KEYS`; parse `drift: { enabled: false }` and the policy fields; default off; `enabled: true` without every number is refused); a drift decision record (number assigned in the registry at that later dispatch; 0285 is released by 0327); the worknote.
- **shape.** `DriftPolicy` as in the shared contract: `enabled` default false; `fields` a subset of the four attributes and `law`, `good` (an op-mode or unknown field is rejected); `window_days` fixed 7; `min_samples` integer >= 1; `margin` in (0, 1]; `per_field_cap` fixed 1; `cooldown_windows` integer >= 1. `EffectiveSheet.sheet` is a `CharacterSheet` (there is no `InnerSheet`). `DriftEvaluation = { life_id, window_start_tick, window_end_tick, field, observed, expected, samples, decision: 'up'|'down'|'none'|'ineligible', reason }`.
- **tests** valid and invalid policies; `enabled: true` without numbers rejected; op-mode field rejected; 168000-tick window; a config without `drift` loads unchanged with `enabled: false`; the existing `character-config` tests pass unchanged except the `drift` tolerated-key log line (update that one expectation).
- **checks** GATE-C; `./geldar.ps1 pnpm test contract/test/drift golem/src/character/character-config`. **revert-checks** default `enabled` true: "default is off" fails. Accept `op_modes.*`: "op modes are not eligible" fails.
- **worknote** `S11-01.md`. **commit** `feat(sheet): drift policy and effective-sheet contract (default off)`. **split line** schemas first, config parse second.

## S11-02: drift SQL (0055)

- **id** S11-02 **repo** geldar **status** Inactive (0327), not dispatched **replaces** AN-58b **size** 40k. **branch** `phase1/s11-02-drift-sql`.
- **may-edit** `sql/0055_drift.sql` (new); `sql/test/check-schema-drift.sql` (new); `ci.yml` (append ` -f sql/test/check-schema-drift.sql`); the worknote.
- **shape.** Two tables keyed by `life_id`, both added to `sheet_erase_life` (R9; re-created with the ten-table list; the S9-00 coverage check then sees and accepts them):
  ```sql
  CREATE TABLE IF NOT EXISTS sheet_revisions (
    life_id TEXT NOT NULL REFERENCES agents (agent_id), revision INT NOT NULL CHECK (revision >= 0),
    sheet JSONB NOT NULL, sheet_hash TEXT NOT NULL CHECK (sheet_hash ~ '^[0-9a-f]{64}$'),
    evaluation_key TEXT NOT NULL, applied_at_tick BIGINT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (life_id, revision), UNIQUE (life_id, evaluation_key));
  CREATE TABLE IF NOT EXISTS drift_evaluations (
    evaluation_key TEXT PRIMARY KEY,
    life_id TEXT NOT NULL REFERENCES agents (agent_id), field TEXT NOT NULL,
    window_start_tick BIGINT NOT NULL, window_end_tick BIGINT NOT NULL, samples INT NOT NULL,
    observed NUMERIC, expected NUMERIC, decision TEXT NOT NULL CHECK (decision IN ('up','down','none','ineligible')),
    reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (window_end_tick - window_start_tick = 168000));
  ```
  Append-only guard as the 0051 tables. **Add no trigger on `agents`**: `agents_sheet_immutable()` (0050) already refuses a baseline change. `effective_sheet(p_life TEXT)` returns the highest revision's sheet, or the baseline.
- **tests** (GATE-S) duplicate evaluation key; revision gap refused; window length; baseline update still refused (by the 0050 trigger); erase removes both tables' rows; roles denied; the S9-00 coverage check passes.
- **revert-checks** drop `UNIQUE (life_id, evaluation_key)`: "same-window duplicate refused" fails. Leave `sheet_revisions` out of the function: "erase removes revisions" fails and the S9-00 coverage check raises naming `sheet_revisions`.
- **worknote** `S11-02.md`. **commit** `feat(sheet): drift evaluation and revision tables (0055)`. **split line** `drift_evaluations` first.

## S11-03, S11-04, S11-05: evaluation, transition, Body reload

- **status** Inactive (0327), not dispatched. **reason** OD-8 no (0327); and there is no per-field evidence and direction rule in any record, and a coder may not invent one. Their earlier text (AN-59a/b, AN-43, AN-60a/b) stays the design if drift is revisited, with these corrections already applied: S11-05 owns `adam-body.ts` alone (S9-02 is not built, so only the threat policy reads the cache); S11-04's push subject is decided with geldar-3b first; new Body tests go in `golem/src/adam/adam-body-drift.test.ts`.

## HC-44: persona refresh artifact: Retired

- **status** Retired. **reason** OD-9 (0327 item 4): no persona refresh text at all; the kit's HC-36a and HC-36b are not built either. No card writes, generates or exports persona text derived from a sheet or a drift; HC-36b's export is not replaced.

## S11-06: W11 close

- **status** Inactive (0327), not dispatched. W11 is closed merged inactive by 0327 and the ledger; no card is needed.

---

# Wave W12: measurement and rollout

## Control-cohort design (the rule every W12 card serves)

- **The control rule.** `character` omitted or `mode: off` is today's bot. An **all-3 sheet with `rolls: false` equals today's bot** in every Body decision the sheet touches (floor 6, fight limit 30 s at all-3: `fightFloor(3) = 6`, `fightLimitMs(3) = 30000` in `psyche/src/threat.ts`; no refusal exists; no drift exists). S12-03 proves it by test.
- **Treatments.** A off; B all-3, `rolls: false`; C all-3, `rolls: true`; D varied sheets, `rolls: true`. Harness and model are stamped dimensions (GX-01). Morality, lineage and drift are not run (0326, 0327): the protocol has no inheritance or drift arm.
- **Cohorts.** Fresh lives per treatment, an immutable world clone per run, distinct run and life ids, fresh RNG streams. Sizes, replicates, length and spend ceiling live in `protocol.json` (OD-11, open). A missing run is incomplete, not a pass. Each export names the shard database it reads (decision 0380: one database per shard).

## S12-01: exporter role and world exporter (SQL 0056)

- **id** S12-01 **repo** geldar **status** BLOCKED: OD-11 sets what the export must carry. **depends-on** AN-04b (merged); the W10 and W11 tables are dropped from its scope (0327: it exports the tables that exist). **replaces** AN-33a **size** 50k, over budget: split **S12-01a** (role, SQL 0056, `sql/test/check-schema-exporter.sql`, decision 0286) and **S12-01b** (the package `tools/cohort-export/`, sole owner of `pnpm-lock.yaml`). **branch** `phase1/s12-01a-exporter-role`, `phase1/s12-01b-cohort-export`.
- **shape (unchanged design).** `geldar_exporter NOLOGIN` with column-level SELECT only on: `events` columns without owner data, `agents` columns without `owner`, the six sheet tables; never `thoughts.model_input`, `mcp_*`, `register_audit`, `turn_records`. Run folder `<out>/<run-id>/` (existing refused), files 0600, NDJSON: `manifest.json`, `public/`, `owner/lives.ndjson` (no owner id), `private/` (offline scoring only). Flags `--run-id --lives --since-tick --until-tick --max-rows` (exceeding fails, never truncates). Every statement `SELECT` inside `BEGIN READ ONLY`. `pg` pinned at `8.23.1` as in `tools/mcp-tokens/package.json`. No table created (R9 adds nothing).
- **revert-checks** add `owner` to the column list: "no owner in output" fails. Drop the read-only transaction: "write denied" fails. Replace the bound failure with `LIMIT`: "bound fails the run" fails.

## S12-02: cohort metrics core

- **id** S12-02 **repo** geldar **status** BLOCKED (S12-01 run-folder format; kit HC-37b ledger names) **replaces** AN-34a/b **size** 50k, split at its line (distributions first). Design unchanged: file-based metrics under `tools/progress-metrics/src/cohort/` with an `insufficient_data` state; refusal, inheritance and drift metrics are dropped (0326, 0327).

## S12-03: control equivalence proof (all-3 equals today's bot)

- **id** S12-03 **repo** geldar **status** READY **depends-on** AN-12 (merged) **size** 35k. **branch** `phase1/s12-03-control-proof`.
- **may-edit** `golem/test/character-control/threat-equivalence.test.ts`, `golem/test/character-control/proficiency-equivalence.test.ts` (new, tests only; `golem/vitest.config.ts` already includes `**/test/**/*.test.ts`); the worknote. **must-not-edit** R6; every non-test file. A difference found is recorded and the card stops; the fix is a new card.
- **Step 0.** Read `golem/src/character/` and the AN-08b threat wiring (`Select-String -Path golem/src -Recurse -Pattern 'fightFloor|fightLimitMs' -List`) and write in the worknote the exported function the Body calls for a threat decision and its file. If no exported function takes the sheet (or its absence) as input, STOP `blocked: no testable threat seam`.
- **shape (test).** For each scenario, call the Body decision function twice: once with `character` omitted and once with `mode: sheet`, `STANDARD_SHEET`, `rolls: false`. Scenarios: health 0 to 20, armed and unarmed, each name in `ALWAYS_HOSTILE`; the fight time limit; proficiency bonus at level 0. Assert equal outcomes, zero RNG draws (spy on the `rngFor` the module imports, or a draw counter the module exposes), and zero audit events for decisions that use no roll. No refusal case exists (S9-02 not built).
- **checks** R7 GATE; `./geldar.ps1 pnpm test golem/test/character-control`. **revert-checks** in a scratch edit, make the all-3 floor 5 in the policy under test: "threat equals legacy over health 0 to 20" fails. Let `rolls: false` draw: "zero draws" fails.
- **exit criteria** both test files pass; two revert-checks recorded. **worknote** `S12-03.md`. **commit** `test(sheet): all-3 sheet with rolls off equals today's Body`.

## S12-04a: adoption planner and dry run for existing agents

- **id** S12-04a **repo** geldar **status** READY **depends-on** AN-05 (merged: `tools/mcp-tokens/src/players.ts` adopts at `player add`) **size** 35k. **branch** `phase1/s12-04a-adopt-sheets-plan`.
- **why.** Lives created before the sheet campaign (Adam and the six rangers) have `agents.character_sheet` NULL. Decision 0328: they adopt the all-3 control sheet first. This card plans and dry-runs only; it writes nothing.
- **may-edit** `tools/mcp-tokens/src/convert-sheets.ts` (new), `tools/mcp-tokens/src/convert-sheets.test.ts` (new), `tools/mcp-tokens/src/players.ts` (change `function adoptedSheet(` to `export function adoptedSheet(`; nothing else), `tools/mcp-tokens/src/cli.ts` (one import line and one dispatch branch before `} else if (command === 'player') {`: `} else if (command === 'player' && rest[0] === 'adopt-sheets') { return await runAdoptSheets(parsed, io, env, rest.slice(1)); }`, plus a `runAdoptSheets` wrapper of at most 15 lines in the style of `runPlayerFlags`; `cli.ts` must stay under 600 lines, else STOP), the worknote. **must-not-edit** R6; ranger containers and scriptorium files; `agents.owner` (never read); shard files.
- **shape.**
  ```
  geldar player adopt-sheets --shard <shard-file> --sheets <json file: { "<life_id>": <sheet> | "standard" }> [--apply]
  ```
  ```ts
  export type PlanLine = { life: string; verdict: 'would-adopt' | 'same' | 'conflict' | 'refused' | 'not-found' | 'dead'; field?: string };
  export async function planAdoption(sql: Sql, shardLives: readonly string[], sheets: Record<string, unknown>): Promise<PlanLine[]>;
  ```
  Per life in `--sheets`: not in the shard file's lives, refused (`--sheets` naming a life outside the shard refuses the whole run); no `agents` row: `not-found`; `died_at` set: `dead` (skipped); malformed sheet: `refused` with the first bad field (from `adoptedSheet`'s error), never repaired; `"standard"` means `STANDARD_SHEET`; baseline NULL: `would-adopt`; baseline equal (by `sheetHash`): `same`; different baseline: `conflict` (the database baseline wins, R-sheet). Only `SELECT agent_id, died_at, sheet_hash FROM agents WHERE agent_id = ANY($1)` runs. Without `--apply` the verb prints one line per life and exits 0; `--apply` prints `adopt-sheets: --apply is S12-04b` and exits 2 until S12-04b lands. No sheet values are printed; no owner is read.
- **tests** (fake `Sql` from `players.fakes.ts`): NULL baseline gives `would-adopt`; equal gives `same`; different gives `conflict`; malformed refused with life and field; dead skipped; unknown `not-found`; a life outside the shard refuses the run; a spy sees only the one `SELECT`.
- **checks** R7 GATE; `./geldar.ps1 pnpm test tools/mcp-tokens/src/convert-sheets tools/mcp-tokens/src/cli`. **revert-checks** compare by sheet object identity instead of `sheetHash`: "equal gives same" fails. Repair a malformed sheet: "malformed is refused" fails. Read `owner`: the spy test fails.
- **exit criteria** tests pass; three revert-checks recorded; `cli.ts` line count recorded. **worknote** `S12-04a.md`. **commit** `feat(sheet): plan sheet adoption for existing agents (dry run)`.

## S12-04b: apply the adoption (SQL 0057, decision 0287)

- **id** S12-04b **repo** geldar **status** READY to code after S12-04a merges; it **writes the all-3 sheet only** (0328 consequence 1); any `--apply` on a live agent is an operator act behind the held-live ruling, never part of the card (ledger: BlockedDecision for the apply). **size** 40k. **branch** `phase1/s12-04b-adopt-sheets-apply`.
- **may-edit** `tools/mcp-tokens/src/convert-sheets.ts`, `convert-sheets.test.ts`; `sql/0057_adoption_source_conversion.sql` (new: drops and re-adds the `character_sheet_adoptions.source` CHECK as `source IN ('config','roster','birth','conversion')`, using the constraint name `pg_constraint` gives for it on a database migrated to 0066, recorded in the worknote by ops before the coder writes it); `sql/test/check-schema-conversion.sql` (new); `ci.yml` (append ` -f sql/test/check-schema-conversion.sql`); `docs/decisions/0287-adopting-existing-agents.md` (new, status Proposed, citing 0328 and recording the stage order below); `docs/runbooks/sheet-conversion.md` (new); the worknote.
- **shape.** `--apply` refuses the whole run (exit 2, `adopt-sheets: --apply writes the standard sheet only (0328)`) when any entry of `--sheets` is not the string `"standard"`; a named sheet can be planned in a dry run but never applied by this card. Then `--apply` runs one transaction per `would-adopt` life: `UPDATE agents SET character_sheet = $2, sheet_hash = $3, sheet_adopted_at = now() WHERE agent_id = $1 AND character_sheet IS NULL` (zero rows updated means a concurrent adoption: report `same` or `conflict` from a re-read, write nothing else), one `sheet_adopted` events row with `source_event_id = 'conversion:sheet_adopted:<life>'`, and one `character_sheet_adoptions` row with source `conversion`, result `adopted` (the insert order of `recordAdoption` in `players.ts`). A `conflict` writes one adoption row with result `conflict` and changes nothing else. Idempotent: a second run reports `same`.
- **stage order (0328, recorded in 0287 and the runbook; no code).** Stage 1: every existing agent adopts `"standard"` (all-3), only after the campaign is complete and has test-shard evidence (0328 item 3); by S12-03 this changes no Body decision. Stage 2: named sheets, one ranger at a time, each with the operator's recorded approval (S12-05). **Open (blocks stage 2, not this card):** the baseline is immutable (`agents_sheet_immutable`, decision 0186) and a life holding the all-3 baseline reports `conflict` for a named sheet, while drift (the only revision path) is off. Moving an adopted all-3 sheet to a named sheet needs its own record ("Moving an adopted standard sheet to a named sheet", number assigned in the registry) before stage 2 can run.
- **tests** (fake `Sql`; real-database lane is ops under GATE-S): `--apply` with one named sheet in `--sheets` refuses and writes nothing; NULL baseline adopts the standard sheet; equal reports `same`; different reports `conflict` and the baseline row is byte-identical afterward; dry run writes nothing; second apply is a no-op; dead life skipped. `check-schema-conversion.sql`: `conversion` accepted, `other` refused, the three old values still accepted.
- **checks** R7 GATE; `./geldar.ps1 pnpm test tools/mcp-tokens/src/convert-sheets`; GATE-S (ops).
- **revert-checks** drop `AND character_sheet IS NULL`: "conflict changes nothing" fails (the 0050 trigger raises). Default to apply: "dry run writes nothing" fails. Remove the standard-only refusal: "apply refuses a named sheet" fails. Leave `conversion` out of the CHECK: the schema check fails.
- **worknote** `S12-04b.md`. **commit** `feat(sheet): one-time adoption of sheets for existing agents (0057)`.

### S12-04b card (prescriptive, 2026-11-28; replaces the summary above for dispatch)

- **id** S12-04b **repo** geldar **branch** `phase1/s12-04b-adopt-sheets-apply` **depends-on** S12-04a (merged, #786) **size** 40k **status** code READY; any run of `--apply` on a live agent is an operator act behind the held-live ruling (0328), never part of this card.
- **Numbers.** SQL **0057**: free on `origin/main` (`d5eaf9ae`; sql files exist for 0053 and from 0060 on). Decision **0287** is named for this card in the registry and in 0328, so this card's coder writes it in this branch; the registry says 0286 to 0288 stay with S12. The docs packet that wrote this card writes none of 0286 to 0288.
- **Files (may edit).** `sql/0057_character_sheet_adoptions_conversion.sql` (new); `sql/test/check-schema-adopt-sheets.sql` (new); `.github/workflows/ci.yml` (append ` -f sql/test/check-schema-adopt-sheets.sql` to the one psql line, after the S12-01a entry, serially); `tools/mcp-tokens/src/adopt-apply.ts` (new, the apply; not `utils`); `tools/mcp-tokens/src/adopt-apply.test.ts` (new); `tools/mcp-tokens/src/cli.ts` (replace the two-line `--apply` refusal in `runAdoptSheets` with one call and one flag; add no other line); `docs/decisions/0287-*.md` (new, the adoption record, cites 0328); the worknote `S12-04b.md`. **Must not edit** `players.ts` beyond S12-04a's export, `geldar.ps1`, `compose/*.yml`, `shards/*.yaml`, `pnpm-lock.yaml`. Paths are colo-images paths: merge only in the colo-images batch window.
- **Step 0 (stop if any fails).** Read `sql/0051_character_audit.sql` (the `character_sheet_adoptions` columns and the inline `source` CHECK) and `sql/0050_character_sheet_xp.sql` (`agents_sheet_immutable`). If the trigger does not allow a NULL to value change of `character_sheet`, `sheet_hash` and `sheet_adopted_at` together, stop and report.
- **Steps.**
  1. **SQL 0057 (additive except one widening).** `character_sheet_adoptions.source` allows only `config`, `roster`, `birth` (0051). Widen it to add `conversion`: drop and re-add the named CHECK `character_sheet_adoptions_source_check` in one transaction. No row changes, no column changes, no new table. This is the only non-additive statement in the card; the test below proves existing rows pass.
  2. **Plan.** Reuse S12-04a's planner unchanged. Only `would-adopt` lives (baseline NULL) are written. `same`, `conflict`, `dead`, `not-found` and `refused` write nothing.
  3. **Sheet.** Only `STANDARD_SHEET` (the `"standard"` token). Any other value in `--sheets` is refused by the apply even when the planner accepts it.
  4. **Write, one transaction per life.** Insert one `events` row (the same insert `player add` uses in `players.ts`; reuse it), then `UPDATE agents SET character_sheet, sheet_hash, sheet_adopted_at WHERE agent_id = $1 AND sheet_hash IS NULL AND died_at IS NULL`, then the audit row with `source = 'conversion'`. Zero rows updated rolls the transaction back and reports `skipped`.
  5. **Dry run is the default.** Without `--apply` the verb prints the S12-04a plan and writes nothing (no statement other than the planner's `SELECT`).
  6. **`--apply` needs an operator flag.** `--apply` without `--operator-confirm` exits 2 and writes nothing. The flag has no default and no environment fallback.
- **Tests and revert checks.**
  - `dry run writes nothing` (revert: skip the dry-run guard; the write statements run; fails).
  - `--apply without --operator-confirm exits 2 and writes nothing` (revert: drop the flag check).
  - `apply writes the STANDARD_SHEET hash to a NULL-baseline live life and one audit row with source conversion` (revert: write the hash from the `--sheets` value; the hash assertion fails).
  - `a named sheet value is refused and nothing is written` (revert: allow named values).
  - `a life with a baseline is conflict and gets no write` (revert: overwrite; the baseline assertion fails).
  - `a dead life gets no write` (revert: drop the `died_at` predicate).
  - `second apply is a no-op with no second audit row` (revert: drop `sheet_hash IS NULL`; the audit count goes to two).
  - `a failed audit insert rolls back the events row` (error path; revert: no transaction; the orphan events row remains).
  - SQL (`check-schema-adopt-sheets.sql`): `conversion` is accepted, `bogus` is rejected, an existing `config` row still passes, and an audit row without its events row is rejected (revert: 0057 not applied; `conversion` is rejected).
- **Checks.** `./geldar.ps1 pnpm exec vitest run tools/mcp-tokens/src/adopt-apply.test.ts tools/mcp-tokens/src/convert-sheets.test.ts`; the SQL file runs in CI; `./geldar.ps1 check`; `git diff --check`; `./geldar.ps1 pnpm check:repo`. Record the line count of `cli.ts` (it is already over the soft cap; no new logic lives there).
- **Exit criteria.** Tests pass; each revert-check recorded with the one line mutated; `cli.ts` line count recorded; no `--apply` run against any agent; 0287 written in this branch only; 0286 and 0288 untouched.
- **Commit** `feat(sheet): one-time adoption of sheets for existing agents (0057)`.
- **Inert.** Nothing in CI or in the operator's default path writes. Stage 2 (a named sheet for a life that holds the all-3 baseline) is not in this card (see Open items 2).

## HC-45: per-player sheet and instinct switch (kit)

- **id** HC-45 (proposed) **repo** kit **status** BLOCKED: HC-19 (kit-b supervisor) is not merged and names the settings file this card edits; until then the may-edit list cannot name an exact file. **size** 35k. **branch** `scriptorium/hc-45-stage-switch`.
- **shape (unchanged).** Per player, default `off`; `off` is byte-identical to today (no `geldar-instinct` run, no new ledger rows); a switch takes effect at the next waking; rollback is the same verb with `off` and keeps written files; the model is never told. Test: with `off`, the prompt and the child environment are byte-identical to a build without this card.
- **revert-checks** default `on`: "default off" fails. Delete ledgers on rollback: "rollback keeps history" fails.

## S12-05: staged enable per ranger and rollback (runbook)

- **id** S12-05 **repo** geldar (docs) **status** BLOCKED (HC-45; OD-11 for the stop bars; the stage-2 record named in S12-04b; per-ranger approval, 0328) **size** 30k docs. **branch** `phase1/s12-05-rollout-runbook`.
- **may-edit** `docs/runbooks/sheet-rollout.md` (new); `docs/decisions/0288-sheet-rollout-and-rollback.md` (new, Proposed); the worknote. No shard file, ACL, compose or ranger container.
- **content.** Stages, one ranger at a time, each gated on the previous stage's evidence and an owner go: (0) all-3 adopted for every life (S12-04b stage 1); (1) a disposable life with the Body flags on; (2) one ranger, sheet mode, all-3, `rolls: false`; (3) the same ranger, `rolls: true`; (4) one named sheet (after the stage-2 record); (5) the next ranger. Morality hooks, lineage and drift are not stages (0326, 0327). Each stage records the config diff, UTC time, lives, expected evidence and stop conditions. Rollback: kit switch `off` (HC-45); Body `character.mode: off` for that life only; database untouched; confirm with the S12-03 cases. Never restart all six rangers at once; never edit a ranger's container; never announce anything to an agent.
- **checks** `./geldar.ps1 pnpm check:repo`. **commit** `docs(sheet): staged enable and rollback runbook`.

## S12-06: run protocol, fixtures and run evidence

- **id** S12-06 **repo** geldar and kit **status** BLOCKED (OD-11 numbers; S12-02; HC-37b, HC-38) **replaces** AN-35a/b. Coder part placement: `tools/cohort-run/` (new package, so it needs the `pnpm-lock.yaml` slot after S12-01b; the orchestrator confirms). Drift windows and births are not run (0327).

## S12-07: campaign review and rollout close

- **id** S12-07 **repo** geldar **status** BLOCKED (S12-06, OD-11) **replaces** AN-36. Reconcile every feature claim against its evidence (a default-off feature needs code and test evidence, not a live run); docs sweep; retro; ledger and RESUME; the owner's enable, opt-in, tune or stop ruling; rollback shown without deleting schema or history. **commit** `docs(sheet): campaign review and rollout close`.

---

## Wave close (W9 to W12)

A wave with an unanswered or "no" owner decision closes **merged inactive**, and the ledger says which record it follows. W9 (0326; S9-04 records it), W10 and W11 (0327; no close card) close that way by design. Default-off or a blocker never marks a missing feature done.

## Open items

1. **OD-11** (cohort numbers and the rollout decision) blocks S12-01a/b, S12-02, S12-05, S12-06, S12-07.
2. **Stage 2 of 0328** (a named sheet for a life that already holds the all-3 baseline): the baseline is immutable (0050 trigger, decision 0186) and drift is off (0327), so "a named sheet replaces the control sheet" (0328 item 2) has no mechanism yet. It needs its own record ("Moving an adopted standard sheet to a named sheet", number assigned in the registry) before S12-05 stage 4; see S12-04b.
3. **`kino_audit`** is exempt in S9-00 but its rows naming an erased life as the viewed agent stay: an owner question.
4. **S9-04 versus 0326.** 0326 item 2 lists S9-04 among the cards not dispatched (the hook-evidence close). The operator asked to keep an inactive close card; S9-04 is therefore rescoped to a worknote-only close with no hook lane. If the orchestrator prefers 0326's reading, S9-04 is dropped and the ledger carries the close.
5. **Tag `psyche-v1.1.0`** is approved (0325) and waits for an ops push; the kit re-mirror to 1.1.0 (G13) follows it. No later psyche release is planned (0327).
6. **Kit numbering.** HC-41 to HC-45 are proposals; the kit orchestrator may renumber.
