# World cards C: lineage (W10), drift (W11), measurement and close (W12), and GX-03

Status: **proposal, nothing dispatched.** Re-sliced from the original candidates (`geldar-an-work-packets.md`, written against geldar `8eac28ba`) and trimmed per [retarget-map.md](retarget-map.md). Ledger and decisions: [README.md](README.md). The behavioural answers are the recommended D-CS answers of `decisions-before-packets.md`, **assumed, unmeasured**. A card marked `Writing` still has `(to confirm)` names and is not `Ready`.

**Who executes.** These cards are executed in the **geldar** repo (`SandboxServers/geldar`) by the **geldar orchestrator**, under geldar's rules: `docs/analysis/phase1/packet-conventions.md` (card fields, contract-first, shared-file owners, gates, never-do list), `CLAUDE.md`, `AGENTS.md` (fresh read-only review of every packet; wave review; ship through `ship-pr`). The scriptorium campaign never edits geldar. The orchestrator owns ADR, migration and prompt numbers (`<allocate via registry>` below), the ledger and `RESUME.md`. Nothing here activates anything for a live player (D-HC-11).

## Basis: what was read

| Item | Value |
|---|---|
| Code read | geldar `origin/main` after `git fetch` = **a1c6fb2a** (2026-11-14). The brief named 907f5b8a; the only change since is the till action (5 files under `golem/src/actions/`), which no card here touches |
| Original plan base | `8eac28ba`; 62 commits and 133 files separate it from 907f5b8a (C7 waves 1 and 2, registration, supervisor, roster, operator flags, ADR 0180 and 0181) |
| Conventions | `docs/analysis/phase1/packet-conventions.md`, `CLAUDE.md`, `AGENTS.md`, `docs/analysis/phase1/packets/decision-number-registry.md`, `packets/c4-packets.md` (C4-00, C4-05, section 10), `ledger.md` |
| Not at origin/main | `psyche/`, any `AN-nn` code, `docs/analysis/character-sheet/` (the folder the worknote paths use; the orchestrator creates it), C4-00 to C4-08 code |

## Wave order and dispatch

W10 then W11 then W12; waves are serial, cards inside a wave follow the arrows. Branches `codex/character-sheet-w10`, `-w11`, `-w12` are the integration branches (naming from the original). Packet branches `codex/an-<nn>-<slug>`; worktrees `.claude/worktrees/an-<nn>` under the geldar repo root (the dispatch gives the absolute path).

```
W10  AN-54a -> AN-54b
     AN-54a -> AN-42 -> AN-55a -> AN-55b -> AN-57        (AN-54b before AN-55a)
     GX-03  (parallel lane; earliest once AN-04 and AN-05 are merged; not wave-bound)
W11  AN-58a -> AN-58b -> AN-59a -> AN-59b -> AN-43 -> AN-60a
                         AN-58a ------------------------> AN-60b (also needs AN-11, AN-12)
W12  AN-33a -> AN-33b ; AN-33a -> AN-34a -> AN-34b ; AN-34a -> AN-35a -> AN-35b -> AN-36
```

Splits made (original card over about 50k working tokens, or two unrelated gates): **AN-54 into a/b, AN-55 into a/b, AN-58 a/b, AN-59 a/b, AN-60 a/b, AN-33 a/b, AN-34 a/b, AN-35 a/b.** AN-42, AN-43, AN-57, AN-36 and GX-03 stay whole. Total 21 cards.

## Shared owners per wave

| Wave | Contract / generated | Shared wiring | Manifest / lockfile | Shard, ACL, image |
|---|---|---|---|---|
| W10 | **AN-54a** (only W10 card touching `contract/`) | AN-57 | **AN-55b** first (needs `@geldar/psyche` in `tools/mcp-tokens/package.json`; the original said AN-57 "only if needed", but AN-55b is the first consumer), then AN-57 only if needed | AN-57: `shards/phase0.yaml` lineage flag, `tools/admin/Dockerfile`, `tools/admin/admin.sh`, `.github/workflows/ci.yml` psql line (each SQL card appends its own `-f` argument, see CK-SQL) |
| W11 | **AN-58a** | AN-60a (eventsink, ACL) and AN-60b (golem) | none expected. If `eventsink` does not already depend on `@geldar/psyche` after AN-07 `(to confirm)`, AN-59a is the sole owner | **AN-60a**: `geldar.ps1` NATS user table, `tools/repo-checks/src/nats-auth.test.ts` |
| W12 | none | AN-36 (report and rollout wiring only) | **AN-33a** (new package `tools/cohort-export`, lockfile) | AN-36; activation needs owner ruling D-CS-12 |
| GX | none (GX-03 adds no contract shape, see its card) | GX-03 owns its two CLI files | none | GX-03 requests one `tools/admin/admin.sh` line `(to confirm with the geldar orchestrator)` |

The orchestrator owns the ledger, `RESUME.md` and number reservations; ops applies index lines (`docs/decisions/README.md`, `sql/README.md`).

## Shared contract names

Names owned by earlier cards (cards of [geldar A](work-packets-geldar-a.md) and [B](work-packets-geldar-b.md), written by other sessions) are **assumed** here and marked `(to confirm)` where used. Names this file creates are `(new)`.

| Name | Owner | Meaning |
|---|---|---|
| `CharacterSheet`, `character-sheet.schema.json`, `$defs/score` | AN-02 `(to confirm)` | Brief 3.2 shape: `attributes` (4), `alignment` (2), `op_modes` (7), optional `proficiency` |
| `STANDARD_SHEET`, `normalizeSheet`, `rngFor`, `Rng`, `Score` in `psyche/` | AN-03 `(to confirm)` | Pure engine; seed = FNV-1a hash then mulberry32 (brief 4.3) |
| `agents.character_sheet JSONB` | AN-04 `(to confirm)` | Immutable adopted or birth baseline (integration plan rule 1) |
| `life_proficiency`, `xp_evidence (life_id, domain, evidence_key UNIQUE, world_tick)`, `character_decisions`, `audit_gaps` | AN-04, AN-06, AN-09, AN-10 `(to confirm)` | Proficiency projection, unique XP evidence, decision audit, audit gap markers |
| Life-state request/reply and Body cache | AN-11, AN-12 `(to confirm)` | Startup state request answered by eventsink; Body keeps a monotonic cache |
| `LineageBirth`, `BirthId` (`bn_` + 26 Crockford chars), `lineage_births`, `lineage_handoffs`, `effective_sheet()`, `operator_lineage_birth`, `operator_lineage_handoff` | AN-54a/b, AN-55a `(new)` | Lineage record, handoff record, effective sheet function (revision 0 until drift exists) |
| `SheetRevision`, `DriftEvaluation`, `sheet_revisions`, `drift_evaluations`, `drift_state`, `sheet_publish_outbox`, `lifeSheetSubject()` | AN-58a/b `(new)` | Drift records; subject `geldar.<shard>.life.<life_id>.sheet` |
| `operator_read_life_sheet`, `SheetCopy` | GX-03 `(new)` | Operator read for the kit's copy |
| `geldar_exporter` (NOLOGIN role), `tools/cohort-export`, run folder layout | AN-33a `(new)` | Read-only export |

## Number registry (recommendation only; the orchestrator allocates)

Rechecked at origin/main `a1c6fb2a` and all 308 remote branches (`git ls-tree` per branch for `sql/`, `docs/decisions/`, `prompts/`).

| Series | Highest on main | In flight on remote branches | Reserved | Free to recommend |
|---|---|---|---|---|
| ADR (`docs/decisions/`) | **0181** (0180 chatgpt harness on colo, 0181 thought context 8704) | 0169 (`phase1/players-host-restart`), 0173 (`phase1/c7-wave3`) | 0174 to 0179 (C7 spare) | **0182 and up**. 0158, 0159, 0161 are not on main but no branch holds them; do not take them without asking |
| SQL (`sql/`) | **0034** (0028 to 0031 are absent from main) | **0035, 0036** (`phase1/c7-wave3`) | 0028 to 0031 (C7-07, C7-09, C7-10, C7-13a per `ledger.md`) | **0037 and up** |
| Prompts `thought/` | v5 | none | v6 (C3-03), v7 (C4-06) | v8 is a candidate only; **these cards allocate none** |
| Prompts `reflection/`, `body-api/` | reflection v2, body-api v7 | none | none | **these cards allocate none** |

The registry file is stale: its last block is dated 2026-11-13 and it lists neither 0180 nor 0181 and says the highest decision on main is 0165. This file needs **4 ADRs** (lineage and D-CS-17 adapter in AN-54a; drift and D-CS-13 in AN-58a; cohort protocol and export in AN-33a; sheet read path in GX-03) and **5 migrations** (AN-54b, AN-55a, AN-58b, AN-33a, GX-03), all `<allocate via registry>`. Cards below write `ADR-<n>` and `SQL-<n>` as placeholders only.

## Common rules (cited by each card)

**Fields.** Every card carries geldar's fields in order: `id`, `wave`, `depends-on`, `may-edit`, `must-not-edit`, `decisions`, `checks`, `size`, `worknote`, `commit`, `on-cap`, plus `branch`, `status`, and a revert-check per behaviour.

**must-not-edit (always).** `docs/spec.md`; accepted ADRs; merged migrations and prompts; `contract/**` and generated output unless the card owns them; `docs/decisions/README.md` and `sql/README.md` (ops index lines, "index line to add" in the worknote); `geldar.ps1`, `tools/repo-checks/**`, `shards/*.yaml`, `.github/workflows/ci.yml`, `pnpm-lock.yaml`, root and package manifests, golem `view.ts` unless the card owns them; every file of the geldar registration work (`threshold/register/**`, `sql/0008` to `0012`, any `register_*` function, `tools/mcp-tokens/src/cli.ts`, `identities.ts`, `owner-admin.ts`, `owners.ts`); other packets' worknotes; `animus/**` (frozen by D-HC-01).

**Never-do list (conventions 5).** No `adam up` (or `adam up --help`); no state-changing probe against a live shard; never weaken a test or fixture; no `git reset`, `git stash` or `git checkout` on tracked work; never edit `docs/spec.md`; never push, open a PR or prune a worktree. Databases and secrets by environment variable, never a junction.

**Size.** Haiku-class coder, about 50k working tokens at most (D-HC-10). Reviewer, fix and ops usage is separate. A card that grows past it is split before dispatch, never rescued by a continuation.

**Checks sets.** Each card also lists its own targeted tests and revert-checks.
- **CK-BASE:** `./geldar.ps1 pnpm --filter <package> typecheck`; `./geldar.ps1 pnpm format`; `./geldar.ps1 pnpm lint`; `git diff --check`; `./geldar.ps1 pnpm check:repo`; `git merge-tree --write-tree codex/character-sheet-w<N> HEAD`; file caps (500 soft, 700 hard); the report lists each gate with command, result and commit hash (conventions 9). Tests: `./geldar.ps1 pnpm test <filter>` (root vitest; `tools/*` packages have no own test script).
- **CK-CONTRACT:** CK-BASE plus `./geldar.ps1 pnpm --filter @geldar/contract generate` then `./geldar.ps1 pnpm check:generated` and `./geldar.ps1 pnpm test contract`. Generator limits seen in `contract/scripts/generator.ts`: one validator per schema `title`; **a `$defs` name ending in `Input` or `Result` is treated as an MCP tool pair and the generator throws on an unpaired one**, so no def here ends in either word.
- **CK-SQL:** CK-BASE plus the new `sql/test/check-schema-<x>.sql` appended to the one `psql ... -f sql/test/check-schema*.sql` line of `.github/workflows/ci.yml` (step near line 175; `tools/repo-checks/src/ci-schema-wiring.test.ts` fails if a `check-schema*.sql` file is not named there), and the migration inserts its own `schema_migrations` row (`tools/migrate/src/ledger.test.ts`). **Ops records** a fresh and an upgraded scratch database: apply every `sql/[0-9]*.sql` with `psql -v ON_ERROR_STOP=1`, run `check-schema.sql` then the new check file, and `node tools/migrate/src/cli.ts --dry-run`. A mocked transaction is not durability proof.
- **CK-IT (real services):** `$env:GELDAR_IT = '1'; ./geldar.ps1 pnpm test <filter>` against the scratch shard; ops records it. Live cases are serial and 8B-only.

**Revert-check.** For each behaviour the coder reverts it locally, runs the named test, confirms it fails, restores it, and names the test in the report.

**on-cap (all cards).** Commit what passes, record base SHA, passing tests and unfinished steps in the worknote, leave a clean branch and stop. Do not push, deploy, weaken a test or invent a design. Re-slice if a card needs repeated finishers.

**Commit and worknote.** `feat(character): <result>` or `docs(character): <result>`; the dispatch supplies the final subject and trailers verbatim. Worknote `docs/analysis/character-sheet/worknotes/<id>.md`, one per packet.

**Invariants every card honours.** (1) No true sheet, score, label or roll may appear in anything an agent can see (MCP results, journals, snapshots, prompts, any NATS subject the `mcp` or `mind` role can read). No card here adds agent-visible text, so the agent-text scan (`contract/test/agent-visible-text.test.ts`) is unaffected; each card that moves scores names its leak test. (2) Drift is behaviour-based, default off, windows of 168000 world ticks (7 days of 24000), at most one point per eligible field per completed window; the numbers are unmeasured placeholders. (3) A mocked birth is not completion; unavailable prerequisites are `BlockedDependency`.

## What the birth campaign (C4) provides at origin/main, exactly

The lineage cards depend on Phase 1 C4, which proposed `lf_...` life ids; the code uses `ag_...`.

| Prerequisite | At a1c6fb2a |
|---|---|
| C4-00 contract shapes (`life.started`, `life.ended`, `credit.*`, ADR 0115) | **Absent.** No `life-event` schema, no `life.started` string anywhere in `contract/`, `golem/`, `eventsink/`, `sql/` (grep) |
| `lf_` life ids | **Absent.** `LifeId` is `^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$` in `contract/schemas/common.schema.json`, and `contract/src/subjects.ts` hardcodes the same pattern. Subject helpers throw on anything else |
| C4-05 shrine, server life-id allocation, birth, Cradle headroom | **Absent.** No `plugin/**/shrine`, `life` or `birth` directory; no allocator. A life id is chosen by the caller: `tools/mcp-tokens/src/players.ts` `addPlayer` (operator) and the SECURITY DEFINER `register_create_player` (registration) both take a supplied `ag_` id |
| Parent link storage | **Present, unused.** `agents.parent_a` and `agents.parent_b` (`sql/0001_init.sql`, `REFERENCES agents`) exist and no code writes them. `agents.born_at`, `born_day` exist; `born_day` is not set by `addPlayer` |
| A running Body for a DB-created life | **Partial.** `golem/src/players/main.ts` reads `sovereign.players[]` of the shard YAML. The supervisor path (`supervisor/`, C7-03b2 and C7-03b4) is not merged and `golem/` does not read `GELDAR_LOGIN_NAME` |
| Owner cap, roster | **Present.** Trigger `mcp_enforce_owner_cap` (0006), `mcp_roster` (0024), operator function precedent `operator_set_player_flags` (0034) |

**Consequence.** AN-54a, AN-54b and AN-42 need none of C4 and are `Writing`. **AN-55a, AN-55b and AN-57 are `BlockedDependency` on "C4-00 and C4-05 merged, with the D-CS-17 adapter ruling that maps `lf_` to the existing `LifeId`".** One unblock option is recorded as an owner question (Open items 1): rule that the operator-authorized path (`birth_source = 'operator'`, the owner names the child as `addPlayer` does today, no new allocator) is the round-1 birth lifecycle. Without that ruling nothing in W10 may be reported as lineage delivered.

## Card ledger

| Card | Title | Wave | Depends on | Status |
|---|---|---|---|---|
| AN-54a | Lineage contract unblocker | W10 | AN-02, AN-53 (order) | Writing |
| AN-54b | Lineage SQL: births, handoffs, `effective_sheet()` | W10 | AN-54a, AN-04 | Writing |
| AN-42 | Pure inherited-sheet factory | W10 | AN-54a, AN-03 | Writing |
| AN-55a | Birth function and handoff transitions (SQL) | W10 | AN-54b | **BlockedDependency** (C4-00, C4-05, D-CS-17) |
| AN-55b | Birth adapter and operator CLI | W10 | AN-55a, AN-42 | **BlockedDependency** (same) |
| AN-57 | Lineage integration, ancestry query, flag | W10 | AN-55b, HC-34, HC-35 | **BlockedDependency** (C4, HC-34, HC-35, Body host) |
| GX-03 | Operator read of an owner's own life sheet | parallel | AN-04, AN-05 | Writing |
| AN-58a | Drift contract and policy config | W11 | AN-57 (order), AN-54a | Writing (D-CS-13 assumed) |
| AN-58b | Drift SQL | W11 | AN-58a, AN-54b | Writing |
| AN-59a | Window math and evidence readers | W11 | AN-58b, AN-09 | Writing |
| AN-59b | Rule, decision and eligibility | W11 | AN-59a | Writing |
| AN-43 | Bounded transition and revision record | W11 | AN-59b | Writing |
| AN-60a | Revision publication, sleep trigger, ACL (eventsink) | W11 | AN-43, AN-11 | Writing |
| AN-60b | Body cache reload (golem) | W11 | AN-58a, AN-11, AN-12 | Writing |
| AN-33a | Export role and world exporter | W12 | AN-60a, AN-54b, AN-58b | Writing (D-CS-11) |
| AN-33b | Ingest of the kit's exported ledgers | W12 | AN-33a, HC-37 | **BlockedDependency** (HC-37 file format) |
| AN-34a | Cohort metrics core | W12 | AN-33a | Writing |
| AN-34b | Harness and model dimensions, H7 to H9, report | W12 | AN-34a, AN-33b | Writing; real inputs wait on HC-37 |
| AN-35a | Protocol and run-set validator, fixtures | W12 | AN-34a | Writing |
| AN-35b | Collection scripts, report protocol, run evidence | W12 | AN-35a, HC-38, AN-60b | **BlockedDependency** (HC-38; owner accepts D-CS-10 and D-CS-11 numbers) |
| AN-36 | Campaign close and rollout wiring | W12 | AN-35b, fresh review, D-CS-12 | **BlockedDependency** (evidence, owner ruling) |

---

## W10: lineage

### AN-54a: lineage contract unblocker

- **id:** AN-54a (UNBLOCKER). **wave:** W10. **branch:** `codex/an-54a-lineage-contract`. **status:** Writing.
- **depends-on:** AN-02 (sheet shapes, `contract/schemas/character-sheet.schema.json`), AN-53 (wave order). D-CS-09 and D-CS-17 accepted (assumed).
- **may-edit:** `contract/schemas/lineage-birth.schema.json` (new); `contract/src/index.ts` (one block `// --- AN-54 lineage ---`, now 422 lines, stays under 500); `contract/test/lineage-birth.test.ts` (new); `contract/src/generated/**` (regenerate only); `docs/decisions/ADR-<allocate via registry>-lineage-and-the-ag-life-id.md` (new); the worknote.
- **must-not-edit:** always list; also `contract/schemas/common.schema.json` (the `LifeId` pattern stays), `character-sheet.schema.json`, `contract/src/subjects.ts` (no lineage subject exists, the DB is the record), every other schema.
- **decisions:** D-CS-09, D-CS-17; ADR `<allocate via registry>` records: (a) the lineage shapes reference `common.schema.json#/$defs/LifeId`, so a later widening for `lf_` flows in with no edit here; (b) `birth_source` mirrors C4's `spawn | cradle | replacement` plus `operator`; (c) the child sheet carries no proficiency by construction.
- **size:** about 40k.
- **Deliver (shape):**
```jsonc
// contract/schemas/lineage-birth.schema.json (title LineageBirth => validateLineageBirth)
{ "$id": "https://geldar.dev/schemas/lineage-birth.schema.json", "title": "LineageBirth",
  "type": "object", "additionalProperties": false,
  "required": ["version","birth_id","child_life_id","parents","formula_version","birth_source",
               "born_world_tick","fields","child_sheet"],
  "properties": {
    "version": {"const": 1},
    "birth_id": {"$ref": "#/$defs/BirthId"},
    "child_life_id": {"$ref": "common.schema.json#/$defs/LifeId"},
    "parents": {"type":"array","minItems":2,"maxItems":2,"items":{"$ref":"#/$defs/ParentRef"}},
    "formula_version": {"const": 1},
    "birth_source": {"enum": ["operator","cradle","spawn","replacement"]},
    "born_world_tick": {"$ref": "common.schema.json#/$defs/WorldTick"},
    "fields": {"type":"array","minItems":13,"maxItems":13,"items":{"$ref":"#/$defs/InheritedField"}},
    "child_sheet": {"$ref": "#/$defs/InheritedSheet"} },
  "$defs": {
    "BirthId": {"type":"string","pattern":"^bn_[0-9A-HJKMNP-TV-Z]{26}$"},
    "ParentRef": {"type":"object","additionalProperties":false,"required":["life_id","effective_revision"],
       "properties":{"life_id":{"$ref":"common.schema.json#/$defs/LifeId"},
                     "effective_revision":{"type":"integer","minimum":0}}},
    "InheritedField": {"type":"object","additionalProperties":false,
       "required":["field","parent_a","parent_b","mean_rounded","u","mutation","child"],
       "properties":{"field":{"enum":[/* 13 names: attributes.curiosity ... op_modes.nitwit */]},
          "parent_a":{"$ref":"character-sheet.schema.json#/$defs/score"}, "parent_b":{...},
          "mean_rounded":{...}, "u":{"type":"number","minimum":0,"exclusiveMaximum":1},
          "mutation":{"enum":[-1,0,1]}, "child":{...}}},
    "InheritedSheet": {/* attributes (4), alignment (2), op_modes (7), additionalProperties false, NO proficiency; written out in full because additionalProperties:false does not combine with allOf */} } }
```
  Index block: `export function validateLineageBirth(value: unknown): ValidationResult<LineageBirth>` (same pattern as `validateSnapshot`). Do not name a def `...Result` or `...Input`.
- **checks:** CK-CONTRACT. Tests in `contract/test/lineage-birth.test.ts`: a valid example parses; rejects a missing `birth_id`, a `bn_` id with a lowercase character, one parent, three parents, score 0 and 6, mutation 2, `formula_version` 2, an unknown key, a 12-element `fields`, a `child_sheet` that carries `proficiency`, and a child id `lf_abc` (named "lf_ ids are rejected until C4-00 widens LifeId"; the worknote says this test is meant to change when `LifeId` widens).
- **revert-checks:** R1 remove `"additionalProperties": false` from `InheritedSheet`; the test "child sheet rejects proficiency" must fail. R2 change `maxItems` of `parents` to 3; "rejects three parents" must fail.
- **worknote:** `docs/analysis/character-sheet/worknotes/AN-54a.md`. **commit:** `feat(character): add the LineageBirth contract (two parents, 13 recorded fields, no proficiency)`. **on-cap:** common rule.

### AN-54b: lineage SQL (births, handoffs, `effective_sheet()`)

- **id:** AN-54b. **wave:** W10. **branch:** `codex/an-54b-lineage-sql`. **status:** Writing (`agents.character_sheet` name from AN-04 `(to confirm)`).
- **depends-on:** AN-54a, AN-04.
- **may-edit:** `sql/SQL-<allocate via registry>_lineage.sql` (new); `sql/test/check-schema-lineage.sql` (new); `.github/workflows/ci.yml` (append `-f sql/test/check-schema-lineage.sql` to the schema psql line only `(to confirm with the geldar orchestrator: ci.yml owner)`); the worknote. Index lines requested for `sql/README.md` and the export and retention map AN-04 created `(to confirm name)`.
- **must-not-edit:** always list; migrations 0001 to 0034; the grants of `geldar_mcp`, `geldar_register`, `geldar_glass`.
- **decisions:** D-CS-09, D-CS-17, D-CS-07 (retention); ADR from AN-54a (cited, no new record). Retention note: lineage rows are life ids, sheets and ticks with no owner link, so under ADR 0171 they stay as world history after account erasure; the worknote asks the C7-09 owner to add them to the owner export only as the owner's own lives' ancestry.
- **size:** about 45k.
- **Deliver (SQL shape):**
```sql
CREATE TABLE lineage_births (
  birth_id TEXT PRIMARY KEY CHECK (birth_id ~ '^bn_[0-9A-HJKMNP-TV-Z]{26}$'),
  child_life_id TEXT NOT NULL UNIQUE REFERENCES agents (agent_id),
  parent_a TEXT NOT NULL REFERENCES agents (agent_id),
  parent_b TEXT NOT NULL REFERENCES agents (agent_id),
  parent_a_revision INT NOT NULL CHECK (parent_a_revision >= 0),
  parent_b_revision INT NOT NULL CHECK (parent_b_revision >= 0),
  formula_version INT NOT NULL CHECK (formula_version = 1),
  birth_source TEXT NOT NULL CHECK (birth_source IN ('operator','cradle','spawn','replacement')),
  born_world_tick BIGINT NOT NULL CHECK (born_world_tick >= 0),
  fields JSONB NOT NULL CHECK (jsonb_typeof(fields) = 'array' AND jsonb_array_length(fields) = 13),
  child_sheet JSONB NOT NULL CHECK (NOT (child_sheet ? 'proficiency') AND lineage_scores_ok(child_sheet)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (parent_a <> parent_b), CHECK (child_life_id <> parent_a AND child_life_id <> parent_b));
CREATE TRIGGER lineage_births_append_only BEFORE UPDATE OR DELETE ON lineage_births
  FOR EACH ROW EXECUTE FUNCTION journal_append_only();           -- function from 0007
CREATE TABLE lineage_handoffs (
  birth_id TEXT PRIMARY KEY REFERENCES lineage_births (birth_id),
  child_player_id TEXT NOT NULL UNIQUE CHECK (child_player_id ~ '^ag-[a-z0-9]+(-[a-z0-9]+)*$'),
  state TEXT NOT NULL CHECK (state IN ('pending','claimed','done','failed')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  last_code TEXT CHECK (last_code ~ '^[a-z][a-z0-9_]{0,47}$'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE agents ADD CONSTRAINT agents_parents_both_or_none
  CHECK ((parent_a IS NULL) = (parent_b IS NULL));   -- existing rows have both NULL
-- lineage_scores_ok(jsonb): IMMUTABLE; the 13 innate keys are integers 1..5 (reuse AN-04's check function if it exists)
CREATE FUNCTION effective_sheet(p_life_id TEXT) RETURNS TABLE (revision INT, sheet JSONB)
  LANGUAGE sql STABLE AS $$ SELECT 0, a.character_sheet FROM public.agents a
    WHERE a.agent_id = p_life_id AND a.character_sheet IS NOT NULL $$;   -- AN-58b replaces it
REVOKE ALL ON lineage_births, lineage_handoffs FROM PUBLIC;
GRANT SELECT ON lineage_births, lineage_handoffs TO geldar;   -- operator role, guarded by a pg_roles check as in 0034
INSERT INTO schema_migrations (version) VALUES ('SQL-<allocate via registry>') ON CONFLICT DO NOTHING;
```
- **checks:** CK-SQL. `check-schema-lineage.sql` (RAISE EXCEPTION style as `check-schema-owner-keys.sql`) covers: duplicate `birth_id`; duplicate `child_life_id`; unknown parent (FK); same parent twice; child equal to a parent; score 0 and 6; a `proficiency` key; wrong `fields` length; UPDATE and DELETE refused; `agents` row with only `parent_a`; `has_table_privilege` false on both tables for `geldar_mcp`, `geldar_register`, `geldar_glass` (each guarded by `pg_roles`); `effective_sheet` returns revision 0 and the baseline, and no row for a life with a NULL sheet.
- **revert-checks:** R1 drop the `parent_a <> parent_b` CHECK; the "same parent twice" step must fail. R2 drop the append-only trigger; the UPDATE step must fail. R3 `GRANT SELECT ON lineage_births TO geldar_mcp`; the privilege step must fail.
- **worknote:** `.../worknotes/AN-54b.md`. **commit:** `feat(character): add the lineage tables and effective_sheet() (append-only, no grants beyond the operator)`. **on-cap:** common rule.

### AN-42: pure inherited-sheet factory

- **id:** AN-42. **wave:** W10. **branch:** `codex/an-42-inherit-factory`. **status:** Writing (psyche names `(to confirm)`).
- **depends-on:** AN-54a (field list and types), AN-03 (`rngFor` primitives, `normalizeSheet`, `Score`).
- **may-edit:** `psyche/src/lineage/inherit.ts` (new); `psyche/src/lineage/inherit.test.ts` (new); `psyche/src/index.ts` (one export line; sole W10 editor of the barrel `(to confirm barrel name from AN-03)`); the worknote.
- **must-not-edit:** always list; `psyche/package.json`, `pnpm-lock.yaml`; every other `psyche/src` file (AN-03's).
- **decisions:** D-CS-09 (assumed: parental **effective** scores snapshotted at the birth request, both revisions recorded, mutation -1/0/+1 at 20/60/20, half rounds up, zero proficiency).
- **size:** about 40k.
- **Deliver (signatures):**
```ts
export const LINEAGE_FORMULA_VERSION = 1 as const;
export const INNATE_FIELDS = ['attributes.curiosity','attributes.common_sense','attributes.cleverness',
  'attributes.aggression','alignment.law','alignment.good','op_modes.explorer','op_modes.farmer',
  'op_modes.miner','op_modes.builder','op_modes.crafter','op_modes.warrior','op_modes.nitwit'] as const;
export interface ParentSheetRef { lifeId: string; revision: number; sheet: InnateSheet }   // already effective
export interface InheritInput { birthId: string; parentA: ParentSheetRef; parentB: ParentSheetRef }
export interface FieldDraw { field: InnateField; a: Score; b: Score; meanRounded: Score;
  u: number; mutation: -1 | 0 | 1; child: Score }
export interface InheritOutput { formulaVersion: 1; childSheet: InnateSheet; fields: FieldDraw[] }  // 13, fixed order
export function roundedMean(a: Score, b: Score): Score;          // Math.ceil((a + b) / 2): .5 rounds up
export function mutationFor(u: number): -1 | 0 | 1;              // u < 0.2 -> -1; u < 0.8 -> 0; else +1
export function rngForBirth(birthId: string, field: InnateField): Rng; // fnv1a(`${birthId}|1|${field}`) -> mulberry32
export function inheritSheet(input: InheritInput,
  draw?: (birthId: string, field: InnateField) => number): InheritOutput;   // pure; draw injectable for tests
```
  Child score = `clamp(roundedMean + mutationFor(u), 1, 5)`. The draw is keyed by `(birthId, field)` only, so swapping parent A and B gives the same child. Output never contains `proficiency`; the input type has no proficiency, relationships or skills field, and extra keys on an input sheet are dropped by `normalizeSheet`. No import of `node:net`, `pg`, `@nats-io/*`, any model client, or `Date`/`Math.random`.
- **checks:** CK-BASE (`--filter @geldar/psyche`); `./geldar.ps1 pnpm test psyche/src/lineage`. Tests: all 25 `(a,b)` pairs for `roundedMean` (1,2 -> 2; 4,5 -> 5; 3,3 -> 3); `mutationFor` at u = 0, 0.19999, 0.2, 0.79999, 0.8, 0.99999; **exact distribution** by injecting 1000 evenly spaced draws `i/1000` and counting exactly 200, 600, 200; clamp extremes (1,1 with -1 gives 1; 5,5 with +1 gives 5); all 13 fields present in the fixed order; same `birthId` twice gives deep-equal output; two birth ids give different `u` lists; a drifted parent (`revision: 3`, changed scores) is used as given and recorded; swapping parents gives the same child; an input carrying `proficiency` yields an output without it; a source scan asserts no forbidden import.
- **revert-checks:** R1 change `Math.ceil` to `Math.floor` in `roundedMean`; "4,5 -> 5" must fail. R2 change the 0.2 boundary to 0.3; the 200/600/200 count must fail. R3 drop the clamp; the extremes test must fail.
- **worknote:** `.../worknotes/AN-42.md`. **commit:** `feat(character): add the pure inherited-sheet factory (rounded mean, 20/60/20 mutation, birth-keyed draws)`. **on-cap:** common rule.

### AN-55a: birth function and handoff transitions (SQL)

- **id:** AN-55a (world half of AN-55). **wave:** W10. **branch:** `codex/an-55a-birth-sql`. **status:** **BlockedDependency** on C4-00 and C4-05 merged and the D-CS-17 adapter ruling (see section above). The card is written so it unblocks the moment the prerequisite or the owner question 1 ruling lands; **no mocked birth completes it**.
- **depends-on:** AN-54b, AN-04, AN-05.
- **may-edit:** `sql/SQL-<allocate via registry>_lineage_birth.sql` (new); `sql/test/check-schema-lineage-birth.sql` (new); `.github/workflows/ci.yml` (one `-f` argument, `(to confirm)`); the worknote.
- **must-not-edit:** always list; `register_create_player` and every `register_*` function (a separate `operator_` function is used so the registration work is untouched, as `0034` did); `tools/mcp-tokens/**`.
- **decisions:** D-CS-09, D-CS-17, D-CS-07; ADR from AN-54a (cited).
- **size:** about 50k (split off the TS adapter for that reason).
- **Deliver (SQL shape).** One function, the whole birth in one transaction, no id allocation (the caller names the child as `addPlayer` does today, the function only validates shape and uniqueness):
```sql
CREATE FUNCTION operator_lineage_birth(
  p_birth_id TEXT, p_owner_id TEXT, p_parent_a TEXT, p_parent_b TEXT,
  p_parent_a_revision INT, p_parent_b_revision INT,
  p_child_player_id TEXT, p_child_life_id TEXT, p_child_name TEXT, p_harness TEXT, p_shard TEXT,
  p_start_credits INT, p_birth_source TEXT, p_born_world_tick BIGINT,
  p_fields JSONB, p_child_sheet JSONB) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$ ... $$;
```
  Steps, in order, each refusal returning a fixed code and writing one `register_audit` row (actor `operator`, action `lineage.birth`, target the child life id, detail the code only; precedent `0034`): (1) if `birth_id` exists return `duplicate` when child and parents match, else `birth-id-conflict`, no writes; (2) lock the owner row `FOR UPDATE`; (3) both parents exist (`unknown-parent`), belong to the owner (`parent-not-owned`), are `mode = 'sovereign'`, alive (`parent-dead`), not retired (`parent-retired`), distinct (`parents-same`); (4) `p_parent_x_revision` equals `(SELECT revision FROM effective_sheet(parent))` now, else `stale-parent-revision`; (5) every `p_fields[i].a` and `.b` equals the parents' effective scores and `.child` equals `p_child_sheet`'s value, else `sheet-mismatch` (the database cannot recompute the draw, it can refuse a lineage record that disagrees with its parents); (6) the roster row for the child's name belongs to the owner and has a free slot (`roster-not-listed`, `roster-full`; the rule of `checkRosterStart` in `tools/mcp-tokens/src/roster.ts`); (7) the owner's lifetime count of created players is under 10, the constant of `register_create_player` (`lifetime-limit`; see Open items 5); (8) INSERT `agents` (`agent_id = life_seq 1`, `game_account` equal to the life id, `mode 'sovereign'`, `declared_model 'self-reported'`, `model_config 'declared:unverified'`, `tier 'sovereign'`, `personality_seed NULL`, `character_sheet = p_child_sheet`, `parent_a`, `parent_b`, `born_day = p_born_world_tick / 24000`), `mcp_players` (`status 'active'`; the owner-cap trigger 0006 raises `check_violation`, mapped to `owner-cap`), `mcp_budget` (`p_start_credits`), `lineage_births`, `lineage_handoffs` (`state 'pending'`); no `life_proficiency` row is inserted, so XP is zero. Returns `ok`. Second function `operator_lineage_handoff(p_birth_id TEXT, p_to TEXT, p_code TEXT) RETURNS TEXT` allows only pending to claimed, claimed to done or failed, failed to pending (attempts + 1, at most 5). EXECUTE on both goes to role `geldar` only (guarded `DO`), `REVOKE ALL ... FROM PUBLIC`.
- **checks:** CK-SQL. `check-schema-lineage-birth.sql`: one passing birth (child rows, parent links, lineage row, pending handoff, zero `life_proficiency` rows); duplicate `birth_id` returns `duplicate` with no second child; same `birth_id` with a different child returns `birth-id-conflict`; each refusal code with its fixture (dead, retired, foreign, unknown, same parent, stale revision, sheet mismatch, roster, owner cap, lifetime limit); a refused birth leaves no `agents` row (rollback); handoff transitions allowed and refused; EXECUTE denied to `geldar_mcp`, `geldar_register`, `geldar_glass`.
- **revert-checks:** R1 remove step (4); the stale-revision case must fail. R2 remove step (1); the duplicate case must create a twin and fail. R3 insert a `life_proficiency` row for the child; the zero-XP check must fail.
- **worknote:** `.../worknotes/AN-55a.md`. **commit:** `feat(character): add operator_lineage_birth and the handoff transitions`. **on-cap:** common rule.

### AN-55b: birth adapter and operator CLI

- **id:** AN-55b (world half of AN-55). **wave:** W10. **branch:** `codex/an-55b-birth-adapter`. **status:** **BlockedDependency** (same prerequisite as AN-55a).
- **depends-on:** AN-55a, AN-42.
- **may-edit:** `tools/mcp-tokens/src/lineage-birth.ts` (new); `tools/mcp-tokens/src/lineage-cli.ts` (new, standalone entry so `cli.ts`, 515 lines and shared, is untouched); `tools/mcp-tokens/src/lineage-birth.test.ts`, `lineage-cli.test.ts` (new); `tools/mcp-tokens/package.json` (add `"@geldar/psyche": "workspace:*"`; W10 manifest owner); `pnpm-lock.yaml` (via `./geldar.ps1 setup`, sole W10 owner); the worknote. Index line to add for `USAGE` in `cli.ts`: `lineage birth|show|handoff ...` `(to confirm with the geldar orchestrator)`.
- **must-not-edit:** always list; `tools/mcp-tokens/src/players.ts` (imported, not edited), `cli.ts`, `roster.ts`.
- **decisions:** D-CS-09, D-CS-17.
- **size:** about 45k.
- **Deliver (shapes):**
```ts
export interface BirthRequest { birthId?: string; owner: string; parentA: string; parentB: string;
  childPlayerId: string; childLife: string; childName: string; harness: string; birthSource: 'operator' }
export type BirthRefusal = 'lineage_off' | 'unknown-parent' | /* the AN-55a codes */ string;
export type BirthOutcome =
  | { code: 'ok' | 'duplicate'; lineage: LineageBirth }
  | { code: BirthRefusal };
export async function requestBirth(sql: Sql, req: BirthRequest, shard: SovereignShard, lineageOn: boolean): Promise<BirthOutcome>;
```
  Flow: (1) `lineageOn === false` returns `lineage_off` before any query; (2) mint `bn_` id with the repo ULID helper (`golem/src/ulid.ts`) if absent and print it so a retry reuses it; (3) `SELECT ... FROM lineage_births WHERE birth_id = $1`: if found return `duplicate` with the stored record, **never re-rolling** even if a parent has drifted since; (4) read both parents with `SELECT * FROM effective_sheet($1)`; (5) `born_world_tick = SELECT max(world_tick) FROM events WHERE shard-scope` `(to confirm: a better tick source; the sink-fed `events` table is the only one today)`; (6) `inheritSheet` from AN-42; (7) validate with `validateLineageBirth`; (8) call `operator_lineage_birth` with `shard.capCredits` as `p_start_credits`; (9) on `ok` print one line with the child life id and handoff state `pending`. CLI (`node tools/mcp-tokens/src/lineage-cli.ts`): `lineage birth --owner --parents <a>,<b> --child-player ag-name-NN --child-life ag_name_NN --name --harness [--birth-id bn_...]`; `lineage show <life>` (ancestry record, never prints a score of a living parent beyond the recorded 13 fields of that birth); `lineage handoff <birth-id> claim|done|fail <code>`. Output never contains a token or a free-text error from the database.
- **checks:** CK-BASE (`--filter @geldar/mcp-tokens`), `./geldar.ps1 pnpm test lineage-birth lineage-cli` with a fake `Sql`; CK-IT for the real database and the crash cases (ops records): a crash after `inheritSheet` and before the call leaves no row, and the retry yields the identical record; a crash after the call and before the print returns `duplicate` with the same child; a failed launcher leaves the handoff `failed` then `pending`, never a second birth; the child account is distinct from both parents' game accounts.
- **revert-checks:** R1 remove the `lineageOn` guard; "lineage off refuses before any query" must fail. R2 remove step (3) (re-roll on retry); "retry returns the committed child" must fail. R3 have `parentA` and `parentB` read from `agents.character_sheet` baseline instead of `effective_sheet`; the drifted-parent test must fail.
- **worknote:** `.../worknotes/AN-55b.md`. **commit:** `feat(character): add the operator lineage birth adapter and CLI (idempotent, no re-roll)`. **on-cap:** common rule.

### AN-57: lineage integration (world half), ancestry query, on/off

- **id:** AN-57. **wave:** W10. **branch:** `codex/an-57-lineage-integration`. **status:** **BlockedDependency**: C4-00 and C4-05; kit cards HC-34 (`geldar-play new --parents`) and HC-35 (seed prose); and a Body host for a DB-created life (`supervisor/` C7-03b2 and C7-03b4 merged, or an entry in `sovereign.players`). The unit-level wiring below can be built earlier; **the wave stays pending until the two-path gate passes with real lives.**
- **depends-on:** AN-55b, HC-34, HC-35.
- **may-edit:** `tools/mcp-tokens/src/lineage-query.ts` (new, recursive ancestry and descendants to depth 8) and `.test.ts`; `shards/phase0.yaml` (add `character.lineage: { enabled: false }`, only if AN-07 created the `character` block `(to confirm)`); `tools/admin/Dockerfile` (`COPY psyche ./psyche` and `--filter "@geldar/psyche..."`); `tools/admin/admin.sh` (a `lineage` subcommand case that runs `lineage-cli.ts`); `docs/runbooks/lineage-gate.md` (new); the worknote.
- **must-not-edit:** always list; `golem/**`, `threshold/**`, `supervisor/**`.
- **decisions:** D-CS-09, D-CS-17. Lineage off: `lineage birth` refuses with `lineage_off`; ordinary `player add` is unchanged and gives the standard sheet.
- **size:** about 40k plus ops evidence.
- **Deliver:** the flag read (`character.lineage.enabled`, omitted means off) wired into `lineage-cli.ts`; `lineage tree <life>` using
```sql
WITH RECURSIVE anc(life, depth) AS (SELECT $1::text, 0 UNION ALL
  SELECT p, depth + 1 FROM anc JOIN lineage_births b ON b.child_life_id = anc.life
  CROSS JOIN LATERAL (VALUES (b.parent_a), (b.parent_b)) v(p) WHERE depth < 8)
SELECT life, depth FROM anc ORDER BY depth, life;
```
  the admin image copy of `psyche`; the runbook for the **two-path gate** run by ops on disposable lives: path one is the world birth (AN-55) with the handoff left `pending`, path two is the kit consuming it (HC-34 claim, HC-35 prose, child running) on two child lives that use different harnesses when the owner allows `(to confirm)`. The gate passes only when: both children are distinct lives and accounts with the recorded mean and mutation, zero XP, the `LineageBirth` record validates, a duplicate request and a restart create no twin, a failed kit handoff leaves `failed` then retryable, lineage off refuses, and a scan of the kit-side child workspace and environment contains none of the 13 scores (HC-26's test is the kit evidence).
- **checks:** CK-BASE (`--filter @geldar/mcp-tokens`); `./geldar.ps1 pnpm test lineage-query`; Docker build of `tools/admin/Dockerfile` with a frozen lockfile (ops); CK-IT; the live gate (ops, serial).
- **revert-checks:** R1 remove the `depth < 8` bound; the cycle-guard test (a fixture with a deliberately cyclic parent link is rejected by the table CHECK, and a depth-9 chain stops at 8) must fail. R2 default the flag to true when the key is absent; "omitted means off" must fail.
- **worknote:** `.../worknotes/AN-57.md`. **commit:** `feat(character): wire lineage on/off, the ancestry query and the admin image; record the two-path gate`. **on-cap:** common rule.

### GX-03: operator read of an owner's own life sheet (for the kit's launcher)

- **id:** GX-03 (new world card). **wave:** parallel lane (not wave-bound). **branch:** `codex/gx-03-sheet-read`. **status:** Writing.
- **purpose:** D-HC-03 says the world database is canonical and the kit holds a copy that only its supervisor reads. The launcher needs that copy at `geldar-play new` and on an explicit refresh. This card adds the **operator-authenticated read** the launcher flow calls (the operator runs it today, as for `token mint --out`). An owner-facing HTTP route is a different file set (below) and is **not** written here.
- **depends-on:** AN-04 (`agents.character_sheet`, `life_proficiency`), AN-05 (adoption), AN-58b if it is merged first (the function reads `effective_sheet()`; AN-54b creates it).
- **may-edit:** `sql/SQL-<allocate via registry>_operator_sheet_read.sql` (new); `sql/test/check-schema-sheet-read.sql` (new); `.github/workflows/ci.yml` (one `-f` argument, `(to confirm with the geldar orchestrator)`); `tools/mcp-tokens/src/sheet-read.ts` (new); `tools/mcp-tokens/src/sheet-cli.ts` (new, standalone like `lineage-cli.ts`); `tools/mcp-tokens/src/sheet-read.test.ts`, `sheet-cli.test.ts` (new); `tools/admin/admin.sh` (one `sheet` case `(to confirm with the geldar orchestrator: shared with C7 and AN-57)`); `docs/runbooks/sheet-read.md` (new); `docs/decisions/ADR-<allocate via registry>-sheet-read-path.md` (new); the worknote.
- **must-not-edit:** always list. Explicitly **none of the geldar-registration files**: `threshold/register/**` (owner API, owner keys, `server.ts`, `account.ts`), `sql/0008` to `0012`, `0021`, `0022`, `0025`, `0026`, `0032`, any `register_*` function, `tools/mcp-tokens/src/cli.ts`, `tokens.ts`, `identities.ts`, `owner-admin.ts`, `owners.ts`; and nothing under `threshold/mcp/**` (the player's MCP service). The function writes `register_audit` (created by 0025) the way `operator_set_player_flags` (0034) already does; that one table write is the only contact and is `(to confirm with the geldar orchestrator)`.
- **decisions:** D-HC-03 (sheet canonical in the world DB), D-CS-03 (immutable baseline plus revisions), ADR `<allocate via registry>`.
- **size:** about 45k.
- **Deliver (SQL shape):**
```sql
CREATE FUNCTION operator_read_life_sheet(p_owner_id TEXT, p_life_id TEXT)
  RETURNS TABLE (code TEXT, payload JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$ ... $$;
-- codes: ok | unknown-life | wrong-owner | retired-life | no-sheet
-- payload (only with ok): {"format_version":1,"life_id":..,"effective_revision":N,
--   "baseline":{attributes,alignment,op_modes},"effective":{attributes,alignment,op_modes},
--   "proficiency":{"combat":{"level":0,"xp":0},..7 domains},"harness":..,"declared_model":..}
-- one register_audit row per call: actor 'operator', action 'sheet.read', target the life id,
--   outcome ok|refused, detail = the code. Never the values.
REVOKE ALL ON FUNCTION operator_read_life_sheet(TEXT, TEXT) FROM PUBLIC;
DO $g$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar') THEN
  GRANT EXECUTE ON FUNCTION operator_read_life_sheet(TEXT, TEXT) TO geldar; END IF; END $g$;
```
  Ownership is `agents.owner = p_owner_id`; retirement is `mcp_players.status = 'retired'`. `no-sheet` (a life that predates adoption) tells the kit to use the standard sheet. The TS side: `readLifeSheet(sql, owner, life): Promise<{code:'ok', copy: SheetCopy} | {code: Refusal}>`, `SheetCopy` validated with AN-03's `normalizeSheet` `(to confirm)` (no contract shape, so no contract card; Open items 6). `sheet-cli.ts`: `sheet show <life> --owner <o> --out <file>` writes the JSON with the owner-only mode via the repo helper used by `token mint --out` (`checkOutPath` in `tokens.ts`, imported, not edited; refuses an existing file) and prints only `wrote <path> revision <n>`; never a score on stdout or stderr. A refresh is the same command run again; the kit compares `effective_revision`.
  **Never reachable by the player's own MCP token, three layers.** (1) `geldar_mcp`, `geldar_register`, `geldar_glass` have no EXECUTE on the function. (2) `geldar_mcp` cannot SELECT the column: **`sql/0002_sovereign_mcp.sql` line 89 grants `SELECT ON agents` table-wide to `geldar_mcp`, so a new column is readable by that role** unless the table-level grant is replaced. The test below asserts it; if AN-04 did not already fix this (check its migration first), this card adds, in its migration, `REVOKE SELECT ON agents FROM geldar_mcp; GRANT SELECT (agent_id, name, game_account, personality_seed, born_day, died_at, last_sleep_day) ON agents TO geldar_mcp;` with the column list taken from the queries in `threshold/mcp/src/store/pg-agents.ts` (re-grep `threshold/mcp/src` for `agents` before writing it) `(to confirm with geldar-a AN-04 and the orchestrator: it replaces an existing grant)`. (3) No MCP tool or result field can carry it: a test in `sheet-read.test.ts` imports `MCP_TOOL_NAMES` from `@geldar/contract` and fails if any name matches `/sheet|character|proficiency/`, and scans `contract/schemas/mcp-*.schema.json` read-only for the same words.
- **Owner-authenticated route (not in this card).** `GX-03b`, **BlockedDependency**: it needs the C7-04 owner API route tree (`threshold/register`, blocked at C7-04a/C7-04b) and a new `register_`-prefixed definer function in the registration migration series, both owned by the geldar-registration work. The request for the geldar orchestrator is: "add `GET /v1/agents/{life}/sheet` (scope `read`) that calls a definer wrapper over `operator_read_life_sheet`". This card's function is shaped so the wrapper is thin.
- **checks:** CK-SQL; `./geldar.ps1 pnpm test sheet-read sheet-cli`. SQL steps: `ok` for the owner's own life with revision 0; `wrong-owner`, `unknown-life`, `retired-life`, `no-sheet`; the audit row exists for each and contains no score; `has_function_privilege` false for the three non-operator roles; `has_column_privilege('geldar_mcp','agents','character_sheet','SELECT')` false; the payload revision equals `effective_sheet(life).revision` (so after AN-58b a drifted life returns its new revision, which is how the kit sees a drift).
- **revert-checks:** R1 `GRANT EXECUTE ... TO geldar_mcp`; the privilege step must fail. R2 drop the owner comparison; the `wrong-owner` step must fail. R3 add a `character` tool name to a copy of the tool list in the test; the name-scan test must fail.
- **worknote:** `.../worknotes/GX-03.md`. **commit:** `feat(character): add the operator read of an owner's own life sheet (never granted to the MCP role)`. **on-cap:** common rule.

---

## W11: drift (default off)

All W11 behaviour is D-CS-13 recommended, assumed, unmeasured. The evidence is **behaviour-based**: it reads what the life did (recorded events and unique evidence rows), never a random roll surplus. There is no random draw in drift at all, so "false flag performs no change or RNG consumption" holds by construction.

### AN-58a: drift contract and policy config

- **id:** AN-58a (UNBLOCKER). **wave:** W11. **branch:** `codex/an-58a-drift-contract`. **status:** Writing.
- **depends-on:** AN-57 (wave order; hard prerequisites AN-54a, AN-02), D-CS-13 accepted (assumed).
- **may-edit:** `contract/schemas/sheet-revision.schema.json` (new, title `SheetRevision`); `contract/schemas/drift-evaluation.schema.json` (new, title `DriftEvaluation`); `contract/schemas/character-config.schema.json` (extend the `drift` object; **name is AN-02's `(to confirm)`**); `contract/src/subjects.ts` (add `lifeSheetSubject`, 137 lines now); `contract/src/index.ts` (block `// --- AN-58 drift ---`); `contract/test/drift.test.ts`, `contract/test/life-sheet-subject.test.ts` (new); `contract/src/generated/**` (regenerate); `docs/decisions/ADR-<allocate via registry>-behaviour-based-drift.md` (new); the worknote.
- **must-not-edit:** always list; the `LifeId` pattern; `contract/schemas/shard-config.schema.json` (it is the Colo compose keys, not the `character` block).
- **decisions:** D-CS-13. ADR records: behaviour-based criterion; default off; fields limited to the six attributes and alignment (**op-mode weights and evidence-free fields are never eligible**); window 168000 ticks; one point per field per window; immutable baseline.
- **size:** about 40k.
- **Deliver (shapes):**
```ts
// contract/src/subjects.ts (five tokens, so outside the sink's geldar.*.* filter)
/** `geldar.<shard>.life.<life_id>.sheet`: eventsink publishes a SheetRevision; the Body listens. */
export function lifeSheetSubject(shard: string, lifeId: string): string {
  checked(shard, lifeId); return `geldar.${shard}.life.${lifeId}.sheet`; }
```
  **Why not `geldar.<shard>.body.<life>.…`:** in `geldar.ps1` the `mcp` role may publish `geldar.<s>.body.>` and the `mind` role too, so a sheet subject under `body` could be forged by the player's own MCP server. `life` is outside both allow lists; AN-60a denies it to `body` and `paper` publishing.
```jsonc
// SheetRevision: {version:1, life_id, revision>=1, previous_revision>=0, window_index>=0, applied_tick,
//   effective: InnateSheet (13 scores, no proficiency), changes: [{field(6 enum), from, to}] (max 6, from/to differ by exactly 1)}
// DriftEvaluation: {version:1, life_id, window_index, window_start_tick, window_end_tick, trigger: "sleep"|"operator",
//   eligible, ineligible_reason?: "drift_off"|"incomplete_window"|"audit_gap"|"no_eligible_fields",
//   fields: [{field, samples, rate|null, implied|null, current, decision: "up"|"down"|"none",
//             reason: "ok"|"few_samples"|"within_margin"|"no_rule"|"clamped"}], applied_revision?}
```
  Config (unmeasured placeholders, every one named in the ADR as such):
```yaml
character:
  drift:
    enabled: false           # omitted means false. enabled: true needs a non-empty fields map
    window_ticks: 168000     # const; 7 in-game days of 24000 ticks
    max_step: 1              # const 1: one point per field per window
    min_samples: 20          # opportunities needed in a window
    margin: 2                # implied band must differ from the current score by at least this
    fields:                  # only the 6 attribute/alignment names; any other key is rejected
      curiosity: { evidence: first_visit_share, cut_points: [0.05, 0.15, 0.30, 0.50] }
```
  `evidence` is an enum with the single value `first_visit_share` until the owner rules another (AN-59a). `cut_points` is exactly four ascending numbers in [0, 1].
- **checks:** CK-CONTRACT. Tests: `lifeSheetSubject` returns the five-token subject and throws on a bad shard, a bad life id, `lf_x_01` and a dot or wildcard in either token; the subject never matches `geldar.*.*`; `SheetRevision` rejects revision 0, a `changes` item that moves 2 points, a field outside the six, `proficiency` in `effective`; the config accepts the omitted block, `enabled: false` with `fields` present, and rejects `enabled: true` with no fields, `window_ticks: 100`, `max_step: 2`, an op-mode field `explorer`, unsorted cut points and an unknown `evidence`.
- **revert-checks:** R1 change `window_ticks` const to a free integer; "window_ticks 100 is rejected" must fail. R2 add `explorer` to the field enum; "op-mode field rejected" must fail.
- **worknote:** `.../worknotes/AN-58a.md`. **commit:** `feat(character): add the drift contract, the life sheet subject and the default-off policy config`. **on-cap:** common rule.

### AN-58b: drift SQL

- **id:** AN-58b. **wave:** W11. **branch:** `codex/an-58b-drift-sql`. **status:** Writing.
- **depends-on:** AN-58a, AN-54b.
- **may-edit:** `sql/SQL-<allocate via registry>_drift.sql` (new); `sql/test/check-schema-drift.sql` (new); `.github/workflows/ci.yml` (one `-f` argument, `(to confirm)`); the worknote.
- **must-not-edit:** always list; the baseline column's definition (AN-04's); migrations 0001 to 0034.
- **decisions:** D-CS-13, D-CS-03, D-CS-07.
- **size:** about 45k.
- **Deliver (SQL shape):**
```sql
CREATE TABLE drift_state (life_id TEXT PRIMARY KEY REFERENCES agents (agent_id),
  origin_tick BIGINT NOT NULL CHECK (origin_tick >= 0),   -- window 0 starts here; set once at the first evaluation
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE sheet_revisions (
  life_id TEXT NOT NULL REFERENCES agents (agent_id), revision INT NOT NULL CHECK (revision >= 1),
  window_index INT NOT NULL CHECK (window_index >= 0), applied_tick BIGINT NOT NULL,
  sheet JSONB NOT NULL CHECK (NOT (sheet ? 'proficiency') AND lineage_scores_ok(sheet)),
  changes JSONB NOT NULL, PRIMARY KEY (life_id, revision), UNIQUE (life_id, window_index));
CREATE TABLE drift_evaluations (
  life_id TEXT NOT NULL REFERENCES agents (agent_id), window_index INT NOT NULL CHECK (window_index >= 0),
  window_start_tick BIGINT NOT NULL, window_end_tick BIGINT NOT NULL CHECK (window_end_tick - window_start_tick = 168000),
  trigger TEXT NOT NULL CHECK (trigger IN ('sleep','operator')), eligible BOOLEAN NOT NULL,
  ineligible_reason TEXT CHECK (ineligible_reason IN ('drift_off','incomplete_window','audit_gap','no_eligible_fields')),
  fields JSONB NOT NULL, applied_revision INT, evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (life_id, window_index),                    -- one evaluation per life per window: the cooldown
  FOREIGN KEY (life_id, applied_revision) REFERENCES sheet_revisions (life_id, revision));
CREATE TABLE sheet_publish_outbox (life_id TEXT NOT NULL, revision INT NOT NULL, published_at TIMESTAMPTZ,
  PRIMARY KEY (life_id, revision), FOREIGN KEY (life_id, revision) REFERENCES sheet_revisions (life_id, revision));
CREATE OR REPLACE FUNCTION effective_sheet(p_life_id TEXT) RETURNS TABLE (revision INT, sheet JSONB)
  LANGUAGE sql STABLE AS $$ (SELECT r.revision, r.sheet FROM public.sheet_revisions r
      WHERE r.life_id = p_life_id ORDER BY r.revision DESC LIMIT 1)
    UNION ALL (SELECT 0, a.character_sheet FROM public.agents a WHERE a.agent_id = p_life_id
      AND a.character_sheet IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sheet_revisions r WHERE r.life_id = p_life_id)) $$;
-- append-only triggers (journal_append_only) on sheet_revisions and drift_evaluations; the outbox is the only mutable table
-- agents.character_sheet immutable once set: BEFORE UPDATE OF character_sheet raising check_violation when OLD is not NULL and NEW differs (skip if AN-04 already has it)
-- REVOKE ALL FROM PUBLIC on all four; GRANT SELECT to the operator role geldar; nothing to geldar_mcp, geldar_register, geldar_glass
```
- **checks:** CK-SQL. `check-schema-drift.sql`: a second evaluation for the same window refused; a revision gap and a duplicate window refused (`UNIQUE (life_id, window_index)`); `window_end - window_start <> 168000` refused; a score 6 refused; `effective_sheet` returns the baseline at revision 0, the latest at revision 2, and exactly one row in each case; UPDATE and DELETE on `sheet_revisions` and `drift_evaluations` refused; an UPDATE of the baseline refused; privileges denied to the three roles.
- **revert-checks:** R1 drop `PRIMARY KEY (life_id, window_index)` on `drift_evaluations`; the duplicate-window step must fail. R2 drop the baseline-immutability trigger; the UPDATE step must fail. R3 drop the `ORDER BY revision DESC` of `effective_sheet`; the "latest" step must fail.
- **worknote:** `.../worknotes/AN-58b.md`. **commit:** `feat(character): add the drift tables, the outbox and the revision-aware effective_sheet()`. **on-cap:** common rule.

### AN-59a: window math and evidence readers

- **id:** AN-59a (world-side evidence only). **wave:** W11. **branch:** `codex/an-59a-drift-windows`. **status:** Writing (`xp_evidence` columns `(to confirm)` with AN-04 and AN-09; `audit_gaps` with AN-06).
- **depends-on:** AN-58b, AN-09.
- **may-edit:** `psyche/src/drift/window.ts` and `window.test.ts` (new, pure); `eventsink/src/drift/evidence.ts` (new), `evidence.test.ts` (fake client), `evidence.it.test.ts` (new, gated by `GELDAR_IT`); `psyche/src/index.ts` (one export line, W11 serial editor); `eventsink/package.json` only if it lacks `@geldar/psyche` (then this card is the W11 manifest owner); the worknote.
- **must-not-edit:** always list; any read of another life's actual score; `animus/**`.
- **decisions:** D-CS-13, D-CS-07 (missing or gapped audit makes a window ineligible, never "no change").
- **size:** about 45k.
- **Deliver (signatures and SQL):**
```ts
export const WORLD_TICKS_PER_DAY = 24_000; export const DRIFT_WINDOW_TICKS = 168_000;
export interface DriftWindow { index: number; startTick: number; endTick: number }       // [start, end)
export function windowAt(originTick: number, tick: number): DriftWindow;                  // tick == end belongs to the next window
export function completedWindows(originTick: number, nowTick: number): DriftWindow[];     // those with endTick <= nowTick
export function nextToEvaluate(lastEvaluated: number | null, originTick: number, nowTick: number): DriftWindow | null;
// eventsink/src/drift/evidence.ts
export interface FieldEvidence { field: DriftField; successes: number; opportunities: number; auditGaps: number }
export async function readEvidence(db: Queryable, lifeId: string, w: DriftWindow): Promise<FieldEvidence[]>;
```
  `first_visit_share` for `curiosity`. Opportunities are the life's completed `goto` actions in the window, read from the **`events` table** (the `actions` table has no completion tick, the `action` event row does):
```sql
SELECT count(*) FROM events WHERE type = 'action' AND agent_id = $1
  AND world_tick >= $2 AND world_tick < $3
  AND payload->>'kind' = 'goto' AND payload->>'state' = 'completed';
```
  Successes are the life's first-visit chunk evidence rows in the window, `SELECT count(*) FROM xp_evidence WHERE life_id=$1 AND domain='exploring' AND world_tick >= $2 AND world_tick < $3` `(to confirm names)`. `successes` is clamped to `opportunities` (a first visit can follow a non-goto move; the rate never exceeds 1). `auditGaps` counts `audit_gaps` rows overlapping the window `(to confirm)`. Counts come back from `pg` as strings; the reader converts with `Number` and refuses a value above `Number.MAX_SAFE_INTEGER`. **Roll audit rows (`character_decisions`) are never read here**; the module imports no roll type.
- **checks:** CK-BASE (`--filter @geldar/psyche`, `--filter @geldar/eventsink`); `./geldar.ps1 pnpm test psyche/src/drift/window eventsink/src/drift/evidence`; CK-IT for the `.it.test.ts`. Window tests: tick `origin + 167999` is window 0, `origin + 168000` is window 1; a window is complete at exactly `endTick`; origin 0 and a large origin; `nextToEvaluate` after a gap returns the oldest unevaluated completed window; overlapping and repeated calls return the same window. Evidence tests: just below, at and above `min_samples` are the next card's; here counts only: boundary ticks included and excluded correctly; a failed `goto` and a different life's `goto` are not counted; lucky roll rows in the fixture contribute nothing.
- **revert-checks:** R1 change `<` to `<=` on the window end; the boundary test must fail. R2 count `state = 'accepted'` as well as `completed`; the "failed or accepted goto not counted" test must fail.
- **worknote:** `.../worknotes/AN-59a.md`. **commit:** `feat(character): add the 168000-tick window math and the world-side drift evidence readers`. **on-cap:** common rule.

### AN-59b: rule, decision and eligibility

- **id:** AN-59b. **wave:** W11. **branch:** `codex/an-59b-drift-eligibility`. **status:** Writing.
- **depends-on:** AN-59a.
- **may-edit:** `psyche/src/drift/rules.ts`, `psyche/src/drift/evaluate.ts` and their tests (new, pure); `psyche/src/index.ts` (one export line); the worknote.
- **must-not-edit:** always list; SQL; eventsink.
- **decisions:** D-CS-13. **Only `curiosity` has a rule.** The other five eligible names stay `no_rule` (no change) until the owner supplies an observable per-field rule; adding one is a new rule row, a test and a ruling, not a coder choice (Open items 3).
- **size:** about 40k.
- **Deliver (signatures):**
```ts
export interface FieldRule { field: DriftField; evidence: 'first_visit_share';
  cutPoints: [number, number, number, number]; minSamples: number; margin: number }
export function impliedScore(rate: number, cutPoints: readonly number[]): Score; // rate < c1 -> 1, < c2 -> 2, < c3 -> 3, < c4 -> 4, else 5
export function decideField(rule: FieldRule | undefined, current: Score, ev: FieldEvidence): FieldDecision;
  // no rule -> none/no_rule; opportunities < minSamples -> none/few_samples;
  // |implied - current| < margin -> none/within_margin; else step one point toward implied (clamped: none/clamped)
export function evaluateWindow(input: { enabled: boolean; window: DriftWindow; nowTick: number;
  current: InnateSheet; rules: Record<string, FieldRule>; evidence: FieldEvidence[] }): WindowEvaluation;
  // not enabled -> eligible:false drift_off; nowTick < window.endTick -> incomplete_window;
  // any auditGaps > 0 -> audit_gap (no change); no field with a rule -> no_eligible_fields
```
- **checks:** CK-BASE; `./geldar.ps1 pnpm test psyche/src/drift`. Tests: `impliedScore` at every cut point and just either side; `decideField` at `min_samples - 1`, `min_samples`, `min_samples + 1`; the margin at gap 1 (none), 2 (moves) and 3 (moves one point only); score 5 with implied 5 and score 1 with implied 1 (none); score 5 pushed up (`clamped`); a field with no rule never changes; an unsupported evidence name is not accepted; a window with a gap is `audit_gap` even when the rate is extreme; **a fixture of 100 lucky d20 audit rows and no behaviour rows yields no sample**; disabled returns `drift_off` and does not read the evidence argument (spy).
- **revert-checks:** R1 change `<` to `<=` on `minSamples`; the "min_samples - 1" test must fail. R2 let the step be `implied - current`; the "one point only" test must fail. R3 ignore `auditGaps`; the gap test must fail.
- **worknote:** `.../worknotes/AN-59b.md`. **commit:** `feat(character): add the behaviour-based drift rule, decision and eligibility (curiosity only)`. **on-cap:** common rule.

### AN-43: bounded drift transition and revision record

- **id:** AN-43. **wave:** W11. **branch:** `codex/an-43-drift-transition`. **status:** Writing.
- **depends-on:** AN-59b.
- **may-edit:** `eventsink/src/drift/apply.ts`, `eventsink/src/drift/store.ts` (the SQL strings) and `apply.test.ts` (fake), `apply.it.test.ts` (gated by `GELDAR_IT`) (new); the worknote.
- **must-not-edit:** always list; `eventsink/src/writer.ts`, `main.ts` (AN-60a wires); `agents.character_sheet` is **never written**.
- **decisions:** D-CS-13 (per-field cap, window reuse refused, proficiency untouched).
- **size:** about 45k.
- **Deliver (signature):**
```ts
export type ApplyOutcome =
  | { code: 'applied'; revision: number; changes: Change[] }
  | { code: 'no_change'; evaluation: DriftEvaluation }
  | { code: 'duplicate_window' | 'stale_revision' | 'drift_off' | 'incomplete_window' };
export async function evaluateAndApply(pool: Pool, cfg: DriftPolicy,
  req: { lifeId: string; trigger: 'sleep' | 'operator'; nowTick: number }): Promise<ApplyOutcome>;
```
  One transaction: lock `SELECT ... FROM agents WHERE agent_id = $1 FOR UPDATE` (serialises concurrent sleeps and a restart); read `effective_sheet`; create `drift_state` at the first call with `origin_tick = COALESCE(lineage_births.born_world_tick, AN-04's adoption tick, nowTick)` `(to confirm AN-04 field)`; take `nextToEvaluate`; if a `drift_evaluations` row exists return `duplicate_window`; read evidence (AN-59a) and `evaluateWindow`; INSERT the `drift_evaluations` row; if any decision moved, INSERT `sheet_revisions` (revision = previous + 1, a copy of the effective sheet with each moved field changed by exactly one and clamped to 1..5, `changes` listing them) and `sheet_publish_outbox`, set `applied_revision`; commit. `expectedRevision` read at the start must equal the effective revision at the insert, else `stale_revision` and nothing written. Proficiency tables and `agents.character_sheet` are not touched.
- **checks:** CK-BASE (`--filter @geldar/eventsink`); `./geldar.ps1 pnpm test eventsink/src/drift/apply`; CK-IT. Tests: clamp at 1 and at 5; same window twice returns `duplicate_window` and changes nothing; two concurrent calls (real database) produce one evaluation and at most one revision; restart between two calls (new pool) does not re-apply; a publication failure after commit leaves the outbox row unpublished (AN-60a retries); a stale revision refused; baseline column unchanged after three windows; the proficiency rows byte-equal before and after; with `enabled: false` no row is written and no query other than the config check runs; a gapped window records an ineligible evaluation and does not move any field.
- **revert-checks:** R1 remove the `FOR UPDATE` lock; the concurrent-call IT must fail. R2 remove the existing-evaluation check; "same window twice" must fail. R3 allow `step = 2`; the "exactly one point" test must fail.
- **worknote:** `.../worknotes/AN-43.md`. **commit:** `feat(character): add the atomic drift transition (one point per field per window, immutable baseline)`. **on-cap:** common rule.

### AN-60a: revision publication, sleep trigger and ACL (eventsink side, world half of AN-60)

- **id:** AN-60a. **wave:** W11. **branch:** `codex/an-60a-drift-publish`. **status:** Writing (the eventsink config route is AN-07's `(to confirm)`).
- **depends-on:** AN-43, AN-11 (the life-state request handler this card extends).
- **may-edit:** `eventsink/src/drift/publish.ts`, `eventsink/src/drift/trigger.ts` and tests (new); `eventsink/src/writer.ts` (an optional `onCommitted(events)` hook, 79 lines now); `eventsink/src/main.ts` (wiring, 76 lines); AN-11's life-state handler file `(to confirm path)` so its reply carries `effective_revision` and the effective scores; `geldar.ps1` (NATS user table only: `eventsink` Pub `geldar.$s.life.*.sheet`; `body` Sub the same; `body` and `paper` PubDeny `geldar.$s.life.>`; the `mcp` and `mind` rows unchanged); `tools/repo-checks/src/nats-auth.test.ts` (rows for the new subject); the worknote. Live test `threshold/mcp/test/nats-auth.it.test.ts` is added to by ops, not the coder.
- **must-not-edit:** always list; `contract/**` (AN-58a), `eventsink/src/projection.ts`.
- **decisions:** D-CS-13 (trigger), D-CS-07. **Trigger boundary (Open items 2):** the world observes a **completed `sleep` action** (an `action` event whose `payload.kind = 'sleep'` and `state = 'completed'`, a world fact for every life whatever its harness) and evaluates after the batch commit. The kit card HC-36 does **not** call evaluation; it notices a changed `effective_revision` (via GX-03) and builds the persona refresh artifact. If the owner wants the kit to be the only trigger, GX-03 would need an `--evaluate` mode, which is not specified here.
- **size:** about 50k.
- **Deliver:**
```ts
// publish.ts: drains sheet_publish_outbox where published_at IS NULL, oldest first
export async function publishPending(pool: Pool, nc: NatsLike, shard: string): Promise<number>;
//   per row: build SheetRevision from sheet_revisions, validateSheetRevision, nc.publish(lifeSheetSubject(shard, life), json),
//   await nc.flush(), then UPDATE sheet_publish_outbox SET published_at = now(). A throw leaves the row unpublished.
// trigger.ts: for each committed action event with kind sleep and state completed -> evaluateAndApply({trigger:'sleep'}),
//   run after COMMIT with try/catch and a metric; a failure is retried at the next sleep; idempotent by window.
```
  A 30-second reconcile timer calls `publishPending`; the Body's startup request (AN-11 handler, now with the effective revision) covers any publication it missed. The drift flag reaches eventsink through whatever AN-07 gave it; if nothing exists, one variable `GELDAR_CHARACTER_DRIFT=on` documented in `eventsink/README.md` `(to confirm)`.
- **checks:** CK-BASE (`--filter @geldar/eventsink`); `./geldar.ps1 pnpm test eventsink/src/drift tools/repo-checks/src/nats-auth`. Tests: publish failure then success leaves exactly one `published_at` and one message; an unpublished row survives a restart and is published; a non-sleep or non-completed action event never triggers; a sleep event for a life with drift off does nothing; the post-commit hook error does not fail the batch; repo-check rows assert `mcp` and `mind` have no publish right on `geldar.<s>.life.>` and `body` and `paper` are denied. CK-IT with real NATS roles (ops, denied-role cases): the `mcp` user cannot publish to the subject and cannot subscribe; the Body user can subscribe and cannot publish.
- **revert-checks:** R1 mark the row published before `flush()`; the failed-publish test must fail. R2 remove the `state = 'completed'` test; "an accepted sleep does not trigger" must fail. R3 remove `PubDeny` for `body` in `geldar.ps1`; the repo-check row must fail.
- **worknote:** `.../worknotes/AN-60a.md`. **commit:** `feat(character): publish effective-sheet revisions from eventsink and trigger drift on a completed sleep`. **on-cap:** common rule.

### AN-60b: Body cache reload (golem side, world half of AN-60)

- **id:** AN-60b. **wave:** W11. **branch:** `codex/an-60b-drift-body`. **status:** Writing (AN-11 and AN-12 module names `(to confirm)`).
- **depends-on:** AN-58a, AN-11, AN-12.
- **may-edit:** `golem/src/body/effective-sheet.ts`, `golem/src/body/sheet-link.ts` and tests (new); `golem/src/adam/adam-body.ts` (wiring, 293 lines now); `golem/src/players/main.ts` (wiring, 224 lines); AN-12's profile port file `(to confirm path)` so threat reads the cache; the worknote.
- **must-not-edit:** always list; `golem/src/body/reflexes/fight-or-flee.ts` and `retreat.ts` (AN-08's; this card changes only where scores come from).
- **decisions:** D-CS-13, D-CS-03.
- **size:** about 45k.
- **Deliver:**
```ts
export class EffectiveSheetCache {
  constructor(lifeId: string, initial: { revision: number; sheet: InnateSheet } | null);
  get(): { revision: number; sheet: InnateSheet } | null;     // null until the first state arrives (AN-11 degraded default applies)
  apply(rev: SheetRevision): boolean;                          // false when life differs or rev.revision <= current: monotonic, never downgrades
  onChange(listener: (r: { revision: number }) => void): () => void;
}
export function startSheetLink(env: { nc: NatsLike; shard: string; lifeId: string; cache: EffectiveSheetCache; log: (l: string) => void }): { stop(): void };
// subscribes lifeSheetSubject(shard, lifeId), validates with validateSheetRevision, applies; on (re)connect repeats AN-11's startup request
```
  The Body never serialises the cache into a snapshot, thought, MCP result or log line (logs carry the revision number only). A revision that arrives during an accepted encounter does not change that encounter's floor (AN-08 decides once per encounter); the next encounter uses it. A stopped link ignores late messages.
- **checks:** CK-BASE (`--filter @geldar/golem`); `./geldar.ps1 pnpm test golem/src/body/effective-sheet golem/src/body/sheet-link`. Tests: first/last/past-cap for the revision counter; stale and equal revisions ignored; another life's message ignored; invalid payload ignored with one log line; stop then late message ignored; reconnect re-requests; mid-encounter revision leaves the floor, the next encounter changes it; snapshot and log serialisation scans find no score. CK-IT (ops): publication reaches a real Body and the cache revision equals `effective_sheet()` in SQL; a Body restarted after a revision loads it from the startup request.
- **revert-checks:** R1 accept `revision <= current`; the downgrade test must fail. R2 drop the life-id check; the cross-life test must fail. R3 add the cache to the snapshot builder in a scratch edit; the serialisation scan must fail.
- **worknote:** `.../worknotes/AN-60b.md`. **commit:** `feat(character): reload the Body's effective sheet from published revisions (monotonic, own life only)`. **on-cap:** common rule.

---

## W12: measurement and close

D-CS-11 is assumed: four primary treatments (A off, B all 3s with d20 checks off, C all 3s with d20 on, D varied sheets with d20 on) plus matched on/off comparisons, **extended with harness (`claude`, `chatgpt`, `local`) and model as comparison dimensions** and hypotheses H7 to H9 of the v3 plan. Sizes of runs, seeds, spend and numeric bars are not chosen here (they go in `protocol.json`, accepted before any run).

**Harness and model at origin/main.** `agents.harness` and `agents.declared_model` exist per life (`sql/0001_init.sql`). The harness name is validated against `sovereign.harnesses` of the shard file (`tools/mcp-tokens/src/players.ts`); `claude` and `chatgpt` are enabled on the colo shard (ADR 0180), **`local` is enabled nowhere**, and the register service's own list defaults to `claude-code` (`REGISTER_HARNESSES`). The cohort tools treat harness as an opaque label, map `claude-code` to `claude`, and take per-event stamps from GX-01 `(to confirm field names)` when present, else from the life's `agents` row.

### AN-33a: export role and world exporter

- **id:** AN-33a. **wave:** W12. **branch:** `codex/an-33a-export-world`. **status:** Writing.
- **depends-on:** AN-60a, AN-54b, AN-58b (every table exported exists).
- **may-edit:** `tools/cohort-export/package.json`, `tsconfig.json` (new package `@geldar/cohort-export`; deps `pg` and `@types/pg` pinned exactly as `tools/mcp-tokens` does, `@geldar/contract` workspace; `./geldar.ps1 setup` writes the lockfile, sole W12 owner `pnpm-lock.yaml`); `tools/cohort-export/src/cli.ts`, `scope.ts`, `tables.ts`, `export.ts`, `manifest.ts`, `write.ts` and tests (new); `sql/SQL-<allocate via registry>_exporter_role.sql` (new); `sql/test/check-schema-exporter.sql` (new); `.github/workflows/ci.yml` (one `-f` argument, `(to confirm)`); `docs/decisions/ADR-<allocate via registry>-cohort-export-and-protocol.md` (new); `docs/runbooks/cohort-export.md` (new); the worknote.
- **must-not-edit:** always list; `tools/progress-metrics/**` (reads files only, kept DB-free); `tools/admin/**` (the exporter runs from the operator's checkout with `PG*` set, not in the admin image).
- **decisions:** D-CS-11, D-CS-07.
- **size:** about 50k.
- **Deliver.** Role (no login; the operator grants it to the export user):
```sql
CREATE ROLE geldar_exporter NOLOGIN;  -- guarded by pg_roles check
GRANT SELECT (source_event_id, at, world_day, world_tick, type, agent_id, thinker_id, payload) ON events TO geldar_exporter;
GRANT SELECT (agent_id, shard, mode, harness, declared_model, born_day, died_at, death_cause, parent_a, parent_b, character_sheet) ON agents TO geldar_exporter;
GRANT SELECT ON lineage_births, sheet_revisions, drift_evaluations, life_proficiency, xp_evidence, character_decisions, audit_gaps TO geldar_exporter;
-- never granted: agents.owner, thoughts.model_input, mcp_journal, mcp_tokens, mcp_owners, mcp_identities, register_audit, personality_seed
```
  Run folder `<out>/<run-id>/` (refuses an existing folder), files mode 0600, NDJSON, one object per line: `manifest.json`; `public/events.ndjson` (event facts; no owner link); `owner/lives.ndjson` (`life_id`, `harness`, `declared_model`, `mode`; the owner id is never selected); `private/sheets.ndjson` (baseline and every revision, true scores, **offline scoring only**), `private/lineage.ndjson`, `private/drift.ndjson`, `private/decisions.ndjson` (roll audit with scores), `private/proficiency.ndjson`. Scope flags: `--run-id`, `--lives <ids|file>`, `--since-tick`, `--until-tick`, `--max-rows` (default 1,000,000 per table; **exceeding it fails the run, it never truncates silently**). The session is `BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ` with `default_transaction_read_only = on`; every statement is a `SELECT`. The manifest records `export_format_version: 1`, code git SHA, schema and migration versions, scope, row counts per file, sha256 per file, the audit coverage (`audit_gaps` count in scope and `complete: boolean`) and every excluded table by name.
- **checks:** CK-BASE (`--filter @geldar/cohort-export`), CK-SQL, `./geldar.ps1 pnpm test cohort-export`; CK-IT (ops): real read-role denial cases (a write through the export connection fails; `SELECT owner FROM agents` fails; `SELECT model_input FROM thoughts` fails). Unit tests: a spy asserts every statement text starts with `SELECT` or `BEGIN READ ONLY`; a life outside `--lives` yields no row; the row bound fails the run with a clear code; no output file contains the string of an owner id from the fixture; public files contain no `character_sheet` key; an existing run folder is refused; the manifest marks `complete: false` when a gap exists.
- **revert-checks:** R1 add `owner` to the `agents` column list of `tables.ts`; "no owner id in any output" must fail. R2 remove the read-only transaction; the write-denial test must fail. R3 replace the row-bound failure by `LIMIT`; "exceeding the bound fails" must fail.
- **worknote:** `.../worknotes/AN-33a.md`. **commit:** `feat(character): add the operator cohort exporter and its read-only role (bounded, scoped, public/owner/private split)`. **on-cap:** common rule.

### AN-33b: ingest of the kit's exported ledgers

- **id:** AN-33b. **wave:** W12. **branch:** `codex/an-33b-ingest-kit`. **status:** **BlockedDependency** on HC-37's file layout (kit card, [kit C](work-packets-kit-c.md)). The shapes below are the assumption; the card is `Writing` as soon as HC-37 names its files.
- **depends-on:** AN-33a, HC-37.
- **may-edit:** `tools/cohort-export/src/ingest-kit.ts` and `.test.ts` (new); a one-line registration in `tools/cohort-export/src/cli.ts` (AN-33a's file, serial); `tools/cohort-export/fixtures/kit/` (new synthetic ledgers, labelled synthetic); the worknote.
- **must-not-edit:** always list; the kit repo; any DB access (this step reads files).
- **decisions:** D-HC-04 (the kit keeps `instinct.jsonl` and its audit in the supervisor volume), D-CS-11.
- **size:** about 40k.
- **Deliver.** `cohort-export ingest --run <dir> --kit <dir>`; the kit export directory is `manifest.json` (`format_version`, `player_id`, `life_id`, `harness`, `model`, `declared_model`, `sheet_hash`, `arm`, `files[]`) plus `instinct.jsonl`, the token and turn meter `meter.jsonl` (HC-03 name `(to confirm)`), and optionally `estimates.jsonl` `(to confirm HC-27 to HC-30 export)`. Validation: every line parses as one JSON object with a matching `life_id` and an ISO `at`; harness and model stamps present (else the file is listed `unstamped`, kept, and a warning goes in the manifest); a stamp that disagrees with `owner/lives.ndjson` for that life is a warning. Files are copied to `private/kit/<life_id>/` (they hold rolls and scores) with sha256 and line counts recorded in `manifest.json` under `kit_ledgers`. Nothing is joined to an owner.
- **checks:** CK-BASE; `./geldar.ps1 pnpm test cohort-export`. Tests: a valid ledger ingests with counts; an unparsable line fails the ingest naming the line number and not its content; a `life_id` mismatch fails; an unstamped file warns; a stamp mismatch warns; an existing destination is refused; the manifest hash changes when one line changes.
- **revert-checks:** R1 skip the `life_id` match; the mismatch test must fail. R2 copy the files to `public/`; the "kit files only under private" test must fail.
- **worknote:** `.../worknotes/AN-33b.md`. **commit:** `feat(character): ingest the kit's exported ledgers into a cohort run folder`. **on-cap:** common rule.

### AN-34a: cohort metrics core

- **id:** AN-34a. **wave:** W12. **branch:** `codex/an-34a-metrics-core`. **status:** Writing.
- **depends-on:** AN-33a (run folder format).
- **may-edit:** `tools/progress-metrics/src/cohort/read.ts`, `jsd.ts`, `programs.ts`, `survival.ts`, `xp.ts`, `audit.ts`, `cost.ts` and `*.test.ts` (new); `tools/progress-metrics/fixtures/cohort/` (new synthetic run folders); the worknote.
- **must-not-edit:** always list; the existing `src/cli.ts`, `aggregate.ts`, `render.ts` (existing inputs and results stay supported, untouched); any database or network access.
- **decisions:** D-CS-11.
- **size:** about 50k.
- **Deliver (signatures):**
```ts
export function jensenShannon(p: ReadonlyMap<string, number>, q: ReadonlyMap<string, number>): number | null;
// base 2, in [0,1]; identical -> 0; disjoint -> 1; either side empty (all zero) -> null ("insufficient data"), never 0
export function programDistribution(events: PublicEvent[], lifeId: string): Map<string, number>;   // accepted intents by program
export function pairwiseJsd(dists: Map<string, Map<string, number>>): { mean: number | null; pairs: number };
export function survival(events: PublicEvent[], lives: LifeRow[], byTick: number): { born: number; died: number; denominator: number };
export function xpAudit(evidence: EvidenceRow[]): { byDomain: Record<string, number>; unique: number; duplicates: string[] };
export function auditCompleteness(manifest: Manifest): { complete: boolean; gaps: number };       // incomplete => the run is incomplete, never "clean"
export function callCost(sovereignCalls: number, kitTurns: KitMeterRow[] | null, usefulMinutes: number | null): CostRow;
// every invalid-call retry in the meter counts as a call; unknown useful minutes -> ratio null
```
  Food and shelter by a fixed day are **not available from world records**: the report prints them `unsupported`. Fight/flee health by sheet and moral/trust measures read private files and are `insufficient data` when absent; none is inferred.
- **checks:** CK-BASE (`--filter @geldar/progress-metrics`); `./geldar.ps1 pnpm test progress-metrics/src/cohort`. Tests with hand-calculable values: p = {a:1,b:1}, q = {a:1,b:1} gives 0; disjoint gives 1; p = {a:1}, q = {a:1,b:1} gives the hand value; empty gives null; mean of three pairs; survival denominators; duplicated evidence key reported; incomplete audit marks the run incomplete; every retry counted; existing `progress-metrics` tests untouched and passing.
- **revert-checks:** R1 return 0 for an empty distribution; the null test must fail. R2 drop the retry rows from `callCost`; "every retry counted" must fail.
- **worknote:** `.../worknotes/AN-34a.md`. **commit:** `feat(character): add the file-based cohort metrics (Jensen-Shannon, survival, XP audit, cost, completeness)`. **on-cap:** common rule.

### AN-34b: harness and model dimensions, H7 to H9, report

- **id:** AN-34b. **wave:** W12. **branch:** `codex/an-34b-metrics-harness`. **status:** Writing; real inputs wait on HC-37 (AN-33b).
- **depends-on:** AN-34a, AN-33b (formats).
- **may-edit:** `tools/progress-metrics/src/cohort/compare.ts`, `hypotheses.ts`, `lineage.ts`, `drift.ts`, `tom.ts`, `report.ts`, `cohort-cli.ts` and tests (new; a new entry so `cli.ts` is untouched); `tools/progress-metrics/package.json` (one script `"cohort": "node src/cohort/cohort-cli.ts"`, `(to confirm: shared manifest)`); `docs/runbooks/progress-metrics.md` (a new section, `(to confirm owner)`); the worknote.
- **must-not-edit:** always list; the existing `cli.ts`.
- **decisions:** D-CS-11 (protocol file `protocol.json` holds every bar; **no bar is chosen after results**).
- **size:** about 50k.
- **Deliver.** Grouping keys on every table: `arm` (A to D), `harness`, `model`, `declared_model`, `treatment flags`; a row with an unknown harness or model is kept under `unknown`, never dropped. Hypotheses (v3 plan section 7), each with its protocol fields and an explicit `not_evaluable` state:
  - **H7** the same character files on different harnesses behave differently and the difference is the model: `harnessContrast(metric, byHarness, controlSpread)` returns the harness-versus-harness difference of the primary curiosity measure (`first_visit_share`, the AN-59 rule's own ratio, so one definition) and `withinControlSpread: boolean`; fails the hypothesis when every difference is inside the two-control spread. Revealed sheets from the v2 instrument are an optional input file `(to confirm: v2 plan)`; absent, they are reported `not_evaluable`, not zero.
  - **H8** a local model can hold a character through a day: completed wakings, invalid tool calls, memory written, from the kit meter and ledger; compared with the bar in `protocol.json`; no bar set prints `bar_not_set`.
  - **H9** per-agent retry caps cut stuck minutes without cutting firsts: stuck minutes from the existing `tools/progress-metrics/src/episodes.ts` and `stalldiag.ts` definitions `(to confirm they define "stuck")`; first-time sightings acted on from the kit ledger; fails if firsts fall below both controls.
  Also: parent-child inheritance (observed mutation distribution against 20/60/20 with the sample size shown, child XP zero, no proficiency in the child record), drift by field and window (versions, one-point adherence, false-flag control unchanged), theory-of-mind error by contact count and learned field with the prior and constant-3 baselines, scored on the truth version at prediction time (`tom.ts`; unsupported fields excluded; **inputs only from the kit estimates file if HC-27 to HC-30 export it**, else `not_evaluable`). The report renders counts, denominators and uncertainty, `insufficient data` and `incomplete run` states, and states the confounds (prompt-policy in B versus A, temperament prose in D versus C, the harness and the model moving together).
- **checks:** CK-BASE; `./geldar.ps1 pnpm test progress-metrics/src/cohort`. Tests: a difference inside the control spread is `withinControlSpread: true`; outside is false; an absent bar prints `bar_not_set`; an unknown harness keeps its row; mutation counts from a hand fixture; ToM excludes `common_sense` and `cleverness`; the report refuses to print a verdict line for an incomplete run.
- **revert-checks:** R1 drop the `unknown` bucket; the "unknown harness kept" test must fail. R2 evaluate H7 without the control spread; the within-spread test must fail. R3 let ToM include `cleverness`; the exclusion test must fail.
- **worknote:** `.../worknotes/AN-34b.md`. **commit:** `feat(character): add harness and model comparison, hypotheses H7 to H9 and the cohort report`. **on-cap:** common rule.

### AN-35a: protocol, run-set validator and fixtures

- **id:** AN-35a. **wave:** W12. **branch:** `codex/an-35a-protocol`. **status:** Writing (D-CS-10 and D-CS-11 numbers accepted before any run).
- **depends-on:** AN-34a.
- **may-edit:** `tools/progress-metrics/src/cohort/protocol.ts` and `protocol.test.ts` (new); `tools/progress-metrics/fixtures/cohort/protocol.example.json`, `runset.example.json` (new, synthetic); the worknote. Fixtures live under `tools/progress-metrics/fixtures/`, not under `shards/`, because `tools/repo-checks` scans every `shards/*.yaml` as a real shard (`identity-mode.ts`).
- **must-not-edit:** always list; `shards/**`; production shard files; journal truncation tools.
- **decisions:** D-CS-11, D-CS-10 (concrete named-sheet and flag values are a separate reviewed diff, not here).
- **size:** about 45k.
- **Deliver (shapes):**
```ts
export type Treatment = 'A' | 'B' | 'C' | 'D';
export interface Arm { armId: string; treatment: Treatment; harness: string; model: string; declaredModel: string;
  flags: Record<string, boolean | number | string>; initialSheetHash: string; worldCloneHash: string;
  seed: number; runId: string; lifeIds: string[]; durationTicks: number; factors: string[] }  // declared varied factors
export function validateRunSet(arms: Arm[], protocol: Protocol): RunSetFinding[];
```
  Findings (each fails the run set): world clone hash differs across arms; any config key differs that is not in the arm's declared `factors`; a duplicated `runId` or a life id used in two arms; missing provenance (code SHA, prompt versions, kit version, model digest and settings, initial sheet hash); a drift arm with `durationTicks < 168000 + one evaluation margin` (named `insufficient_for_drift`; a five-day survival run cannot test drift); an inheritance arm without actual births recorded; a cell of the harness-by-treatment grid that the protocol did not declare (the design is staged and fractional under D-CS-11, not the full cross-product); a model-call counter that disagrees with the journal outside the protocol tolerance (kit meter turns against world `sovereign_call` events per life).
- **checks:** CK-BASE; `./geldar.ps1 pnpm test progress-metrics/src/cohort/protocol`. One test per finding, plus a valid run set that passes.
- **revert-checks:** R1 skip the declared-factor diff; the "undeclared config difference" test must fail. R2 lower the drift duration floor; the `insufficient_for_drift` test must fail.
- **worknote:** `.../worknotes/AN-35a.md`. **commit:** `feat(character): add the cohort protocol and run-set validator with synthetic fixtures`. **on-cap:** common rule.

### AN-35b: collection scripts, report protocol, run evidence

- **id:** AN-35b. **wave:** W12. **branch:** `codex/an-35b-collect`. **status:** **BlockedDependency**: HC-38 (kit cohort arms by harness), AN-60b merged, and the owner's acceptance of D-CS-10 and D-CS-11 numbers before the first run. The coder part (scripts and protocol document) can be built earlier; **runs are ops, serial, recorded raw, never rerun away; a missing run is incomplete, not a pass.**
- **depends-on:** AN-35a, HC-38, AN-60b.
- **may-edit:** `tools/cohort-export/src/collect.ts` and `.test.ts` (new; shells out to `node tools/cohort-export/src/cli.ts export` and `ingest` per arm, so the metrics package keeps no DB access); `docs/analysis/character-sheet/worknotes/AN-35-protocol.md` (the fixed report protocol, new); `docs/analysis/character-sheet/worknotes/AN-35-results.md` (ops writes raw results); the worknote.
- **must-not-edit:** always list; production shard edits; live state.
- **decisions:** D-CS-11, D-CS-10.
- **size:** about 40k for the coder part; runs are separate ops usage.
- **Deliver.** `collect --runset <file> --out <dir>` runs `export` then `ingest` for each arm in order, writes a `collection-report.json` (arm, run id, row counts, completeness, warnings) and stops at the first incomplete arm; it never deletes or edits a prior run folder. The protocol document fixes: the four treatments and the declared harness cells; world clones and fresh life, state and RNG per arm (a seed in an already mutated world is not a control); at least one full 168000-tick drift window plus its evaluation boundary for drift arms; actual births with fixed parental versions for inheritance arms; the order serial on independent clones; the report skeleton of AN-34b; the exclusions rule.
- **checks:** CK-BASE (`--filter @geldar/cohort-export`); `./geldar.ps1 pnpm test cohort-export/src/collect`. Tests: stops at the first incomplete arm; never writes into an existing run folder; counts from the collection report agree with each manifest; a second arm's collection cannot read the first arm's folder (separate output paths).
- **revert-checks:** R1 continue after an incomplete arm; the stop test must fail. R2 allow an existing output folder; the refusal test must fail.
- **worknote:** `.../worknotes/AN-35b.md`. **commit:** `feat(character): add cohort collection scripts and the fixed report protocol`. **on-cap:** common rule.

### AN-36: campaign review and rollout close (world side)

- **id:** AN-36. **wave:** W12. **branch:** `codex/an-36-close`. **status:** **BlockedDependency**: AN-35b evidence, a fresh campaign review, and owner D-CS-12 (broader enablement, opt-in, tune or stop). A docs and config card, not a feature card.
- **depends-on:** AN-35b; HC-39 (kit close) runs alongside.
- **may-edit:** `docs/analysis/character-sheet/README.md` (ledger, new `(to confirm with the geldar orchestrator)`), `RESUME.md` (40 lines at most), `retro/campaign.md` (new); named runbooks (`docs/runbooks/sheet-read.md`, `cohort-export.md`, `lineage-gate.md`, `progress-metrics.md`); only the shard and default changes the owner approves, as a reviewed diff naming lives and flags; the worknote. Feature fixes become new coder cards, never a side effect here.
- **must-not-edit:** always list; code; `docs/spec.md`.
- **decisions:** D-CS-12 (implementation completeness and a positive scientific result are separate verdicts), D-CS-10.
- **size:** about 30k docs and config work, plus reviews and ops.
- **Deliver.** A coverage reconciliation against the brief (sections 3, 4, 7, 11.1, 11.2 and 11.3 and the integration plan's coverage table): every row has working code and named evidence, **including the false-default features**; a skipped gate is never labelled done; the lineage and drift rows are `pending` unless the two-path gate and an enabled drift window ran with real lives; off-rollback documented (flags off, history and schema kept, additive SQL preserved); the docs sweep; the retro with owned, sized actions; the final ledger and `RESUME.md`; the enable, opt-in, tune or stop ruling as a configuration diff. Soak and chaos stay campaign-boundary gates (decision 0130); Mind profile removal is a separate accepted decision.
- **checks:** CK-BASE (docs only: `./geldar.ps1 pnpm check:repo`, `git diff --check`); a fresh read-only reviewer that did not write the cards; ops evidence listed per gate.
- **revert-checks:** none for code. The reviewer's check is that every coverage row links evidence and that no `done` label sits on a gate recorded as not run.
- **worknote:** `.../worknotes/AN-36.md`. **commit:** `docs(character): close the world track (coverage reconciliation, retro, rollout ruling)`. **on-cap:** common rule.

---

## Differences between the original plan and origin/main

| # | Original assumption (`8eac28ba`) | At origin/main (`a1c6fb2a`) | Effect on these cards |
|---|---|---|---|
| 1 | Birth lifecycle exists as C4 with `lf_` ids | Not merged. No `life.started`, no server allocator, no shrine or cradle; `LifeId` is `ag_`. `agents.parent_a`, `parent_b` exist but are never written | AN-55a, AN-55b, AN-57 are `BlockedDependency`; AN-54 reuses `LifeId` by reference (see C4 section) |
| 2 | One life-creation path | Two: operator `addPlayer` (`tools/mcp-tokens/src/players.ts`) and the registration definer `register_create_player`. Owner cap by trigger (0006), roster by `mcp_roster` (0024, TypeScript-side check), lifetime limit of 10 only inside the register function | AN-55a creates a separate `operator_` function and re-applies the roster, cap and lifetime rules; the registration function is not touched |
| 3 | `docs/analysis/character-sheet/` holds worknotes | The folder does not exist | The orchestrator creates it; worknote paths unchanged |
| 4 | A Body gets its sheet from shard YAML (`player-config.ts`) | Still true for `sovereign.players[]` only; a DB-created life has no YAML entry and the supervisor body path (C7-03b2, b4) is unmerged; `golem/` ignores `GELDAR_LOGIN_NAME` | A child's Body must load its sheet from the world (AN-11 state request), not YAML; AN-57's gate is blocked on a Body host |
| 5 | `shard-config.schema.json` could carry the `character` block | It is the Colo compose keys (`cpu_limit`, `memory_limit`, ...), not the character block | The drift config extends AN-02's `character-config.schema.json` `(to confirm)` |
| 6 | Heuristic and Mind consumers in `animus/` | Frozen (D-HC-01) | Every `animus/` ownership removed; drift evaluation is eventsink-side, the trigger is a world-observed sleep |
| 7 | No harness dimension | `agents.harness` and `declared_model` exist; `claude`, `chatgpt` enabled on colo (ADR 0180); `local` enabled nowhere; register default `claude-code` | AN-34 and AN-33 add the dimension and normalise names; a shard entry for `local` is an owner and orchestrator action, not a card here |
| 8 | New SQL check files "just exist" | `.github/workflows/ci.yml` names every `check-schema*.sql`; `tools/repo-checks/src/ci-schema-wiring.test.ts` fails otherwise | Each SQL card appends one `-f` argument `(to confirm owner)` |
| 9 | Contract defs are free-named | The generator treats any `$defs` name ending in `Input` or `Result` as an MCP tool pair | Shapes named `BirthOutcome`-style; noted in CK-CONTRACT |
| 10 | NATS subject under `body.>` is private to the Body | In `geldar.ps1` the `mcp` and `mind` roles may publish `geldar.<s>.body.>`; `body` and `paper` may publish `geldar.<s>.>` | The sheet subject is `geldar.<s>.life.<id>.sheet` with new `PubDeny` rows (AN-60a). **A proficiency subject placed under `body` (AN-02, AN-11) has the same forge risk and should be rechecked by geldar A** |
| 11 | `agents` readable only through safe grants | `GRANT SELECT ON agents TO geldar_mcp` is table-wide (0002 line 89), so any new column (`character_sheet`) is readable by the MCP role | GX-03 tests it and carries the fix if AN-04 does not; AN-04 should avoid a column on `agents` or restrict the grant |
| 12 | `cli.ts` of `tools/mcp-tokens` takes new subcommands | 515 lines and shared with the registration and C7 work | New standalone CLIs and index lines for `USAGE` |
| 13 | Decision and migration numbers 0173+ and 0024+ free | ADR through 0181, SQL through 0034; in flight 0169, 0173, SQL 0035 and 0036; registry file stale | Numbers left to the orchestrator; recommendation above |
| 14 | `born_day` marks a life's start | NULL for operator-added lives | Drift keeps its own `origin_tick` in `drift_state` |
| 15 | The sink holds the stream history | JetStream keeps 30 days and 2 GB (`STREAM_CONFIG`); Postgres `events` keeps all | Evidence reads Postgres, never the stream |
| 16 | Eventsink reads shard config | `SinkConfig` is environment-only | The drift flag reaches eventsink through AN-07's route or one documented variable `(to confirm)` |
| 17 | `psyche/` and all W1 to W9 work exist | None of it is merged | Every name from AN-02 to AN-12 is `(to confirm)` before dispatch |

## Open items

1. **Owner ruling D-CS-17 (unblocks W10).** Either wait for C4-00 and C4-05 (server life ids, `life.started`, Cradle headroom), or rule that the operator-authorized path (`birth_source = 'operator'`, the owner names the child, no new allocator) is the round-1 birth lifecycle. Without one of them AN-55a, AN-55b and AN-57 stay `BlockedDependency`, and a factory unit test cannot close W10. Also needed: whether both parents must belong to one owner (assumed yes here) and whether a birth counts against the owner's cap and lifetime limit (assumed yes).
2. **Drift trigger boundary.** The task split puts the sleep trigger in kit card HC-36; these cards evaluate world-side on a completed `sleep` action (AN-60a), because the world is canonical and the evaluation is idempotent by window. The geldar orchestrator and the kit orchestrator must agree: HC-36 should only notice a changed revision through GX-03 and build the persona refresh artifact.
3. **D-CS-13 field rules.** Only `curiosity` has an evidence rule (first-visit share of completed `goto` actions). `aggression` and the others need an observable behaviour counter (for example the model's own `attack` actions against sighted hostiles, which needs the PX threat-sight record) and an owner ruling. Cut points, `min_samples` 20 and `margin` 2 are unmeasured placeholders.
4. **Unmeasured numbers.** The 20/60/20 mutation, the 168000-tick window, the one-point step, and every drift parameter above are the brief's first guesses; none is validated.
5. **Registration-adjacent rules to confirm with the orchestrator.** The `register_audit` write from operator functions (precedent 0034), the lifetime limit of 10 re-applied in `operator_lineage_birth`, and whether lineage and sheet tables belong in the C7-09 owner export.
6. **No contract shape for the kit's sheet copy.** `SheetCopy` is validated by the psyche normalizer, not by a contract schema, to avoid a contract card for GX-03. If the kit wants a generated validator, AN-58a (the W11 contract owner) is the nearest slot, or an earlier unblocker.
7. **Child Body host.** A DB-created child needs a runnable Body: the supervisor path (C7-03b2, C7-03b4) or a `sovereign.players` entry. The Body must read its sheet from the world, not YAML.
8. **`local` harness enablement.** `sovereign.harnesses.local` in the shard file and the register list are owner and orchestrator actions; until then `local` lives cannot be created through `addPlayer`.
9. **HC dependencies not yet fixed.** HC-37 file names (`instinct.jsonl`, the meter file, the estimates file), HC-38 arm declarations, and the GX-01 event stamp field names are `(to confirm)`; AN-33b, AN-34b and AN-35b change if they differ.
10. **`(to confirm)` list.** AN-02: schema and config file names, `Score`; AN-03: `normalizeSheet`, `rngFor`, barrel; AN-04: `character_sheet` placement (separate table versus column), `xp_evidence` columns including the tick, adoption tick, range-check function; AN-06: `audit_gaps`; AN-07: how eventsink gets character config, the `character` shard block; AN-11 and AN-12: life-state handler, cache and profile port paths; birth tick source; `ci.yml` and `admin.sh` ownership; `USAGE` index line in `cli.ts`; `docs/analysis/character-sheet/README.md` creation; the stuck-minutes definition in `progress-metrics`.
11. **Cross-card risk for geldar A.** If AN-02 or AN-11 placed the proficiency subject under `geldar.<s>.body.>`, the player's MCP server can publish to it (finding 10). Recheck before AN-11 is dispatched.
