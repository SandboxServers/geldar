# Geldar cards A: the world track, waves W1 and W2 (GX-01 to GX-02, AN-02 to AN-12)

Status: **proposal, nothing dispatched.** Re-sliced from the original candidate cards (`geldar-an-work-packets.md`, written against geldar `8eac28ba`) after the in-house Mind (`animus/`) was dropped for the player kit ([README.md](README.md), [retarget-map.md](retarget-map.md)). Written 2026-11-14.

**Basis.** The geldar code was read at `origin/main` = `907f5b8a` (extracted read-only with `git archive` into the scratchpad). A later `git fetch` moved `origin/main` to `a1c6fb2a` (PR #343, the `till` action: `golem/src/actions/till.ts`, `till.test.ts`, small edits to `index.ts`, `place.ts`, `protected-blocks.ts`); nothing in these cards touches those files. File names are exact where the file exists at `907f5b8a`; `(new)` marks a file to create; `(to confirm)` marks a name or fact I could not verify by reading. A card holding a `(to confirm)` is not Ready until the orchestrator confirms it.

**Who runs these.** The geldar orchestrator executes these cards in the geldar repo under geldar's rules (`CLAUDE.md`, `AGENTS.md`, `docs/analysis/phase1/packet-conventions.md`): one worktree per packet, a fresh read-only reviewer per packet, ops merges. **This file allocates no ADR, migration or prompt number.** Every such number is written `<allocate via registry>` and is reserved by the orchestrator in `docs/analysis/phase1/packets/decision-number-registry.md` before dispatch. The coder never tags, pushes or opens a PR.

## Waves and order

```
W1  GX-01a -> AN-02a -> AN-02b          (contract owners, strictly serial: each regenerates contract/src/generated)
    GX-01a -> GX-01b -> GX-01c          (event stamp; GX-01b also first to touch adam-body.ts)
    AN-02a -> AN-03a -> AN-03b -> GX-02 (psyche package, then its release)
    AN-02a -> AN-04a -> AN-04b          (SQL, serial: one psql line in ci.yml each)
    GX-01b + AN-03a + AN-04b -> AN-05   (Body and roster loaders)
    AN-04b -> AN-06a ; AN-03b -> AN-06b (sink audit projection ; Body audit producer)
    AN-05 + AN-06a + AN-06b -> AN-07    (wiring, inactive)
W2  AN-07 -> AN-08a -> AN-08b           (threat policy in psyche, then the reflexes)
    AN-07 -> AN-09a, AN-09b             (XP evidence: sink normalizer ; Body producers)
    AN-09a -> AN-10a -> AN-10b          (exactly-once XP ; outbox publication)
    AN-10b -> AN-11a ; AN-07 -> AN-11b  (state service ; Body cache)
    AN-08b + AN-09b + AN-11a + AN-11b -> AN-12
```

Splits against the original ids: AN-02, 03, 04, 06, 08, 09, 10 and 11 are each split into `a` and `b` (the original estimates of 50 to 70k did not fit a Haiku coder at about 50k). GX-01 is three cards (`a` contract/SQL/sink, `b` Body, `c` MCP and operator tool). AN-05, AN-07 and AN-12 stay whole, with a pre-declared split line in `on-cap`. 23 cards in all.

Ledger dependencies from the kit track: GX-01a needs HC-04 (for the field names). GX-02 feeds HC-17. AN-28 (W5) is unchanged and not in this file.

## Shared owners per wave

| Shared surface | W1 owner | W2 owner |
|---|---|---|
| `contract/` schemas, `contract/src/index.ts` blocks, generated output | GX-01a, then AN-02a, then AN-02b, serial; nobody else edits `contract/` | none; a missing shape is a request for a new unblocker |
| Shared wiring: `golem/src/adam/adam-body.ts`, `golem/src/body/create-body.ts`, `reflex.ts`, `golem/src/adam/main.ts`, `golem/src/players/main.ts`, `eventsink/src/main.ts`, `eventsink/src/writer.ts` dispatch | GX-01b (publisher seam in `adam-body.ts`), then AN-07 | AN-12 |
| Manifest, lockfile, Dockerfile COPY and ignore lines | AN-03a (psyche, consumer dependency lines for `golem`, `eventsink`, `tools/mcp-tokens`, and the COPY lines of the three images that install them). Later requests are serial, through an "index line to add" | AN-12, only if needed |
| Shard files, NATS ACL generator, compose env | AN-07 (sample `character:` blocks, ACL proof tests; no ACL edit is expected, see AN-07) | AN-12 (`geldar.ps1` `Get-NatsUsers` state subjects, `compose/colo.yml` eventsink env, shard blocks) |
| SQL migrations and `.github/workflows/ci.yml` psql line | GX-01a, AN-04a, AN-04b in that order (each adds one `-f sql/test/<file>` to the schema psql step) | none |
| `docs/decisions/README.md`, `sql/README.md` index lines, ledger, RESUME, registry | orchestrator and ops, from "index line to add" in worknotes | same |

Deviation from the original table, on purpose: the original made AN-03 the manifest owner and AN-07 the image owner. A manifest line that the images cannot install breaks the build, so the manifest lines and the image COPY lines go together in AN-03a. AN-07 then checks them.

## The shared contract (names every card uses)

- **WorldEvent envelope** gains two optional top-level fields, `harness` and `model` (GX-01a). **Working names: they must be reconciled with what kit packet HC-04 defines before GX-01a is dispatched.** `harness`: `^[a-z][a-z0-9-]{0,31}$` (the same pattern as `HARNESS` in `tools/mcp-tokens/src/players.ts`). `model`: 1 to 128 characters.
- **Schemas** (contract, title in brackets): `character-sheet` (`CharacterSheet`, innate scores only), `roll-event` (`RollEventPayload`), `decision-event` (`DecisionEventPayload`), `sheet-adopted-event` (`SheetAdoptedPayload`), `proficiency-request` (`ProficiencyRequest`), `proficiency-state` (`ProficiencyState`), `proficiency-level` (`ProficiencyLevelPayload`), `chunk-visited-event` (`ChunkVisitedPayload`).
- **WorldEvent types** (3-token subjects `geldar.<shard>.<type>`, so the sink sees them): `roll`, `decision`, `sheet_adopted`, `chunk_visited`. None may ever be added to `MIND_EVENT_TYPES` (`animus/src/link/mind-event.ts`), the list the MCP stream reads; AN-07 adds a test for that.
- **Subjects** (5 tokens, outside the sink filter `geldar.*.*`; helpers in `contract/src/subjects.ts`): `proficiencyRequestSubject(shard, lifeId)` = `geldar.<shard>.state.<life_id>.proficiency` (request/reply, eventsink answers) and `proficiencyPushSubject(shard, lifeId)` = `geldar.<shard>.state.<life_id>.level` (core NATS push, eventsink publishes); `stateWildcard(shard)` = `geldar.<shard>.state.>`.
- **Tables** (SQL): `agents.character_sheet`, `agents.sheet_hash`, `agents.sheet_adopted_at`; `character_sheet_adoptions`, `rolls`, `decisions`, `xp_evidence`, `proficiency`, `proficiency_outbox`; `events.harness`, `events.model`.
- **psyche package** `@geldar/psyche` (`psyche/`): zero imports outside itself, so the kit can mirror `psyche/src/` byte for byte. Release record `psyche/RELEASE.json`, git tag `psyche-v<version>`, tree-hash algorithm `geldar-tree-v1` (GX-02). `ENGINE_VERSION` is recorded on every roll and decision.
- **Sheet hash**: lower-case hex SHA-256 of `canonicalSheetJson(sheet)` (psyche; keys sorted, no whitespace). Hashing itself is one `node:crypto` line in each consumer, so psyche stays free of `node:` imports.
- **Rule R-sheet**: the database baseline (`agents.character_sheet`) wins. A config sheet is a candidate. The first adoption sets the baseline; a later different candidate is logged as `conflict` and changes nothing.

## Numbers: what is free (recommendation only, re-check at dispatch)

Checked at `907f5b8a`, `a1c6fb2a`, and the 308 remote branches (added files only):

- **Decisions.** On main: up to 0172, plus 0180 and 0181. Registry reserves 0173 to 0179 for C7. In flight on remote branches: **0169** (`phase1/players-host-restart`) and **0173** (`phase1/c7-wave3`). Gaps with no record anywhere: 0158, 0159, 0161 (leave them; unknown history). Recommend starting this campaign at **0182**. Cards need at most: one ADR for the assumed D-CS-03/04/05/07 answers and the engine boundary (Precondition P0 below), plus one for the XP matrix (AN-09a). Orchestrator decides.
- **Migrations.** On main: 0001 to 0027 and 0032 to 0034 (0028 to 0031 do not exist; they sit inside the C7 reserve of 0024 to 0033, so do not take them). In flight: **0035 and 0036** (`phase1/c7-wave3`). Recommend **0037 and up**. This file needs three: GX-01a, AN-04a, AN-04b.
- **Prompts.** `thought/v1` to `v5` and `reflection/v1`, `v2` exist; `body-api/v1` to `v7` exist (**v7 is now taken by the `till` verb, decision 0167**). Thought v6 (C3-03) and v7 (C4-06) stay reserved by the registry. These cards allocate no prompt. W7 (not here) can no longer use body-api v7.

**Precondition P0 (orchestrator, before W1):** AN-00 is retired. Record, under allocated ADR numbers, the assumed answers D-CS-03 (immutable adopted baseline), D-CS-04 (eventsink owns XP, thresholds 10/30/70, the evidence matrix of AN-09a), D-CS-05 (what `rolls: false` means, per function), D-CS-07 (audit outage rule, AN-06b), and the engine boundary (psyche is mirrored, D-HC-02). Create the campaign folder `docs/analysis/character-sheet/` in geldar (it exists only as untracked files in a Codex worktree, not on `origin/main`) so the worknote paths below exist. Create the integration branch `codex/character-sheet-w1` from `origin/main`.

## Rules common to every card

- **R1 size.** One Haiku-class coder, at most about 50k working tokens including reading, checks and the report. The size on a card is an estimate, not a meter.
- **R2 branch.** `codex/<id-lower>-<slug>` from `codex/character-sheet-w<N>`, worktree `.claude/worktrees/<id-lower>`; the dispatch gives the absolute worktree path. The geldar orchestrator may rename.
- **R3 worknote.** `docs/analysis/character-sheet/worknotes/<id>.md`, one per packet, appended as you go. Shared-file needs go there as "index line to add".
- **R4 commit.** `feat(character): <result>` or `docs(character): <result>`; subject below; attribution lines supplied verbatim in the dispatch. Commit each passing group.
- **R5 on-cap.** Commit what passes, record base SHA, passing tests and unfinished steps in the worknote, leave a clean branch, stop. Do not push, deploy, weaken a test, or invent a design. Each card adds its own split line.
- **R6 must-not-edit baseline (all cards).** `docs/spec.md`, accepted ADRs, merged migrations, merged prompts, hand edits to `contract/src/generated/`, other packets' worknotes, `pnpm-lock.yaml` and every `package.json` unless the card names them, and any file not in the card's may-edit. Never edit `animus/` (frozen), and never run `adam up`.
- **R7 checks bundle `GATE`** (run by the coder, no database or live shard): `git diff --check`; `./geldar.ps1 pnpm format` (commit what it writes) then `./geldar.ps1 pnpm lint`; `./geldar.ps1 pnpm --filter <package> typecheck` for each touched package; `./geldar.ps1 pnpm check:repo` (file caps 500 soft, 700 hard, decision index, pins); `git merge-tree --write-tree codex/character-sheet-w<N> HEAD` shows no conflict. A targeted test run is `./geldar.ps1 pnpm test <path fragment>`. **`GATE-C`** (contract cards) adds `./geldar.ps1 pnpm --filter @geldar/contract generate` then `./geldar.ps1 pnpm check:generated`. **`GATE-S`** (SQL) is an ops lane, the coder writes the files only: apply `sql/[0-9]*.sql` in name order to a scratch database, then `psql -v ON_ERROR_STOP=1 -f` the `sql/test/check-schema*.sql` files as the CI step does; repeat on a database migrated from `origin/main` (upgrade lane) and re-apply the new file (reapply lane). Real-DB sink cases: `$env:GELDAR_IT = '1'; ./geldar.ps1 pnpm test eventsink` (ops).
- **Honesty rules binding every card.** No true sheet, score or alignment label may appear in any agent-visible text, snapshot, MCP output, Glass column or prompt. Off (`character` omitted or `mode: off`) means no draws, no bonus use, no new events, and the old code path. Golem opens no Postgres connection. XP is counted once, by eventsink. No card adds game knowledge to an agent.

---

## Wave W1: durable foundations

## GX-01a: the harness and model stamp, contract, SQL column and sink write

- **id** GX-01a **wave** W1 **depends-on** HC-04 (kit; the names), P0 **size** 35k.
- **branch** `codex/gx-01a-event-stamp` **worktree** `.claude/worktrees/gx-01a`. **Contract owner, first in W1.**
- **may-edit** `contract/schemas/event.schema.json`; `contract/src/generated/*` (by `generate` only); `contract/test/event-stamp.test.ts` (new); `sql/<allocate via registry>_events_harness_model.sql` (new); `sql/test/check-schema-event-stamp.sql` (new); `.github/workflows/ci.yml` (only: add `-f sql/test/check-schema-event-stamp.sql` to the schema psql step); `eventsink/src/writer.ts`; `eventsink/src/writer.test.ts`; `eventsink/test/eventsink.it.test.ts` (one added case; to confirm this is the right IT file).
- **must-not-edit** R6; `sql/README.md` (index line goes in the worknote).
- **decisions** D-HC-01; names reconciled with HC-04 (a worknote line). ADR `<allocate via registry>` only if the orchestrator wants the stamp recorded separately.
- **deliver**
  - `event.schema.json`: add beside `thinker_id`:
    ```json
    "harness": { "description": "The harness that produced the event (claude, chatgpt, local; working name, reconcile with kit HC-04). Absent on events no Body or MCP stamped.", "type": "string", "pattern": "^[a-z][a-z0-9-]{0,31}$" },
    "model":   { "description": "The model that produced the event, as declared (working name, reconcile with kit HC-04).", "type": "string", "minLength": 1, "maxLength": 128, "pattern": "^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,127}$" }
    ```
    Update the schema `description` (it lists the envelope fields). Both optional, so every existing event stays valid.
  - Migration:
    ```sql
    ALTER TABLE events ADD COLUMN harness TEXT CHECK (harness IS NULL OR harness ~ '^[a-z][a-z0-9-]{0,31}$'),
                       ADD COLUMN model   TEXT CHECK (model IS NULL OR length(model) BETWEEN 1 AND 128);
    GRANT SELECT (declared_model) ON agents TO geldar_mcp;   -- GX-01c reads the declared model; 0003 limited the role to six columns
    INSERT INTO schema_migrations (version) VALUES ('<NNNN>') ON CONFLICT DO NOTHING;
    ```
    No index in this card (a cohort export reads offline). `geldar_glass` keeps its column list (0005), so Glass cannot read the new columns.
  - `writer.ts`: `INSERT_SQL` gains `harness, model` and two unnest arrays (`$9::text[]`, `$10::text[]`); `insertParams` adds `events.map((e) => e.harness ?? null)` and the same for `model`.
  - `sql/test/check-schema-event-stamp.sql`: columns exist and are nullable; a bad `harness` (`'Claude'`) is refused; `has_column_privilege('geldar_glass','events','harness','SELECT')` and the same for `model` are false; `has_column_privilege('geldar_mcp','agents','declared_model','SELECT')` is true.
- **checks** `GATE`, `GATE-C`, `./geldar.ps1 pnpm test contract/test/event-stamp` and `./geldar.ps1 pnpm test eventsink/src/writer`; `GATE-S` (ops) plus the IT case (ops): one stamped event and one unstamped event land with the right columns.
- **revert-checks** (1) Remove the two properties from `event.schema.json` and regenerate: `event-stamp.test.ts` "accepts a stamped envelope" fails. (2) Remove the two columns from `INSERT_SQL`: `writer.test.ts` "binds harness and model" fails.
- **worknote** `docs/analysis/character-sheet/worknotes/GX-01a.md` **commit** `feat(character): stamp harness and model on the event envelope and events table` **on-cap** R5; split line: contract + SQL first, then the sink write.

## GX-01b: the Body stamps its events

- **id** GX-01b **wave** W1 **depends-on** GX-01a **size** 40k. **branch** `codex/gx-01b-body-stamp`.
- **may-edit** `golem/src/body/stamped-publisher.ts` (new) and `golem/src/body/stamped-publisher.test.ts` (new); `golem/src/adam/adam-body.ts`; `golem/src/adam/adam-body.test.ts`; `golem/src/adam/adam-config.ts`; `golem/src/adam/adam-config.stamp.test.ts` (new); `golem/src/players/player-config.ts`; `golem/src/players/player-config.test.ts`.
- **must-not-edit** R6; `golem/src/body/records-nats.ts` (the stamp is applied at the publisher seam, not per event builder); `golem/src/mind-link/server.ts`; `golem/src/perception/*`; `golem/src/voice/*`.
- **decisions** D-HC-01 (names). No number.
- **why a seam.** At `907f5b8a` five places build a WorldEvent in the Body (`records-nats.ts` `emit`, `mind-link/server.ts` plan_result, `perception/heard-sound-event.ts`, `perception/hurt-trigger.ts`, `voice/speech-event.ts`), and every one publishes through `env.publisher` (`EventPublisher`) inside `startAdamBody`. One wrapper stamps them all and any future type.
- **deliver**
  - `stamped-publisher.ts`:
    ```ts
    export interface RunStamp { harness?: string; model?: string }
    export function stampedPublisher(inner: EventPublisher, stamp: RunStamp | undefined): EventPublisher
    ```
    With `stamp` undefined or empty it returns `inner` itself (off means the old path, byte for byte). Otherwise `publish(subject, body, msgId)` parses `body`, and when the event has `agent_id` and no `harness`/`model` yet, sets the missing fields from `stamp` and re-serializes; a body that is not valid JSON is passed through unchanged. Never changes `source_event_id` or `msgId`.
  - `adam-body.ts`: at the top of `startAdamBody`, `const publisher = stampedPublisher(env.publisher, config.stamp)`; replace the five uses of `env.publisher` (speech publish, heard sound, `nats.publisher`, hurt, `MindLinkServer`) with `publisher`.
  - `AdamConfig` gains `stamp?: RunStamp`. `parseAdamConfig` reads optional `harness` and `model` under `mind.agent` (Adam; values `animus` and the tier model are an owner choice, to confirm) and validates them with the contract patterns. `parsePlayerConfig` copies optional `harness` and `model` from the `sovereign.players[]` entry into the replacement `mind.agent` it builds (it replaces `mind`, so the keys must be passed through explicitly).
  - Event size: stamping adds about 60 bytes, and `NatsRecordSink` checks `maxEventBytes` before the seam. Note in the worknote; no change.
- **checks** `GATE`; `./geldar.ps1 pnpm test golem/src/body/stamped-publisher`, `golem/src/adam`, `golem/src/players/player-config`. Test cases: all five event kinds leave stamped (drive each builder through a fake publisher); an unstamped config publishes the identical bytes as today; an event without `agent_id` is left alone; the stamped event passes `validateWorldEvent`; an explicit stamp already on the event is not overwritten.
- **revert-checks** Make `stampedPublisher` return `inner` always: "stamps every event kind" fails. Restore the five `env.publisher` uses: `adam-body.test.ts` "every published event is stamped" fails.
- **worknote** `.../GX-01b.md` **commit** `feat(character): stamp harness and model at the Body publisher seam` **on-cap** R5; split line: seam first, config keys second.

## GX-01c: the MCP stamps `sovereign_call`; the operator sets the declared model

- **id** GX-01c **wave** W1 **depends-on** GX-01a **size** 40k. **branch** `codex/gx-01c-mcp-stamp`.
- **may-edit** `threshold/mcp/src/record/sovereign-call.ts` and `sovereign-call.test.ts`; `threshold/mcp/src/ports.ts` (add `declaredModel` to `PlayerRecord`); `threshold/mcp/src/store/pg-players.ts` (read it) and its test; `threshold/mcp/src/main.ts` (line about 329, pass the resolver into `SovereignCallRecorder`); `tools/mcp-tokens/src/players.ts`, `players.test.ts`, `cli.ts`, `cli.test.ts`.
- **must-not-edit** R6; `threshold/mcp/src/events/stream.ts`; token or auth code; `sql/*` (the grant came with GX-01a).
- **decisions** D-HC-01. No number.
- **deliver**
  - `PgPlayerDirectory.find` reads `agents.declared_model` with `LEFT JOIN agents ON agents.agent_id = mcp_players.life_id` (the column is granted by GX-01a). `PlayerRecord.declaredModel: string | null`; the placeholder `self-reported` (what `addPlayer` and the register functions insert) maps to null.
  - `SovereignCallRecorderOptions` gains `stampOf?: (playerId: string) => Promise<{ harness?: string; model?: string } | undefined>`. `record(call)` awaits it (a throw is a dropped stamp, logged through `drop`, never a failed audit) and sets `harness` and `model` on the envelope. `main.ts` builds `stampOf` from `PgPlayerDirectory` with a 60 s per-player cache. No `stampOf` means the old envelope.
  - `tools/mcp-tokens`: `player add ... [--model <text>]` writes `declared_model` instead of `'self-reported'` (validated with the contract `model` pattern); new verb `player set-model <id> --model <text>` updates `agents.declared_model` for the player's life (operator role, one row, refuses a retired player). Help text updated.
  - **Open (kit):** how the kit's per-waking model reaches the world is not defined. Until HC-04 says otherwise, the model is operator-declared, not observed. Record in the worknote.
- **checks** `GATE`; `./geldar.ps1 pnpm test threshold/mcp/src/record`, `threshold/mcp/src/store/pg-players`, `tools/mcp-tokens/src/players`, `tools/mcp-tokens/src/cli`. Cases: envelope carries both fields; a placeholder model is omitted; resolver throws gives a stamped-less envelope plus a drop report; `--model` is validated.
- **revert-checks** Drop the `stampOf` call: "envelope carries harness and model" fails. Revert the JOIN: the directory test "reads the declared model" fails.
- **worknote** `.../GX-01c.md` **commit** `feat(character): stamp sovereign_call with harness and model; operator sets the model` **on-cap** R5; split line: MCP side, then the operator tool.

## GX-02: release the `psyche/` engine so the kit can mirror it

- **id** GX-02 **wave** W1 **depends-on** AN-03b **size** 30k. **branch** `codex/gx-02-psyche-release`.
- **may-edit** `tools/psyche-release/package.json` (new, `@geldar/psyche-release`, picked up by the `tools/*` workspace glob), `tsconfig.json` (new), `src/tree-hash.ts` (new), `src/cli.ts` (new), `src/release.test.ts` (new); `psyche/RELEASE.json` (new, generated by the CLI); `psyche/README.md` (new: the mirror contract); `psyche/package.json` (version field only); `pnpm-lock.yaml` (the new workspace package's importer entry only).
- **must-not-edit** R6; anything under `psyche/src/`.
- **decisions** D-HC-02 (mirror pinned by a recorded tree hash). ADR `<allocate via registry>` is the P0 record.
- **the artifact.** A git tag `psyche-v<version>` on the merge commit, plus `psyche/RELEASE.json` committed in that commit. The kit pins the tag name and the `tree_hash`. The kit mirror test recomputes the hash over its copied `packages/psyche/src` and compares it with `RELEASE.json` copied beside it. **Tagging is an ops step after merge** (`git tag -a psyche-v1.0.0 <merge sha>`, owner approves the push); the coder never tags.
- **tree hash `geldar-tree-v1`** (the same 40 lines must be reimplemented in the kit): files are every regular file under `psyche/src/` (recursive; tests live in `psyche/test/`, so nothing is excluded); path is relative to `psyche/src`, POSIX separators; content is the bytes with `\r\n` turned into `\n`; entries sorted by path in UTF-8 byte order; `file_sha256` is lower-case hex; `tree_hash` is the hex SHA-256 of the concatenation of `<path>\0<file_sha256>\n` for each entry.
- **deliver**
  - `tree-hash.ts`: `export function treeHash(dir: string): { tree_hash: string; files: { path: string; sha256: string }[] }`.
  - `cli.ts`: `node tools/psyche-release/src/cli.ts --write` writes `psyche/RELEASE.json`; `--check` exits 1 when it differs.
    ```json
    { "format": 1, "name": "@geldar/psyche", "version": "1.0.0", "engine_version": 1,
      "tree_hash_algorithm": "geldar-tree-v1", "tree_hash": "<64 hex>", "tag": "psyche-v1.0.0",
      "files": [ { "path": "index.ts", "sha256": "<64 hex>" } ] }
    ```
  - `release.test.ts` (runs in `./geldar.ps1 pnpm test`): `RELEASE.json` equals a fresh `treeHash('psyche/src')`; `version` equals `psyche/package.json` version; `engine_version` equals `ENGINE_VERSION` from `psyche/src/version.ts`; `tag` equals `psyche-v<version>`; line endings: a CRLF copy of a file hashes the same.
  - `psyche/README.md`: what the mirror must copy (all of `src/`), the rule "change `src/`, run `--write`, bump the version, re-tag", and the algorithm above.
  - Standing rule recorded in the worknote: **every later card that edits `psyche/src/` (AN-08a, and W10's AN-42) must run `--write`, bump the version, and be followed by a new tag.**
- **checks** `GATE`; `./geldar.ps1 pnpm test tools/psyche-release`; `node tools/psyche-release/src/cli.ts --check`; `./geldar.ps1 pnpm install --frozen-lockfile` (to confirm; ops).
- **revert-checks** Edit one byte in `psyche/src/index.ts` without `--write`: `release.test.ts` "matches the recorded tree hash" fails. Change the sort order in `tree-hash.ts`: "pinned vector" test (a fixed small directory under `tools/psyche-release/test/fixture/` with a recorded hash) fails.
- **worknote** `.../GX-02.md` **commit** `feat(character): record a tree-hash release for the psyche engine` **on-cap** R5; split line: hash and CLI first, README second.

## AN-02a: contract unblocker, part 1: sheet, roll, decision, adoption

- **id** AN-02a **wave** W1 **depends-on** GX-01a (generated-file order), P0 **size** 45k. **branch** `codex/an-02a-contract-sheet-audit`.
- **Trim against the original AN-02:** no heuristic thought outcome, no Mind decision-link shapes, no change to `thought-event.schema.json`.
- **may-edit** `contract/schemas/character-sheet.schema.json`, `roll-event.schema.json`, `decision-event.schema.json`, `sheet-adopted-event.schema.json` (all new); `contract/src/index.ts` (one new block `// --- AN-02a character ---`: types and validator wrappers `validateCharacterSheet`, `validateRollEventPayload`, `validateDecisionEventPayload`, `validateSheetAdoptedPayload`, following the existing block pattern); `contract/src/generated/*` (generate only); `contract/test/character-sheet.test.ts`, `roll-event.test.ts`, `decision-event.test.ts` (new).
- **must-not-edit** R6; `contract/schemas/event.schema.json` (GX-01a), `shard-config.schema.json` (it validates only the flat colo budget keys `cpu_limit`, `memory_limit`, `minecraft_port`, `bind_address`, `telemetry_url`; the `character:` block is read by the Body loaders, AN-05), `thought*.schema.json`.
- **decisions** D-CS-03, D-CS-05, D-CS-07 (assumed); ADR `<allocate via registry>` (P0).
- **shapes.** `CharacterSheet` is the brief's schema section 3.2 **without** `proficiency` (finding 3 of the integration plan: one writable copy of XP, in `proficiency`): `version` const 1; `attributes` {curiosity, common_sense, cleverness, aggression}; `alignment` {law, good}; `op_modes` {explorer, farmer, miner, builder, crafter, warrior, nitwit}; `$defs.score` integer 1 to 5; every object `additionalProperties: false`. A sheet that carries `proficiency` is refused.

  `RollEventPayload` (title in brackets; all `additionalProperties: false`):
  ```json
  { "required": ["life_id","decision_id","draw_index","engine_version","producer","fx","score","dc","mode","dice","kept","bonus","total","success"],
    "properties": {
      "life_id": {"$ref":"common.schema.json#/$defs/LifeId"},
      "decision_id": {"type":"string","pattern":"^[A-Za-z0-9_:.-]{1,128}$"},
      "draw_index": {"type":"integer","minimum":0}, "engine_version": {"type":"integer","minimum":1},
      "producer": {"enum":["body","kit"]}, "fx": {"type":"string","pattern":"^[a-z][a-z_]{0,47}$"},
      "score": {"type":"integer","minimum":1,"maximum":5}, "proficiency": {"type":"integer","minimum":0,"maximum":3},
      "dc": {"type":"integer","minimum":2,"maximum":30}, "mode": {"enum":["dis","flat","adv"]},
      "dice": {"type":"array","minItems":1,"maxItems":2,"items":{"type":"integer","minimum":1,"maximum":20}},
      "kept": {"type":"integer","minimum":1,"maximum":20}, "bonus": {"type":"integer","minimum":-2,"maximum":5},
      "total": {"type":"integer"}, "success": {"type":"boolean"},
      "inputs": {"type":"object","maxProperties":12,"additionalProperties":{"type":["string","number","boolean","null"]}} } }
  ```
  There is **no `model_called` field** (the brief had one; integration plan finding 4: a roll must not claim what another component later did). Links to thoughts, actions and intents go on the decision. `producer: "kit"` is for the kit's operator export (HC-37); nothing in the world publishes it.

  `DecisionEventPayload`: required `life_id, decision_id, engine_version, producer, fx, kind`; `kind` enum `d20 | uniform | deterministic | audit_gap`; optional `policy` (`^[a-z][a-z_]{0,31}@[0-9]{1,4}$`), `inputs` (as above), `result` {`decision` string, `options` array of {name, weight}, `uniform` number 0 to 1}, `roll_event_ids` (array of `EventId`, max 4), `thought_id`, `action_id`, `intent_id` (the contract id patterns), `dropped` (integer), `since_tick` (`WorldTick`). `if kind = d20 then required roll_event_ids`; `if kind = audit_gap then required dropped, since_tick`. (Ajv 2020 compiles `if/then`; **to confirm** that `contract/scripts/generator.ts` standalone output and `json-schema-to-typescript` accept it. Fallback if not: make `audit_gap` its own schema `AuditGapPayload`.) This is how the D-CS-05 rule "`rolls: false` records a `deterministic` decision, not a die" and the D-CS-07 gap evidence are carried.

  `SheetAdoptedPayload`: required `life_id`, `sheet` (`$ref character-sheet.schema.json`), `sheet_hash` (`^[0-9a-f]{64}$`), `source` (enum `config | roster | birth`).
- **tests (table-driven).** Standard sheet validates; each of the 13 scores at 0 and 6 and 3.5 is refused; an unknown key at each level is refused; a sheet with `proficiency` is refused; a roll with 3 dice, `dc` 1, or `bonus` 6 is refused; both advantage and disadvantage fixtures validate; `deterministic` and `d20` decisions validate only with their required parts; `audit_gap` requires `dropped`; old event fixtures (`contract/test/records.test.ts` fixtures) still validate (no shape they use changed).
- **checks** `GATE`, `GATE-C`, `./geldar.ps1 pnpm test contract/test/character-sheet`, `contract/test/roll-event`, `contract/test/decision-event`.
- **revert-checks** Delete `additionalProperties: false` on `CharacterSheet`: "refuses a sheet with proficiency" fails. Set the `bonus` maximum to 7: "refuses bonus 6" fails.
- **worknote** `.../AN-02a.md` **commit** `feat(character): contract shapes for sheet, roll, decision and adoption` **on-cap** R5; split line: sheet first, then roll and decision.

## AN-02b: contract unblocker, part 2: proficiency, evidence fact, state subjects

- **id** AN-02b **wave** W1 **depends-on** AN-02a **size** 40k. **branch** `codex/an-02b-contract-proficiency`.
- **may-edit** `contract/schemas/proficiency-request.schema.json`, `proficiency-state.schema.json`, `proficiency-level.schema.json`, `chunk-visited-event.schema.json` (all new); `contract/src/subjects.ts` (three helpers); `contract/src/index.ts` (block `// --- AN-02b proficiency ---`); `contract/src/generated/*` (generate only); `contract/test/proficiency.test.ts`, `contract/test/state-subject.test.ts` (new).
- **must-not-edit** R6; the AN-02a schemas.
- **decisions** D-CS-04 (assumed). ADR `<allocate via registry>` (P0).
- **shapes.** `Domain` enum: `combat farming mining building crafting exploring social`.
  - `ProficiencyRequest` `{ life_id, have_version? (integer >= 0) }`: the request body (may be empty text for "anything").
  - `ProficiencyState` `{ life_id, version (integer >= 0), levels: { <domain>: { level 0..3, xp >= 0 } }  (all seven required), sheet? (CharacterSheet), sheet_hash? (64 hex) }`. `version` is the total XP across domains, so it is strictly monotonic with every award and needs no extra counter. A life with no rows answers version 0 and seven zero levels. `sheet` is the **adopted baseline** (R-sheet); it goes only to the Body role, never to an agent.
  - `ProficiencyLevelPayload` `{ life_id, domain, level 1..3, xp, version }`: the core push body.
  - `ChunkVisitedPayload` `{ life_id, dimension (^[a-z0-9_:.-]{1,64}$), cx, cz (integers, +-2000000), tick (WorldTick) }`. WorldEvent type `chunk_visited`. No coordinates beyond the chunk index.
  - `subjects.ts`, using the existing `checked(shard, lifeId)` and `SHARD` helpers:
    ```ts
    export function proficiencyRequestSubject(shard: string, lifeId: string): string  // geldar.<shard>.state.<life_id>.proficiency
    export function proficiencyPushSubject(shard: string, lifeId: string): string     // geldar.<shard>.state.<life_id>.level
    export function stateWildcard(shard: string): string                              // geldar.<shard>.state.>
    ```
- **tests.** Each state fixture (zero, mid, max) validates; a level 4, a missing domain, a negative xp is refused; subject helpers return the strings above and throw on a bad shard or life id and on a dot or wildcard in a token; every state subject has five tokens (so it is outside `geldar.*.*`, as `contract/test/blockowner-subject.test.ts` proves for its subjects: copy that style).
- **checks** `GATE`, `GATE-C`, `./geldar.ps1 pnpm test contract/test/proficiency`, `contract/test/state-subject`.
- **revert-checks** Make `stateWildcard` return `geldar.<shard>.*.>`: "wildcard is exactly the state subtree" fails. Remove one domain from the `required` list: "refuses a missing domain" fails.
- **worknote** `.../AN-02b.md` **commit** `feat(character): contract shapes for proficiency state and state subjects` **on-cap** R5; split line: schemas first, subjects second.

## AN-03a: the psyche package skeleton, sheet normalization, RNG, dependency and image lines

- **id** AN-03a **wave** W1 **depends-on** AN-02a **size** 45k. **branch** `codex/an-03a-psyche-skeleton`. **Manifest, lockfile and image owner of W1.**
- **may-edit** `psyche/package.json`, `psyche/tsconfig.json` (new; `README.md` is GX-02's); `psyche/src/index.ts`, `types.ts`, `sheet.ts`, `rng.ts`, `version.ts` (all new); `psyche/test/sheet.test.ts`, `psyche/test/rng.test.ts` (new); `pnpm-workspace.yaml` (add `- psyche` to `packages`); `golem/package.json`, `eventsink/package.json`, `tools/mcp-tokens/package.json` (add `"@geldar/psyche": "workspace:*"`); `pnpm-lock.yaml`; `golem/Dockerfile` and `golem/Dockerfile.dockerignore`; `eventsink/Dockerfile` and `eventsink/Dockerfile.dockerignore`; `tools/admin/Dockerfile` (it copies `golem/src`, `tools/mcp-tokens` and `animus`, so it needs `COPY psyche ./psyche`).
- **must-not-edit** R6; `threshold/*` Dockerfiles (they do not import psyche); `animus/Dockerfile.mind` (frozen).
- **decisions** D-CS-03, D-CS-05; D-HC-02 (portable engine). ADR `<allocate via registry>` (P0).
- **package rules (all binding, because the kit mirrors `psyche/src/` byte for byte).** `psyche/package.json`: `name @geldar/psyche`, `private`, `type module`, `exports { ".": "./src/index.ts" }`, script `typecheck: tsc -p . --noEmit`, `devDependencies { "@geldar/contract": "workspace:*" }` (tests only), **no runtime dependencies**. `psyche/src/**` imports nothing from `@geldar/*`, `node:*` or any package; relative imports use the `.ts` extension; no enums or parameter properties (`erasableSyntaxOnly`, as `tsconfig.base.json` sets); `exactOptionalPropertyTypes` honoured. All tests live in `psyche/test/` (they may import `@geldar/contract`); root `vitest.config.ts` already includes `**/test/**/*.test.ts`. No new third-party package, so the 14-day pin rule has nothing to check.
- **shapes** (`types.ts`, `sheet.ts`, `rng.ts`, `version.ts`):
  ```ts
  export type Score = 1 | 2 | 3 | 4 | 5;
  export type Domain = 'combat'|'farming'|'mining'|'building'|'crafting'|'exploring'|'social';
  export interface CharacterSheet { version: 1;
    attributes: { curiosity: Score; common_sense: Score; cleverness: Score; aggression: Score };
    alignment: { law: Score; good: Score };
    op_modes: { explorer: Score; farmer: Score; miner: Score; builder: Score; crafter: Score; warrior: Score; nitwit: Score } }
  export const STANDARD_SHEET: CharacterSheet;                 // every score 3, deeply frozen
  export type SheetResult = { ok: true; sheet: CharacterSheet } | { ok: false; errors: string[] };
  export function normalizeSheet(input: unknown): SheetResult;  // strict: unknown keys, non-integers, out of 1..5, extra proficiency all refused
  export function sheetOrStandard(input: unknown): { sheet: CharacterSheet; standard: boolean }; // undefined/null -> standard; malformed THROWS (never repaired)
  export function canonicalSheetJson(sheet: CharacterSheet): string; // keys sorted, no whitespace
  export const ENGINE_VERSION = 1;                              // bump on any behavioural change
  export interface DrawKey { lifeId: string; producer: 'body' | 'kit'; generation: number; tick: number; fx: string; decisionSeq: number }
  export function decisionId(key: DrawKey): string;            // `${producer}:${lifeId}:${generation}:${tick}:${fx}:${decisionSeq}`
  export interface Rng { next(): number; readonly draws: number }
  export function seedFor(key: DrawKey, engineVersion?: number): number; // FNV-1a 32 over `${engineVersion}|${decisionId(key)}`
  export function rngFor(key: DrawKey): Rng;                   // mulberry32 on seedFor; next() is [0,1)
  export function d20(rng: Rng): number;                       // Math.floor(rng.next() * 20) + 1
  ```
  Identity rule (integration plan 3): the body generation is part of the key, so a restart (new generation, `decisionSeq` from 0) never replays a draw; a retry of the same decision reuses the key and so reuses the result.
- **checks** `GATE`; `./geldar.ps1 pnpm test psyche/test`; `./geldar.ps1 pnpm install --lockfile-only` then `./geldar.ps1 pnpm install --frozen-lockfile` (to confirm exact pnpm 12 flags); ops: `docker build -f golem/Dockerfile .`, `-f eventsink/Dockerfile .`, `-f tools/admin/Dockerfile .` load `@geldar/psyche` with the frozen lockfile (the ops lane; no coder run); `./geldar.ps1 pnpm check:repo` (the `colo-images` tests read the Dockerfiles).
- **tests.** `STANDARD_SHEET` validates against the contract `validateCharacterSheet` and is frozen; `normalizeSheet` accepts the standard sheet and refuses each malformed case of AN-02a's table; `sheetOrStandard(undefined)` is standard, `sheetOrStandard({...bad})` throws with the field named; `canonicalSheetJson` is stable under key order; known seed vectors (three fixed `DrawKey`s give three fixed first draws; recorded in the test); changing `generation`, `tick`, `fx` or `decisionSeq` changes the stream; the same key twice gives the same stream; a source scan test asserts no file in `psyche/src` contains `import` of anything not starting with `./`.
- **revert-checks** Drop `generation` from `decisionId`: "a restart gets a new stream" fails. Let `normalizeSheet` ignore unknown keys: "refuses unknown keys" fails.
- **worknote** `.../AN-03a.md` **commit** `feat(character): psyche package with sheet normalization and seeded RNG` **on-cap** R5; split line: package and sheet first, images and lockfile second.

## AN-03b: psyche rolls, exact probabilities, step and factor, temperament bank

- **id** AN-03b **wave** W1 **depends-on** AN-03a, AN-02a **size** 45k. **branch** `codex/an-03b-psyche-roll`.
- **may-edit** `psyche/src/roll.ts`, `params.ts`, `alignment.ts`, `proficiency.ts`, `temperament.ts` (new); `psyche/src/index.ts` (exports only); `psyche/test/roll.test.ts`, `params.test.ts`, `alignment.test.ts`, `proficiency.test.ts`, `temperament.test.ts` (new).
- **must-not-edit** R6; `psyche/RELEASE.json` (not yet created; GX-02 makes it); `pnpm-lock.yaml`.
- **decisions** D-CS-05 (assumed: `rolls` governs d20 checks only; an off check is a recorded `deterministic` decision, per function). ADR `<allocate via registry>` (P0).
- **shapes.**
  ```ts
  export type Mode = 'dis' | 'flat' | 'adv';
  export interface Roll { fx: string; score: Score; proficiency: 0|1|2|3; dc: number; mode: Mode;
    dice: number[]; kept: number; bonus: number; total: number; success: boolean }
  export function modeFor(score: Score): { mode: Mode; bonus: number }; // 1: dis -2, 2: dis 0, 3: flat 0, 4: adv 0, 5: adv +2
  export function roll(fx: string, score: Score, dc: number, rng: Rng, proficiency?: 0|1|2|3): Roll; // success = total >= dc; no natural-1 or natural-20 rule (the brief has none)
  export function exactChance(score: Score, dc: number, proficiency?: 0|1|2|3): { wins: number; total: number }; // total is 20 (flat) or 400 (dis/adv), by enumeration
  export function step(score: Score, base: number, perPoint: number, min: number, max: number): number; // clamp(base + perPoint*(score-3))
  export function factor(score: Score, base: number, k: number): number;      // base * k ** (score-3)
  export function alignmentLabel(law: Score, good: Score): string;            // 'LG'..'CE', 'TN'; law 4-5 L, 3 T, 1-2 C; good 4-5 G, 3 N, 1-2 E
  export const DEFAULT_THRESHOLDS: readonly [10, 30, 70];
  export function levelForXp(xp: number, thresholds?: readonly [number, number, number]): 0|1|2|3; // xp >= t1 gives 1, >= t2 gives 2, >= t3 gives 3
  export function temperament(sheet: CharacterSheet): string[];                // one sentence per attribute or axis that is not 3, fixed order: curiosity, common_sense, cleverness, aggression, law, good; bank from brief 5.9
  export const DEFAULT_DCS: { easy: 8; standard: 11; hard: 14; veryHard: 17 };
  ```
  `alignmentLabel` and the label table are for operators and Glass only; nothing renders them to an agent (the temperament bank holds prose, never numbers or labels). `levelForXp` is the one function eventsink (AN-10a) and the Body (AN-11b) both use.
- **tests.** Exact counts by enumeration, as rationals: score 1 at DC 8 is 121/400 (the brief's displayed 30% is a rounding), score 4 at DC 8 is 351/400, score 3 at DC 11 is 10/20; all 25 cells of the brief's table 4.1 within rounding, and exact for the cells above; every proficiency level 0 to 3 shifts the bonus by the level; DC 2 and DC 30 edges; a fixed seed gives fixed dice; `modeFor` all five scores; `step`/`factor` at 3 return `base`, floors for `step(a, 6, -2, 2, 14)` are 10, 8, 6, 4, 2; all 9 alignment cells and boundary scores; `levelForXp` at 9, 10, 29, 30, 69, 70; `temperament` skips score 3, keeps the fixed order, never emits a digit; **marker scan**: every bank sentence passes `markedWords` from `@geldar/contract` (the refused words include watch, human, maker, stream, credit, shard, so the bank says "keep an eye on", never "watch for"); the longest sentence per row stays within 245 characters in total (the brief's measured budget).
- **checks** `GATE`; `./geldar.ps1 pnpm test psyche/test`.
- **revert-checks** Change the disadvantage rule from keep-lower to keep-higher: "exact counts" fails. Replace `>=` with `>` in `success`: "DC edge" fails. Put "watch" in one bank sentence: "marker scan" fails.
- **worknote** `.../AN-03b.md` **commit** `feat(character): psyche rolls, exact chances, parameters and temperament bank` **on-cap** R5; split line: roll and chances first, parameters and bank second.

## AN-04a: SQL part 1: adopted sheet, proficiency, unique XP evidence, publication outbox

- **id** AN-04a **wave** W1 **depends-on** AN-02a **size** 45k. **branch** `codex/an-04a-sql-sheet-xp`.
- **Trim against the original:** no heuristic-state tables (those are the kit's, D-HC-04).
- **may-edit** `sql/<allocate via registry>_character_sheet_xp.sql` (new); `sql/test/check-schema-character-sheet.sql` (new); `.github/workflows/ci.yml` (only: add `-f sql/test/check-schema-character-sheet.sql` to the schema psql step, after GX-01a's line).
- **must-not-edit** R6; `sql/0001_init.sql` and every merged migration; `sql/README.md` (index line goes in the worknote).
- **decisions** D-CS-03, D-CS-04 (assumed). ADR `<allocate via registry>` (P0). Migration `<allocate via registry>`.
- **deliver** (the coder writes the complete SQL; shapes):
  ```sql
  -- sheet: the adopted baseline of a life, immutable once set (create character_sheet_valid first; the constraint calls it)
  ALTER TABLE agents ADD COLUMN character_sheet JSONB, ADD COLUMN sheet_hash TEXT, ADD COLUMN sheet_adopted_at TIMESTAMPTZ,
    ADD CONSTRAINT agents_sheet_shape CHECK (character_sheet IS NULL OR
      (character_sheet_valid(character_sheet) AND sheet_hash ~ '^[0-9a-f]{64}$' AND sheet_adopted_at IS NOT NULL));
  CREATE FUNCTION character_sheet_valid(s JSONB) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$ ... $$;
    -- exact key sets {version, attributes, alignment, op_modes}; version = 1; every score a JSON number whose text matches ^[1-5]$ (so 3.5 and "3" fail)
  CREATE FUNCTION agents_sheet_immutable() RETURNS trigger ...  -- BEFORE UPDATE OF character_sheet, sheet_hash, sheet_adopted_at ON agents:
    -- raise check_violation when OLD.character_sheet IS NOT NULL and any of the three differ (adoption is UPDATE ... WHERE character_sheet IS NULL)
  CREATE TABLE proficiency (life_id TEXT NOT NULL REFERENCES agents, domain TEXT NOT NULL CHECK (domain IN
      ('combat','farming','mining','building','crafting','exploring','social')),
    xp INT NOT NULL DEFAULT 0 CHECK (xp >= 0), level SMALLINT NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 3),
    updated_tick BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (life_id, domain));
  -- trigger: BEFORE UPDATE refuses a lower xp or a lower level (monotonic)
  CREATE TABLE xp_evidence (life_id TEXT NOT NULL REFERENCES agents, domain TEXT NOT NULL CHECK (...same list...),
    evidence_key TEXT NOT NULL CHECK (length(evidence_key) BETWEEN 1 AND 200),
    source_event_id TEXT NOT NULL, world_tick BIGINT NOT NULL, awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (life_id, domain, evidence_key));            -- the exactly-once key; append-only trigger reuses journal_append_only() from 0007
  CREATE TABLE proficiency_outbox (outbox_id BIGSERIAL PRIMARY KEY, life_id TEXT NOT NULL REFERENCES agents, domain TEXT NOT NULL,
    level SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 3), xp INT NOT NULL, version BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), published_at TIMESTAMPTZ, UNIQUE (life_id, domain, level));
  CREATE INDEX proficiency_outbox_unpublished ON proficiency_outbox (outbox_id) WHERE published_at IS NULL;
  ```
  Grants: no `GRANT` to `PUBLIC`, `geldar_mcp`, `geldar_glass`, `geldar_register`, `geldar_supervisor`. Every service connects as the owner role today (migration 0007's comment), so role denial for the sink cannot be proven; the check asserts the five named roles have no privilege. Each new table gets a `COMMENT ON TABLE` beginning `export:` and `retention:` (the map AN-04b completes). Reapply-safe where the project style allows (`IF NOT EXISTS` on the function and the migration row).
- **tests (`check-schema-character-sheet.sql`).** A valid sheet and hash adopt; a sheet with a score 6, 3.5, `"3"`, a missing group, an extra key, or a `proficiency` key is refused; a second UPDATE with a different sheet or hash raises; an UPDATE that sets the same values is allowed; a NULL baseline can be adopted later once; `proficiency.xp` cannot decrease; a duplicate `(life, domain, key)` insert conflicts; DELETE and UPDATE on `xp_evidence` raise; the five roles have no privilege on any new table; the migration ledger row exists.
- **checks** `GATE`; `GATE-S` (ops: fresh, upgrade and reapply lanes); `./geldar.ps1 pnpm test tools/repo-checks/src/ci-schema-wiring` (the new check file must be named in `ci.yml`); `node tools/migrate/src/cli.ts --dry-run` against a scratch database lists the file (ops).
- **revert-checks** Remove the immutability trigger: the "second adoption raises" step fails. Drop the `PRIMARY KEY` of `xp_evidence`: the duplicate-key step fails.
- **worknote** `.../AN-04a.md` **commit** `feat(character): schema for the adopted sheet, proficiency and unique XP evidence` **on-cap** R5; split line: sheet columns first, XP tables second.

## AN-04b: SQL part 2: roll and decision projections, adoption log, retention and export map

- **id** AN-04b **wave** W1 **depends-on** AN-04a, AN-02a **size** 45k. **branch** `codex/an-04b-sql-audit`.
- **may-edit** `sql/<allocate via registry>_character_audit.sql` (new); `sql/test/check-schema-character-audit.sql` (new); `.github/workflows/ci.yml` (only: its `-f` line).
- **must-not-edit** R6; AN-04a's migration.
- **decisions** D-CS-05, D-CS-07 (assumed). Migration `<allocate via registry>`.
- **deliver.** All three tables reference `events(source_event_id)` and `agents`, so a row exists only with its event.
  ```sql
  CREATE TABLE character_sheet_adoptions (adoption_id BIGSERIAL PRIMARY KEY, source_event_id TEXT UNIQUE REFERENCES events(source_event_id),
    life_id TEXT NOT NULL REFERENCES agents, sheet_hash TEXT NOT NULL CHECK (sheet_hash ~ '^[0-9a-f]{64}$'), sheet JSONB NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('config','roster','birth')),
    result TEXT NOT NULL CHECK (result IN ('adopted','same','conflict')), recorded_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE rolls (source_event_id TEXT PRIMARY KEY REFERENCES events(source_event_id), life_id TEXT NOT NULL REFERENCES agents,
    world_tick BIGINT NOT NULL, decision_id TEXT NOT NULL, draw_index INT NOT NULL CHECK (draw_index >= 0),
    engine_version INT NOT NULL, producer TEXT NOT NULL CHECK (producer IN ('body','kit')), fx TEXT NOT NULL,
    score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5), proficiency SMALLINT NOT NULL DEFAULT 0 CHECK (proficiency BETWEEN 0 AND 3),
    dc SMALLINT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('dis','flat','adv')),
    dice SMALLINT[] NOT NULL CHECK (cardinality(dice) BETWEEN 1 AND 2), kept SMALLINT NOT NULL, bonus SMALLINT NOT NULL,
    total SMALLINT NOT NULL, success BOOLEAN NOT NULL, inputs JSONB, UNIQUE (life_id, decision_id, draw_index));
  CREATE TABLE decisions (source_event_id TEXT PRIMARY KEY REFERENCES events(source_event_id), life_id TEXT NOT NULL REFERENCES agents,
    world_tick BIGINT NOT NULL, decision_id TEXT NOT NULL, engine_version INT NOT NULL, producer TEXT NOT NULL, fx TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('d20','uniform','deterministic','audit_gap')), policy TEXT, inputs JSONB, result JSONB,
    roll_event_ids TEXT[], thought_id TEXT, action_id TEXT, intent_id TEXT, dropped INT, since_tick BIGINT,
    UNIQUE (life_id, decision_id));
  CREATE INDEX rolls_life_fx ON rolls (life_id, fx, world_tick);  CREATE INDEX decisions_life_fx ON decisions (life_id, fx, world_tick);
  ```
  `rolls`, `decisions` and `xp_evidence`-adjacent audit rows get `journal_append_only()` triggers (0007's function). The `UNIQUE (life_id, decision_id, draw_index)` is the second line of defence if a producer retries with a fresh event id.
  **Retention and export map** (`COMMENT ON TABLE ... IS 'export: ...; retention: ...'` on every table of AN-04a and AN-04b, and a table in the worknote), assumed from decision 0171 and **to be confirmed against C7-09/C7-10**: `agents.character_sheet`, `proficiency`, `xp_evidence`, `character_sheet_adoptions`: export = included in the owner's own-rows export (new `format_version` field, `(to confirm)` with C7-09); retention = stays as world history with the owner link removed, since the tables key on `life_id` and carry no owner column. `rolls`, `decisions`: export = included; retention = removed with the thoughts of a life that is still alive when its owner deletes the account (they are agent-internal audit like thoughts; owner confirms).
- **tests (`check-schema-character-audit.sql`).** Each table refuses a row without its event; the CHECKs refuse score 6, `dice` of 3, kind `x`; a second roll with the same `(life, decision, draw_index)` conflicts; UPDATE and DELETE raise on rolls and decisions; every new table of both migrations has a comment starting `export:` and containing `retention:`; no privilege to the five named roles; `events.harness` column from GX-01a is untouched.
- **checks** `GATE`, `GATE-S`, `./geldar.ps1 pnpm test tools/repo-checks/src/ci-schema-wiring`.
- **revert-checks** Remove the FK to `events` on `rolls`: "a roll without its event is refused" fails. Remove one table comment: "every table has an export and retention note" fails.
- **worknote** `.../AN-04b.md` **commit** `feat(character): schema for roll and decision audit, adoption log and retention map` **on-cap** R5; split line: rolls and decisions first, adoption log and map second.

## AN-05: Body and roster loaders: the sheet, config and adoption (Body paths only)

- **id** AN-05 **wave** W1 **depends-on** GX-01b, AN-03a, AN-04b **size** 50k. **branch** `codex/an-05-loaders`.
- **Trim against the original:** `animus/src/config.ts` and the Mind agent store are out. Paths: Adam's Body config, the player Body config, `tools/mcp-tokens` roster creation.
- **may-edit** `golem/src/character/character-config.ts` (new) and `character-config.test.ts` (new); `golem/src/adam/adam-config.ts`; `golem/src/adam/adam-config.character.test.ts` (new); `golem/src/players/player-config.ts` and `player-config.test.ts`; `tools/mcp-tokens/src/players.ts`, `players.test.ts`, `cli.ts`, `cli.test.ts`, `roster.ts` is not touched.
- **must-not-edit** R6; `animus/*`; `threshold/register/*` and the SQL register functions (0010 to 0012: see open items); shard files (AN-07).
- **decisions** D-CS-03, D-CS-05 (assumed: omitted `character` means off); ADR `<allocate via registry>` (P0).
- **shapes.** Shard YAML (read by loaders only; no schema edit):
  ```yaml
  character:                      # omitted = off
    mode: off                     # off | sheet
    rolls: true                   # d20 checks (D-CS-05); read only when mode: sheet
    proficiency: { enabled: true, thresholds: [10, 30, 70] }
  mind: { agent: { character_sheet: { ... } } }              # Adam
  sovereign: { players: [ { player_id: ..., life_id: ..., name: ..., character_sheet: { ... } } ] }
  ```
  ```ts
  export interface CharacterConfig { mode: 'off' | 'sheet'; rolls: boolean; proficiency: { enabled: boolean; thresholds: [number, number, number] } }
  export const CHARACTER_OFF: CharacterConfig;
  export function parseCharacterConfig(block: unknown): CharacterConfig;  // undefined/null -> CHARACTER_OFF; rejects unknown keys and bad thresholds (ascending, positive, integer)
  export interface LifeCharacter { config: CharacterConfig; sheet: CharacterSheet | null; source: 'config' | 'standard' | 'off' }
  export function lifeCharacter(config: CharacterConfig, rawSheet: unknown, lifeId: string, log: (l: string) => void): LifeCharacter;
  ```
  Keys the brief gave to the instinct step (`idle_think_probability`, `max_heuristic_picks`, `failure_hard_cap`, `sanity_check`, `tom`, `morality_hooks`, `drift`) are **tolerated and ignored** by `parseCharacterConfig` with one log line each ("owned by the kit or a later wave"), so an operator may keep the brief's block; any other key throws. `mode: off` gives `sheet: null` even when a non-standard sheet is present. `mode: sheet` with no sheet logs "standard sheet for <life>" and uses `STANDARD_SHEET`. A malformed sheet throws and names the life and field (never repaired). `AdamConfig` gains `character?: LifeCharacter`; `parseAdamConfig` fills it from `root.character` and `mind.agent.character_sheet`; `parsePlayerConfig` passes `entry.character_sheet` through the replacement `mind.agent` it builds (the same place GX-01b passes `harness` and `model`; today that object holds only `username` and `name`, so a sheet would be silently dropped). The MCP's own `sovereign.players` parser (`threshold/mcp/src/config.ts`) ignores unknown entry keys, so the extra key is safe there.
  **Roster creation** (`tools/mcp-tokens`): `SovereignShard` reads `character.mode`; `NewPlayer.characterSheet?: unknown`; `player add ... [--sheet-file <yaml|json>]`. When the shard mode is `sheet`, `addPlayer` writes, in its existing transaction, `agents.character_sheet` (the given sheet, or `STANDARD_SHEET`), `sheet_hash` (SHA-256 of `canonicalSheetJson`, `node:crypto`) and `sheet_adopted_at`, plus one `character_sheet_adoptions` row (`source: 'roster'`, `result: 'adopted'`). When the shard mode is `off` or absent it writes nothing new (`--sheet-file` then errors: "the shard has character mode off"). Invalid sheet: refused before any write.
- **checks** `GATE`; `./geldar.ps1 pnpm test golem/src/character`, `golem/src/adam/adam-config`, `golem/src/players/player-config`, `tools/mcp-tokens/src/players`, `tools/mcp-tokens/src/cli`; parse the real `shards/phase0.yaml` and `shards/colo-mind.yaml` through both loaders (a test, files unchanged, so `character` omitted gives off). The roster tests run against the repo's existing fake `Sql` (`players.test.ts` style); the real-DB `addPlayer` case is an ops lane under `GATE-S`.
- **revert-checks** Make `parsePlayerConfig` drop `character_sheet`: "carries the sheet into the replacement identity" fails. Make `mode: off` keep the sheet: "off yields no sheet even with a non-standard stored sheet" fails. Remove the adoption insert in `addPlayer`: "records adoption in the same transaction" fails.
- **worknote** `.../AN-05.md` **commit** `feat(character): Body and roster loaders for the sheet and character block` **on-cap** R5; split line: `AN-05a` golem loaders, `AN-05b` roster and CLI.

## AN-06a: sink audit projection (rolls, decisions, adoptions)

- **id** AN-06a **wave** W1 **depends-on** AN-04b, AN-02a **size** 45k. **branch** `codex/an-06a-sink-audit`.
- **may-edit** `eventsink/src/audit/projection.ts` (new), `audit/store.ts` (new: `pgAuditStore(db)`), `audit/projection.test.ts` (new), `audit/projection.fakes.ts` (new); `eventsink/src/writer.ts` (the dispatch: one added branch); `eventsink/src/writer.projection.test.ts`; `eventsink/test/audit.it.test.ts` (new, real DB, ops).
- **must-not-edit** R6; `eventsink/src/projection.ts` and its `ProjectionStore` interface (a second store keeps its large fake untouched); `eventsink/src/consumer.ts`.
- **decisions** D-CS-07 (assumed). No number.
- **deliver.**
  ```ts
  export const AUDIT_TYPES: ReadonlySet<string> = new Set(['roll', 'decision', 'sheet_adopted']);
  export interface AuditStore { insertRoll(row): Promise<void>; insertDecision(row): Promise<void>;
    adopt(life: string, sheet: CharacterSheet, hash: string, source: string, sourceEventId: string): Promise<'adopted' | 'same' | 'conflict'>; }
  export async function projectAudit(event: WorldEvent, store: AuditStore): Promise<void>;
  ```
  The writer already runs `projectEvent` inside the batch transaction for `isProjected` events; extend that condition and loop with `AUDIT_TYPES` and `projectAudit(event, pgAuditStore(client))` in the same transaction after the `events` insert.
  Rules: validate the payload (`validateRollEventPayload` etc.); `payload.life_id` must equal `event.agent_id` or the event is rejected with `ProjectionRejectedError('23514', ...)` (poison: the consumer dead-letters it, as for a bad intent); roll and decision inserts are `ON CONFLICT DO NOTHING` (redelivery and a producer retry converge); a `d20` decision whose `roll_event_ids` are missing from `rolls` is stored anyway (arrival order is not guaranteed; no FK on that array); `sheet_adopted`: `adopt` runs `UPDATE agents SET character_sheet = $2, sheet_hash = $3, sheet_adopted_at = now() WHERE agent_id = $1 AND character_sheet IS NULL`; result `adopted` when a row changed, else it compares `sheet_hash` with the stored one: equal gives `same`, different gives `conflict` (baseline untouched); every attempt writes one `character_sheet_adoptions` row. An unknown life (FK failure, SQLSTATE 23503) is the existing poison path (row-by-row retry, dead letter). Bounded policy for an audit backlog: none in the sink; the producer side bounds (AN-06b).
- **checks** `GATE`; `./geldar.ps1 pnpm test eventsink/src/audit`, `eventsink/src/writer`; ops: `$env:GELDAR_IT = '1'; ./geldar.ps1 pnpm test eventsink/test/audit` against a scratch DB (redeliver the same roll twice: one row; kill the transaction mid-batch: no roll row and no event row; malformed roll: dead letter with the reason; second different-sheet adoption: `conflict` row, baseline unchanged). A `Map`-only fake is not accepted as the durability proof.
- **revert-checks** Remove `ON CONFLICT DO NOTHING` on `rolls`: the IT redelivery case fails. Skip the `life_id` equals `agent_id` check: "rejects a payload for another life" fails.
- **worknote** `.../AN-06a.md` **commit** `feat(character): project roll, decision and adoption events in the sink` **on-cap** R5; split line: rolls and decisions first, adoption second.

## AN-06b: the Body's audit producer (stable ids, bounded buffer, gap evidence)

- **id** AN-06b **wave** W1 **depends-on** AN-03b, AN-02a **size** 45k. **branch** `codex/an-06b-audit-producer`.
- **may-edit** `golem/src/character/audit-publisher.ts` (new), `audit-publisher.test.ts` (new); `golem/src/character/audit-events.ts` (new), `audit-events.test.ts` (new).
- **must-not-edit** R6; reflexes, `adam-body.ts` (AN-12 binds it), `golem/src/body/records-nats.ts`.
- **decisions** D-CS-07 (assumed: emergency reflexes proceed, buffer within a fixed limit, emit recoverable gap evidence).
- **deliver.**
  ```ts
  export interface AuditPublisherOptions { publisher: EventPublisher; shard: string; lifeId: string; generation: number;
    tick: () => number; now?: () => Date; maxPending?: number /* default 2000 */; log: (l: string) => void }
  export class AuditPublisher {
    recordRoll(key: DrawKey, roll: Roll, drawIndex: number, inputs?: Record<string, string | number | boolean | null>): string; // returns the decision-less roll event id
    recordDecision(key: DrawKey, d: Omit<DecisionEventPayload, 'life_id' | 'decision_id' | 'engine_version' | 'producer'>): void;
    recordAdoption(sheet: CharacterSheet, hash: string, source: 'config' | 'roster' | 'birth'): void;
    get gaps(): number;  async flush(): Promise<void>;
  }
  ```
  Event ids are stable: `eventIdFor('roll:' + decisionId + ':' + drawIndex)`, `eventIdFor('decision:' + decisionId)`, `eventIdFor('sheet_adopted:' + lifeId + ':' + sheetHash)` (`golem/src/body/derived-id.ts`), so a retry or a Body restart that replays the same key is one event. Every call validates the payload and the envelope (drop and log on failure, never throw), then queues. The call returns at once and never awaits the network (a fleeing Body never waits on audit). Publishing: capped backoff as in `NatsRecordSink.send`; when the queue is at `maxPending` the **oldest** entry is dropped, `gaps` increases, and the next successful publish emits one `decision` event `kind: 'audit_gap'`, `decision_id` `body:<life>:<generation>:<tick>:audit_gap:<n>`, `dropped`, `since_tick` (so a lost stretch is visible). `maxPending` and the drop rule are the recorded D-CS-07 numbers (unmeasured).
- **checks** `GATE`; `./geldar.ps1 pnpm test golem/src/character/audit`. Cases: stable ids (same key twice, one id); a failing then recovering publisher delivers once each; full queue drops the oldest and emits one gap event with the right count; closed or throwing publisher never throws to the caller; a burst of 5000 calls with a hung publisher returns to the caller each time without waiting; a malformed roll is dropped and logged. Real NATS reconnect and a full buffer under JetStream are ops cases in AN-07.
- **revert-checks** Make the queue unbounded: "bounded queue drops the oldest" fails. Use a fresh id per call: "same key gives one id" fails.
- **worknote** `.../AN-06b.md` **commit** `feat(character): Body audit producer with stable ids and gap evidence` **on-cap** R5; split line: events and ids first, queue and gaps second.

## AN-07: foundation wiring, inactive

- **id** AN-07 **wave** W1 **depends-on** AN-05, AN-06a, AN-06b **size** 45k plus ops evidence. **branch** `codex/an-07-wiring`. **Shared-wiring, shard and ACL owner of W1.**
- **Trim against the original:** no Mind startup, no Mind Dockerfile (`animus/Dockerfile.mind` is not touched).
- **may-edit** `golem/src/adam/adam-body.ts` (an optional `character?: LifeCharacter` and `audit?: AuditPublisher` on the env, stored and passed nowhere yet; plus the `sheet_adopted` emission when `character.sheet` is not null), `adam-body.test.ts`; `golem/src/body/reflex.ts` (optional `character?` on `ReflexContext`, unused until AN-08b); `golem/src/players/main.ts` and `golem/src/adam/main.ts` (build `LifeCharacter` from the parsed config and pass it; no behaviour change when off); `shards/phase0.yaml` and `shards/colo-mind.yaml` (a commented sample `character:` block with `mode: off`, and no sheet values: the real values wait on D-CS-10); `threshold/mcp/src/events/audit-types-hidden.test.ts` (new); `tools/repo-checks/src/nats-auth.test.ts` (one added case) or a new `tools/repo-checks/src/nats-auth-character.test.ts` (to confirm which file holds the role table tests).
- **must-not-edit** R6; `geldar.ps1` and `compose/*` (no change is needed: see below); `animus/*`; the Dockerfiles (AN-03a did them).
- **decisions** D-CS-10 (this card merges inactive code only, D-HC-11). No number.
- **findings that shape this card.** (1) The `body` NATS role may already publish `geldar.<shard>.>`, so `roll`, `decision`, `sheet_adopted` and `chunk_visited` need **no ACL edit**; the eventsink reads them through its JetStream consumer. The proof is a test of the generated role table plus an ops case with real roles. (2) The MCP stream consumes an explicit list, `MIND_EVENT_TYPES` in `animus/src/link/mind-event.ts` (via `threshold/mcp/src/events/stream.ts`), so these four types never reach an agent; AN-07 adds the guard test. (3) `threshold/mcp` imports `@geldar/animus` source, so `animus/` cannot be deleted; it is frozen, not removed.
- **deliver.** `adam-body.ts`: when `character?.sheet` is set, emit one `sheet_adopted` via `AuditPublisher.recordAdoption` at start (source `config`); nothing else uses the sheet yet. `audit-types-hidden.test.ts`: assert none of `roll decision sheet_adopted chunk_visited` is in `MIND_EVENT_TYPES` and none is in `streamSubjects('colo')`; a synthetic `roll` envelope fed to `handleStreamMessage` appends nothing to any life's log. ACL test: parse `Get-NatsUsers` output (as `nats-auth.test.ts` does) and assert `body` can publish the four subjects, `mcp` cannot, `mind` cannot. Off test: with `character` omitted `startAdamBody` emits no `sheet_adopted`, builds no `AuditPublisher`, and `stampedPublisher` and reflex wiring are unchanged. With `character` on and a sheet present, the sheet never appears in a log line (`log` spy scan for any score digit pattern from the sheet).
- **checks** `GATE`; `./geldar.ps1 pnpm test golem/src/adam`, `golem/src/players`, `threshold/mcp/src/events/audit-types-hidden`, `tools/repo-checks`; ops: `./geldar.ps1 check` full; images load psyche with the frozen lockfile; a real-NATS run with the actual role credentials: `body` publishes `roll` and a deny case for `mcp`; DB and NATS integration (`GELDAR_IT=1`) before the wave closes.
- **revert-checks** Add `roll` to `MIND_EVENT_TYPES` locally: `audit-types-hidden.test.ts` fails. Make the off path build an `AuditPublisher`: "off builds nothing" fails.
- **worknote** `.../AN-07.md` **commit** `feat(character): inactive wiring for the character block, adoption event and leak guard` **on-cap** R5; split line: `AN-07a` Body wiring, `AN-07b` guard and ACL tests and sample blocks.

---

## Wave W2: Body diversity and proficiency

## AN-08a: the pure threat policy, in psyche

- **id** AN-08a **wave** W2 **depends-on** AN-07, AN-03b **size** 40k. **branch** `codex/an-08a-threat-policy`.
- **may-edit** `psyche/src/threat.ts` (new); `psyche/src/index.ts` (exports); `psyche/src/version.ts` is not edited (`ENGINE_VERSION` stays 1: this adds a function and changes no released behaviour; only the package version moves); `psyche/package.json` (version, to 1.1.0); `psyche/RELEASE.json` (regenerated by `node tools/psyche-release/src/cli.ts --write`); `psyche/test/threat.test.ts` (new).
- **must-not-edit** R6; `golem/*`.
- **decisions** D-CS-05 (assumed per function: threat with `rolls: false` skips the courage band and uses the floor; the aggression-5 unarmed exception is deterministic **fight** when `rolls: false` because the exact chance is 70 percent; `(to confirm)` this row of the truth table with the owner). ADR `<allocate via registry>` (P0).
- **shapes** (brief 5.2; `floor = step(aggression, 6, -2, 2, 14)`; health is out of 20):
  ```ts
  export function fightFloor(aggression: Score): number;          // 10, 8, 6, 4, 2 for 1..5
  export function fightLimitMs(aggression: Score): number;        // Math.round(factor(aggression, 30_000, 1.25))
  export interface ThreatInput { aggression: Score; combat: 0|1|2|3; health: number; armed: boolean; suicideMob: boolean; rolls: boolean }
  export type ThreatCall = { action: 'fight' | 'flee';
    why: 'above_band' | 'band_roll' | 'at_or_below_floor' | 'unarmed' | 'unarmed_exception'; floor: number; roll: Roll | null };
  export function decideThreat(input: ThreatInput, rollAt: (fx: string, score: Score, dc: number, proficiency: 0|1|2|3) => Roll): ThreatCall;
  ```
  Rules: `health <= floor` flees (armed or not). Armed, `health > floor + 4`: fight (`above_band`). Armed, `floor < health <= floor + 4`: with `rolls` true, `rollAt('threat', aggression, 11, combat)` success fights, failure flees (`band_roll`); with `rolls` false the band is skipped and the Body fights (`above_band`, the floor is the fixed threshold). Unarmed (or a suicide mob): flees, except `aggression === 5` and not `suicideMob`: with `rolls` true `rollAt('threat_unarmed', 5, 14, combat)`; with `rolls` false fight; reason `unarmed_exception`. At the standard sheet with `rolls: false` the result equals today's rule (armed and health > 6 fights, otherwise flees). The `rollAt` injection keeps the engine pure: the Body supplies the RNG and records.
- **tests.** Floors 10/8/6/4/2; every aggression against band edges (floor, floor+1, floor+4, floor+5); armed and unarmed; creeper (suicide) never fights even at aggression 5; all-3 with `rolls: false` equals the legacy rule over health 0 to 20 (the legacy rule is written in the test); exact flee and fight probabilities in the band (3 by enumeration with `exactChance`); `rolls: false` calls `rollAt` zero times; `fightLimitMs` 24000, 30000, 37500 around 3 (aggression 2, 3, 4 give 24000, 30000, 37500).
- **checks** `GATE`; `./geldar.ps1 pnpm test psyche/test/threat`; `node tools/psyche-release/src/cli.ts --check` after `--write`; **after merge a new tag `psyche-v1.1.0`** (ops).
- **revert-checks** Replace the floor `step` base 6 with 5: "all-3 equals legacy" fails. Let `rolls: false` call `rollAt`: "rolls false draws nothing" fails.
- **worknote** `.../AN-08a.md` **commit** `feat(character): pure per-life threat policy in psyche` **on-cap** R5; split line: floors and limit first, `decideThreat` second.

## AN-08b: the Body reflexes use the policy

- **id** AN-08b **wave** W2 **depends-on** AN-08a **size** 50k. **branch** `codex/an-08b-threat-reflexes`.
- **may-edit** `golem/src/body/reflexes/threat-policy.ts` (new); `golem/src/body/reflexes/fight-or-flee.ts`; `golem/src/body/reflexes/retreat.ts`; `golem/src/body/reflexes/combat.ts`; `golem/src/body/reflexes/encounter.ts` (new); and the tests `golem/src/body/reflexes/threat-policy.test.ts`, `encounter.test.ts` (new), `fight-or-flee.test.ts`, `retreat.test.ts` (existing, extended).
- **must-not-edit** R6; `golem/src/body/create-body.ts` and `reflex.ts` (AN-12 wires; the policy arrives through a factory argument); the hiss, arrow-sidestep and suicide-mob code in `fight-or-flee.ts` stay as they are (they are physics, not temperament).
- **decisions** D-CS-05 (as AN-08a). No number.
- **why factories.** `fightOrFleeReflex`, `retreatReflex` and `combatReflexes` are module constants read by `enabledReflexes` (`create-body.ts`); nothing per life reaches them. Existing imports must keep working.
- **deliver.**
  ```ts
  export interface ThreatPolicy { floor(): number; fightLimitMs(): number;
    decide(input: { health: number; armed: boolean; suicideMob: boolean }): { action: 'fight' | 'flee'; why: string; roll: unknown | null } }
  export const LEGACY_THREAT: ThreatPolicy;                  // floor 6, 30000 ms, fight iff armed && health > 6: today's behaviour
  export function createFightOrFleeReflex(policy?: ThreatPolicy): Reflex;  // default LEGACY_THREAT
  export function createRetreatReflex(policy?: ThreatPolicy): Reflex;
  export function createCombatReflexes(policy?: ThreatPolicy): readonly Reflex[];
  export const fightOrFleeReflex = createFightOrFleeReflex();  // unchanged exports
  export const retreatReflex = createRetreatReflex();
  export const combatReflexes = createCombatReflexes();
  ```
  `fight-or-flee.ts`: `LOW_HEALTH` and `FIGHT_LIMIT_MS` become `policy.floor()` and `policy.fightLimitMs()`; the `run` decision `trigger.armed === true && ctx.view.health > LOW_HEALTH` becomes `policy.decide(...)`; the health watch inside `fightHostile` aborts at `policy.floor()`. `retreat.ts`: `RETREAT_HEALTH` becomes `policy.floor()`. `encounter.ts`: one courage decision per accepted encounter: an encounter is `(hostile name)` with no hurt for `ENCOUNTER_GAP_TICKS` (200); within an encounter `decide` is called once and its call is reused, so the band cannot be rerolled each hit and the same floor holds through the fight (integration plan 8 rule "no repeated per-tick reroll"). State is per `BodyView` (a `WeakMap`, as `arrowStates` does), cleared on `respawn`/`forgetOldBody` hooks it does not own (it expires by tick instead, so no create-body edit). Two simultaneous lives hold separate state because each Body has its own view.
- **tests.** Default factories behave as the existing tests assert (the existing `fight-or-flee.test.ts` and `retreat.test.ts` pass unchanged: this is the off proof); with an aggression-1 policy an armed Body at health 9 flees where legacy fights; aggression 5 at health 3 fights; the band decision is made once per encounter and reused on the second hurt (draw count 1); a new encounter after the gap decides again; two Bodies, two policies, no shared state; the fight timer uses `fightLimitMs`; abort and timer cleanup still run (existing cases); creeper hiss and arrow sidestep tests unchanged.
- **checks** `GATE`; `./geldar.ps1 pnpm test golem/src/body/reflexes/fight-or-flee`, `retreat`, `encounter`, `threat-policy`, `combat`.
- **revert-checks** Make `decide` rerun per call: "one courage decision per encounter" fails. Hard-code `LOW_HEALTH = 6` again: "aggression 5 fights at health 3" fails. Make the default factory use a non-legacy policy: the existing unchanged tests fail.
- **worknote** `.../AN-08b.md` **commit** `feat(character): fight-or-flee and retreat take a per-life threat policy` **on-cap** R5; split line: factories and legacy proof first, encounter memory second.

## AN-09a: the XP evidence matrix and normalizer (sink, pure)

- **id** AN-09a **wave** W2 **depends-on** AN-07, AN-02b **size** 45k. **branch** `codex/an-09a-xp-matrix`.
- **may-edit** `eventsink/src/xp/matrix.ts` (new: data), `eventsink/src/xp/awards.ts` (new), `eventsink/src/xp/awards.test.ts` (new), `eventsink/src/xp/fixtures.ts` (new, real-shaped event fixtures captured from the Body's builders).
- **must-not-edit** R6; any database or writer code (AN-10a); Body code (AN-09b).
- **decisions** D-CS-04 (assumed; **every row below is proposed and needs the owner's approval in the P0 ADR**). ADR `<allocate via registry>` for the matrix.
- **deliver.**
  ```ts
  export interface XpAward { lifeId: string; domain: Domain; evidenceKey: string; sourceEventId: string; worldTick: number }
  export function awardsFor(event: WorldEvent): XpAward[];   // pure, never throws, [] for anything else
  ```
  The canonical source is the Body's own typed records. The `action_outcome` and `receipt` views of the same action are **not** award sources, so one accomplishment cannot arrive under two keys. Keys carry the type and the stable id.

  | Source event | Qualifies when | Domain | `evidence_key` |
  |---|---|---|---|
  | `action`, `state` completed, `kind` `attack` | `result.detail.killed === true` and `result.detail.target_kind === 'mob'` (AN-09b adds the field; a player target never awards) | combat | `kill:<action_id>` |
  | `action` completed `mine` | `detail.mined >= 1` and a `detail.collected[].item` is in `MINING_ITEMS` (data; unmeasured defaults the owner approves: names ending `_ore`, plus `cobblestone`, `stone`, `deepslate`, `cobbled_deepslate`, `raw_iron`, `raw_copper`, `raw_gold`, `coal`, `diamond`, `emerald`, `lapis_lazuli`, `redstone`) | mining | `mine:<action_id>` (one award per action, not per block, so a 64-block batch is not 64 XP) |
  | `action` completed `mine` | `collected` holds a crop item in `CROP_ITEMS` (`wheat`, `carrot`, `potato`, `beetroot`, `melon_slice`, `pumpkin`, ...) | farming (harvest) | `harvest:<action_id>` |
  | `action` completed `place` | `detail.block` is in `CROP_BLOCKS` (the values of `SEED_CROPS` in `golem/src/actions/place.ts`: crop blocks placed on farmland) | farming (sow) | `sow:<action_id>` |
  | `action` completed `craft` | `detail.crafted >= 1` | crafting | `craft:<action_id>` (one per craft operation, not per item in the stack) |
  | `intent` event, `state` completed | `program === 'build'` | building | `build:<intent_id>` (one per completed structure) |
  | `action` completed `give` | the Body completes `give` only when the recipient picked every tossed item up (`golem/src/actions/give.ts`), so completed means a committed transfer, not a toss; `detail.to` is not the life itself | social | `give:<action_id>` |
  | `chunk_visited` | always (AN-09b emits) | exploring | `chunk:<dimension>:<cx>:<cz>` |

  Not awarded in W2 (no speculative award; named for W8): kept promises, conversation exchanges, observed combat. `till` (present at `a1c6fb2a`) is preparation, not harvest or sow, so it awards nothing (`(to confirm)` with the owner). Failed, cancelled and `ok: false` records award nothing. An `action` event whose `agent_id` differs from `payload.life_id` awards nothing.
- **tests.** Each row: a positive fixture, a failure fixture, a cancel fixture; the same action seen as `action` completed twice (running then completed) yields one key; `action_outcome` and `receipt` fixtures yield no award; a `mine` of 64 blocks yields one award; a player target yields no combat award; a crop mined yields farming, not mining; `chunk_visited` yields one key per chunk and revisits the same key; unknown `kind` gives `[]`; malformed payload gives `[]` (never throws). Fixtures are captured by running the Body's own builders (`NatsRecordSink` test doubles), not hand-typed.
- **checks** `GATE`; `./geldar.ps1 pnpm test eventsink/src/xp/awards`.
- **revert-checks** Award per mined block instead of per action: "one award per mine action" fails. Count `action_outcome` as a source: "outcome and receipt views award nothing" fails.
- **worknote** `.../AN-09a.md` **commit** `feat(character): XP evidence matrix and pure award normalizer` **on-cap** R5; split line: combat, mining, farming rows first; crafting, building, social, exploring second.

## AN-09b: Body evidence producers (first chunk visit, attack target kind)

- **id** AN-09b **wave** W2 **depends-on** AN-07, AN-02b **size** 45k. **branch** `codex/an-09b-body-evidence`.
- **may-edit** `golem/src/body/evidence/chunk-visits.ts` (new) and `chunk-visits.test.ts` (new); `golem/src/actions/attack.ts` and `attack.test.ts` (add `target_kind` to the completed detail).
- **must-not-edit** R6; `golem/src/body/create-body.ts`, `adam-body.ts` (AN-12 attaches the watcher); the contract.
- **decisions** D-CS-04 (assumed). No number.
- **deliver.**
  ```ts
  export interface ChunkWatchOptions { bot: Bot; shard: string; lifeId: string; tick: () => number;
    publish: (event: WorldEvent) => void; now?: () => Date; log: (l: string) => void; maxKnown?: number /* default 20000 */ }
  export function watchChunkVisits(options: ChunkWatchOptions): () => void;   // returns stop()
  ```
  On the bot's movement it computes `cx = Math.floor(x / 16)`, `cz = Math.floor(z / 16)` and the dimension (`bot.game.dimension`; **to confirm** the mineflayer field), keeps a per-run `Set` of `dimension:cx:cz`, and emits one `chunk_visited` WorldEvent per new key. `source_event_id = eventIdFor('chunk_visited:' + lifeId + ':' + dimension + ':' + cx + ':' + cz)`, stable across restarts, so a restart re-walking a known chunk is the same event (the stream deduplicates inside its window; the `events.source_event_id` unique key and `xp_evidence`'s primary key make it permanent). Envelope validated before publish. Cap `maxKnown`: when exceeded, clear the set (a clear can only re-emit identical events). Emits nothing when the position is unknown. `attack.ts`: add `target_kind: 'player' | 'mob'` to the `completed({...})` detail in `afterKill` from the entity's `type` (`'player'` for a player entity, otherwise `'mob'`; **to confirm** mineflayer's `entity.type` values) and carry it in `KillRecord`.
- **checks** `GATE`; `./geldar.ps1 pnpm test golem/src/body/evidence`, `golem/src/actions/attack`. Cases: first entry emits, second entry into the same chunk emits nothing, a new chunk emits, dimension change counts as new, negative coordinates floor correctly (`-1` is chunk `-1`), a restart (fresh set) re-emits the same `source_event_id`, stop removes the listener, `attack` detail carries `mob` for a zombie fixture and `player` for a player fixture.
- **revert-checks** Use `Math.trunc` instead of `Math.floor`: "negative coordinates" fails. Drop the `Set`: "second entry emits nothing" fails.
- **worknote** `.../AN-09b.md` **commit** `feat(character): Body evidence for first chunk visits and attack target kind` **on-cap** R5; split line: chunk watcher first, attack field second.

## AN-10a: exactly-once XP: the evidence ledger and the increment, in one transaction

- **id** AN-10a **wave** W2 **depends-on** AN-09a, AN-04a **size** 45k. **branch** `codex/an-10a-xp-ledger`.
- **may-edit** `eventsink/src/xp/ledger.ts` (new), `ledger.test.ts` (new), `pg-xp-store.ts` (new), `xp-config.ts` (new); `eventsink/src/writer.ts` (one more branch in the existing transaction); `eventsink/src/writer.projection.test.ts`; `eventsink/test/xp.it.test.ts` (new, real DB, ops).
- **must-not-edit** R6; the AN-09a matrix; `eventsink/src/consumer.ts`; the Body cache.
- **decisions** D-CS-04, D-CS-07 (assumed). No number.
- **deliver.**
  ```ts
  export interface XpStore {
    lifeExists(lifeId: string): Promise<boolean>;
    insertEvidence(a: XpAward): Promise<boolean>;                  // INSERT ... ON CONFLICT (life_id, domain, evidence_key) DO NOTHING RETURNING 1
    bump(lifeId: string, domain: Domain, tick: number): Promise<{ xp: number }>; // INSERT ... ON CONFLICT (life_id, domain) DO UPDATE SET xp = proficiency.xp + 1, updated_tick = GREATEST(...) RETURNING xp
    setLevel(lifeId: string, domain: Domain, level: 1|2|3): Promise<void>;
    totalXp(lifeId: string): Promise<number>;
    enqueueLevel(lifeId: string, domain: Domain, level: 1|2|3, xp: number, version: number): Promise<void>; // INSERT ... ON CONFLICT (life_id, domain, level) DO NOTHING
  }
  export async function applyAward(store: XpStore, award: XpAward, thresholds: readonly [number, number, number]): Promise<{ awarded: boolean; level: number | null }>;
  export function xpEnabled(env: NodeJS.ProcessEnv): boolean;      // GELDAR_XP === '1'; default OFF
  export function xpThresholds(env: NodeJS.ProcessEnv): readonly [number, number, number]; // GELDAR_PROFICIENCY_THRESHOLDS "10,30,70" else DEFAULT_THRESHOLDS from psyche
  ```
  `applyAward` runs inside the writer's transaction, after the `events` insert, for each `awardsFor(event)` result. It inserts the evidence first; only when that insert **returned a row** does it `bump`; a redelivered or second-source accomplishment inserts nothing and bumps nothing (a plain `xp = xp + 1` per delivered event would double on redelivery; the writer invokes projections for every input event, even duplicates). If `levelForXp(xp)` rose, it `setLevel`s and `enqueueLevel`s with `version = totalXp`. An unknown life (`lifeExists` false, for example Adam without an `agents` row) counts `xp_skipped_unknown_life` in a log line and awards nothing, rather than raising an FK error that would dead-letter the event. With `xpEnabled` false (the default) `applyAward` is never called: **XP counting is off until ops sets `GELDAR_XP=1`**, and history is not backfilled. Thresholds come from psyche `DEFAULT_THRESHOLDS` and an env override (the sink has no shard file: see open items).
- **checks** `GATE`; `./geldar.ps1 pnpm test eventsink/src/xp/ledger`, `eventsink/src/writer.projection`; ops `$env:GELDAR_IT = '1'; ./geldar.ps1 pnpm test eventsink/test/xp`: duplicate delivery gives one XP; reordered `running`/`completed` records give one; two sources of one accomplishment give one; two concurrent transactions awarding different keys give two (no lost update); rollback after the evidence insert leaves no evidence and no XP; first, last, and past-threshold levels (9 to 10, 29 to 30, 69 to 70) enqueue exactly one outbox row each; a poison event follows the existing dead-letter path; an unknown life is skipped, not poisoned.
- **revert-checks** Bump `xp` without checking the evidence insert's result: the IT duplicate case and the unit "redelivery adds nothing" fail. Move `enqueueLevel` before `setLevel`'s guard: "one outbox row per level" fails.
- **worknote** `.../AN-10a.md` **commit** `feat(character): exactly-once XP ledger and increment in the sink transaction` **on-cap** R5; split line: ledger and increment first, levels and outbox second.

## AN-10b: level publication and reconciliation

- **id** AN-10b **wave** W2 **depends-on** AN-10a **size** 40k. **branch** `codex/an-10b-xp-outbox`.
- **may-edit** `eventsink/src/xp/outbox.ts` (new), `outbox.test.ts` (new); `eventsink/test/xp-outbox.it.test.ts` (new, ops).
- **must-not-edit** R6; `eventsink/src/main.ts` (AN-12 starts it); `geldar.ps1` (AN-12: the eventsink role needs publish on `geldar.<shard>.state.>`).
- **decisions** D-CS-04 (assumed). No number.
- **deliver.** A level change must reach the Body even if the process dies between the database commit and the publish. The outbox row is the durable record (written in AN-10a's transaction); this card publishes after commit and reconciles.
  ```ts
  export interface LevelPush { publish(subject: string, body: string): void }       // core NATS publish
  export function startOutboxPublisher(o: { pool: Pool; push: LevelPush; intervalMs?: number /* default 2000 */; batch?: number /* default 100 */; log: (l: string) => void }): { stop(): Promise<void>; drainOnce(): Promise<number> };
  ```
  `drainOnce`: in a transaction, `SELECT ... FROM proficiency_outbox o JOIN agents a ON a.agent_id = o.life_id WHERE o.published_at IS NULL ORDER BY o.outbox_id LIMIT $1 FOR UPDATE SKIP LOCKED` (the shard comes from `agents.shard`, so the sink needs no shard setting); for each row `push.publish(proficiencyPushSubject(shard, life_id), JSON.stringify(ProficiencyLevelPayload))` validated with `validateProficiencyLevelPayload`; then `UPDATE ... SET published_at = now()`. A crash after the publish and before the update republishes the row: delivery is at least once, and the receiver is monotonic (AN-11b), so a duplicate is harmless. The same loop is the reconciliation: every unpublished row is retried each interval, so a NATS outage only delays pushes (the request path, AN-11a, is the source of truth). The push is never a WorldEvent, so it cannot feed back into XP (the discriminator is the subject: `state` subjects are not in the stream filter).
- **checks** `GATE`; `./geldar.ps1 pnpm test eventsink/src/xp/outbox`; ops `GELDAR_IT=1`: crash between commit and publish (kill the publisher after `publish` and before the update) republishes once more; transient NATS failure keeps the row unpublished and succeeds later; two publishers do not double-claim a row (`SKIP LOCKED`); a payload failing the contract is logged and left unpublished with a counter, not deleted.
- **revert-checks** Mark `published_at` before publishing: the crash case fails. Drop `SKIP LOCKED`: the two-publisher case fails.
- **worknote** `.../AN-10b.md` **commit** `feat(character): publish and reconcile proficiency level changes` **on-cap** R5; split line: drain first, interval loop second.

## AN-11a: the proficiency state service (sink side)

- **id** AN-11a **wave** W2 **depends-on** AN-10b, AN-02b **size** 45k. **branch** `codex/an-11a-state-service`.
- **may-edit** `eventsink/src/state/service.ts` (new), `service.test.ts` (new), `pg-state-store.ts` (new); `eventsink/test/state.it.test.ts` (new, ops, real NATS roles).
- **must-not-edit** R6; `eventsink/src/main.ts`, `geldar.ps1`, `compose/*` (AN-12); the Body.
- **decisions** D-CS-04, D-CS-03 (assumed: the reply carries the adopted baseline, R-sheet). No number.
- **deliver.**
  ```ts
  export interface StateStore { read(lifeId: string): Promise<ProficiencyState | null> }   // null: no agents row
  export function serveProficiencyState(o: { nc: NatsConnection; store: StateStore; shard: string; log: (l: string) => void; minIntervalMs?: number /* default 1000 per life */ }): { stop(): Promise<void> };
  ```
  Subscribes to `geldar.<shard>.state.*.proficiency` (five tokens; the role's `geldar.<shard>.state.>` allow, added by AN-12). For each request: reject a body over 256 bytes; parse the life id from the subject and validate it with the contract pattern (a bad one gets no reply); apply a per-life minimum interval (an over-rate request gets `{"error":"rate"}`); `store.read` returns the seven levels from `proficiency` (zeros when no rows), `version = sum(xp)`, and the adopted `sheet` and `sheet_hash` when `agents.character_sheet` is set; the reply is validated with `validateProficiencyState` before it is sent; an unknown life answers `{"error":"unknown_life"}`; a database error answers `{"error":"unavailable"}` (the Body then uses its degraded default). The subject carries the life id, and roles are not scoped per life (`Get-NatsUsers` says so), so **any Body role can ask for any life's state**: this is an open item, not solved here.
- **checks** `GATE`; `./geldar.ps1 pnpm test eventsink/src/state/service`; ops with real roles: a `body` credential gets a reply; an `mcp` credential's request is refused by the server (no publish right on `geldar.<shard>.state.>`); a wrong-shard request gets no reply (no subscription).
- **revert-checks** Compute `version` from a row count instead of `sum(xp)`: "version is strictly monotonic with XP" fails. Skip response validation: "reply validates against the contract" fails on a deliberately corrupted store.
- **worknote** `.../AN-11a.md` **commit** `feat(character): sink service for proficiency state requests` **on-cap** R5; split line: read model first, NATS service second.

## AN-11b: the Body's proficiency cache

- **id** AN-11b **wave** W2 **depends-on** AN-07, AN-02b, AN-03b **size** 45k. **branch** `codex/an-11b-body-cache`.
- **may-edit** `golem/src/character/proficiency-cache.ts` (new), `proficiency-cache.test.ts` (new).
- **must-not-edit** R6; the reflexes; `adam-body.ts` (AN-12); no `pg` import in `golem/src` (Golem has no Postgres; a test greps for it).
- **decisions** D-CS-04, D-CS-07 (assumed: zero proficiency until a fresh state arrives, record degraded, keep a previously validated newer cache across reconnects; emergency reflexes never wait on this). No number.
- **deliver.**
  ```ts
  export interface StateTransport {
    request(subject: string, body: string, timeoutMs: number): Promise<string>;     // rejects on timeout or no responders
    subscribe(subject: string, onMessage: (body: string) => void): () => void;      // returns unsubscribe
  }
  export class ProficiencyCache {
    constructor(o: { transport: StateTransport; shard: string; lifeId: string; thresholds?: readonly [number, number, number];
      timeoutMs?: number /* 2000 */; attempts?: number /* 3 */; retryMs?: number /* 15000 */; log: (l: string) => void });
    async start(): Promise<void>;                       // subscribe first, then request; never throws
    level(domain: Domain): 0 | 1 | 2 | 3;               // always answers, from memory
    get version(): number;  get degraded(): boolean;  get baseline(): { sheet: CharacterSheet; hash: string } | null;
    refresh(): Promise<void>;                           // used on reconnect
    stop(): void;                                       // unsubscribes, cancels the retry timer
  }
  ```
  Rules: subscribe to the push subject **before** the first request, so a level change during start is not lost. A state (reply or push) is accepted only if `version >= this.version` and it validates (`validateProficiencyState` or `validateProficiencyLevelPayload`); an older or equal-version message is ignored, never downgrading a reconnected cache. After `attempts` failures it stays `degraded: true` with zeros, logs once, and retries every `retryMs` (bounded, cancelled on `stop`). `level()` never blocks. The cached `baseline` is the adopted sheet from the reply (R-sheet), used by AN-12 in preference to the config sheet.
- **checks** `GATE`; `./geldar.ps1 pnpm test golem/src/character/proficiency-cache`. Cases: cold start, reply sets levels; no responder gives degraded zeros and a retry; a stale reply after a newer push is ignored; a level-up push during a reconnect refresh is kept; equal version is ignored; timeout and cap behave (3 attempts then stop trying until `retryMs`); `stop` unsubscribes and cancels the timer (a spy transport); an invalid reply is ignored and logged; no `pg` import.
- **revert-checks** Accept any version: "a stale reply never downgrades" fails. Subscribe after the first request: "a push during start is not lost" fails.
- **worknote** `.../AN-11b.md` **commit** `feat(character): Body proficiency cache with monotonic versions` **on-cap** R5; split line: cache first, retry and degraded handling second.

## AN-12: Body and learning integration, inactive by default

- **id** AN-12 **wave** W2 **depends-on** AN-08b, AN-09b, AN-10b, AN-11a, AN-11b **size** 50k plus a serial ops run. **branch** `codex/an-12-integration`. **Shared-wiring, shard, ACL and image owner of W2.**
- **may-edit** `golem/src/adam/adam-body.ts` and `adam-body.test.ts`; `golem/src/body/create-body.ts` (`enabledReflexes(config, character?)` and a `CreateBodyOptions.threat?: ThreatPolicy`, handed to `createCombatReflexes`); `golem/src/body/restart.ts` (only to pass the option through `RestartBodyOptions`, which extends `CreateBodyOptions`); `golem/src/adam/main.ts`, `golem/src/players/main.ts` (build the `StateTransport` from the host's NATS connection and a `ProficiencyCache`); `golem/src/character/runtime.ts` (new: builds the `ThreatPolicy` from the sheet, `rolls`, the cache's combat level, `rngFor`, `AuditPublisher`), `runtime.test.ts` (new); `eventsink/src/main.ts` (start the state service and the outbox publisher, and wire `applyAward` when `xpEnabled`); `geldar.ps1` (`Get-NatsUsers`: `eventsink` Pub and Sub gain `geldar.$s.state.>`, `body` Sub gains `geldar.$s.state.>`); `compose/colo.yml` and `compose/phase0.yml` (eventsink env `GELDAR_SHARD`, `GELDAR_XP`, `GELDAR_PROFICIENCY_THRESHOLDS`, all unset by default; to confirm the eventsink service has no shard env today); `shards/phase0.yaml` (a **disposable fixture block** is added only under a new shard file `shards/character-fixture.yaml` (new), never the live ones); `tools/repo-checks/src/nats-auth*.test.ts` (extend); the focused live fixtures under `golem/src/live-*.test.ts` names `(to confirm)`.
- **must-not-edit** R6; `animus/*`; `shards/colo-mind.yaml` (the live Colo; no activation, D-HC-11, D-CS-10); `docs/*`.
- **decisions** D-CS-10 (reviewable activation proposal only: this card ships inactive, **never turns on the Colo**). No number.
- **deliver.** With `character.mode: sheet`: the Body builds `character/runtime` from `LifeCharacter` (sheet from the cache's adopted baseline when present, else the config sheet; `rolls` from config), passes `createCombatReflexes(policy)` to the runtime, attaches `watchChunkVisits` (publish through the stamped publisher), starts the `ProficiencyCache` (request on start, refresh on reconnect), and records every threat roll or deterministic decision through `AuditPublisher` with a `DrawKey` whose `generation` is the Body's generation (so restarts never replay a draw). With `mode: off` or no `character`: none of that is built, the reflex list is `combatReflexes` as today, no chunk watcher, no cache, no events. Eventsink: starts the state service and outbox publisher only when `GELDAR_SHARD` is set; `applyAward` only when `GELDAR_XP=1`. The ACL edit gives the sink publish and subscribe on the shard's `state` subtree and the Body subscribe on it; nothing else widens (`mcp`, `mind`, `kino`, `paper` unchanged; a test asserts each).
  Frozen treatment fixtures (files only, for the W12 cohort and the ranger activation proposal): `shards/character-fixture.yaml` with three Bodies, an all-3 sheet, an aggression-1 sheet and an aggression-5 sheet, and `rolls: true`. A reviewable "ranger activation proposal" is a worknote table of proposed sheets and flags; no value is applied.
- **checks** `GATE`; `./geldar.ps1 pnpm test golem/src/adam`, `golem/src/body`, `golem/src/character`, `golem/src/players`, `eventsink`, `tools/repo-checks`. **Ops, serial, wave close:** full `./geldar.ps1 check` with the integration floor; disposable fixtures on a scratch stack (never `adam up`): a sovereign Body and a second Body earn and reload the same domain level (kill a Body mid-fight and mid-award: no evidence lost, no double XP on restart); the aggression-1 and aggression-5 Bodies show different nerve at the same health; `mode: off` shows the old behaviour and zero new events; `./geldar.ps1 bench` 20 TPS gate; the live lane `./geldar.ps1 pnpm --filter @geldar/golem test:live` (8B only, serial); Adam's `agents` row must exist (see open items). `GELDAR_IT=1 ./geldar.ps1 pnpm test eventsink`.
- **revert-checks** Always build `createCombatReflexes(policy)` even when off: "off builds the legacy reflex list" fails. Drop the cache's version check at the wiring: "stale push after restart" fails. Remove the sink ACL line: the repo-checks role test "eventsink may publish and subscribe on the state subtree" fails.
- **worknote** `.../AN-12.md` **commit** `feat(character): bind threat policy, evidence and proficiency cache to the Body, inactive by default` **on-cap** R5; split lines: `AN-12a` Body wiring, `AN-12b` sink wiring, ACL and fixtures.

---

## Open items

**Not verified (marked in the cards)**
- Kit field names `harness` and `model` (HC-04): working names only. How the kit's per-waking model reaches the world is undefined; until then the model is operator-declared (GX-01c).
- Generator support for `if/then` in a schema (AN-02a), the exact pnpm 12 lockfile flags (AN-03a), mineflayer's `bot.game.dimension` and `entity.type` values (AN-09b), the file that holds the NATS role-table tests and the live-lane file names (AN-07, AN-12), whether the eventsink compose service has a `GELDAR_SHARD` env (AN-12), the eventsink Postgres role (every service connects as the owner today; role denial for the sink cannot be proven), the `export:` format of the C7 own-rows export (AN-04b), the owner's approval of the matrix rows, `MINING_ITEMS` and the unarmed-exception row of the D-CS-05 table.

**Differences between the original plan (`8eac28ba`) and `origin/main` (`907f5b8a`, head `a1c6fb2a`)**
1. `origin/main` moved during this work to `a1c6fb2a` (the `till` action only, `golem/src/actions/till.ts`).
2. `body-api/v7` now exists (till, decision 0167); the original W7 plan took v7. Thought v6 and v7 are still unused on main but reserved. Decisions 0180 and 0181 exist (the context window is 8704, not 8192, which matters to the kit's budgets, not these cards).
3. SQL: 0024 to 0027 and 0032 to 0034 are on main (0028 to 0031 are missing); 0035 and 0036 and decisions 0169 and 0173 are on in-flight branches. The original "0033/0034 free" reading is wrong; 0037 and up is the recommendation.
4. `contract/schemas/shard-config.schema.json` validates only the flat colo budget keys, not the `mind`, `sovereign`, `chat` blocks: the `character:` block has no schema, only loaders (the original plan assumed a schema edit might be enough and said it was not).
5. `parsePlayerConfig` rebuilds `mind.agent` from only the username and name, so a per-player sheet, `harness` or `model` key is dropped unless passed through explicitly (AN-05, GX-01b).
6. Supervisor-created Body containers (`supervisor/src/docker.ts`) set `GELDAR_LOGIN_NAME`, but nothing in `golem/` reads it at `907f5b8a`: the owner-created Body path has no config consumer to wire. The only Body hosts with per-player config are `players/main.ts` (reads `sovereign.players[]` from the shard file) and `adam/main.ts`. Not solved here.
7. `WorldEvent` already has `thinker_id`, and `events` already has the column; the stamp follows that precedent.
8. `fightOrFleeReflex`, `retreatReflex` and `combatReflexes` are module constants: AN-08b converts them to factories while keeping the exports.
9. `attack` can target a player by name (`findTarget`), so combat XP needs a `target_kind` field the Body does not record today (AN-09b).
10. `threshold/mcp` imports `@geldar/animus` source (`mind-event.ts`, `classify.ts`) and the admin image copies `animus/`: the "abandoned" `animus/` package stays in the repo, frozen.
11. Adam's `agents` row is created by the Mind (`animus/src/memory/pg-memory-store.ts` `ensureAgent`). With the Mind off, Adam's Body has no row, so every audit and XP table (all keyed to `agents`) would reject its rows. W2 fixtures use sovereign players, or ops inserts Adam's row; `applyAward` skips an unknown life instead of poisoning.
12. `REFLEX_NAMES` now includes `dark_shelter` and `unstick`; `parseReflexConfig` rejects unknown keys, which is why `character` is a separate top-level block.
13. SQL grants are column-level everywhere: new columns reach no role until granted, and `geldar_mcp` could not read `agents.declared_model` (GX-01a grants it).
14. The campaign folder `docs/analysis/character-sheet/` is not on `origin/main` (untracked in the Codex worktree at `8eac28ba`); the worknote paths need it created (P0).

**Top risks**
- The HC-04 name reconciliation (GX-01a, GX-01b, GX-01c, and the kit's `psyche` mirror depend on it).
- Generated-file merge order: GX-01a, AN-02a and AN-02b must merge strictly serially, or `contract/src/generated/*` conflicts.
- `adam-body.ts` is touched by GX-01b, AN-07, AN-12 (and later waves): the order above is the only safe one.
- Any later edit to `psyche/src/` without `--write`, a version bump and a new tag breaks the kit's mirror test (GX-02 makes CI fail first, by design).
- Sheet truth on the world database: `events.payload` of `sheet_adopted` and the `agents` columns hold true sheets; the leak guards are the Glass column grants, the `MIND_EVENT_TYPES` guard test (AN-07) and the Body-only state subject. The state subject is not scoped per life (open item below).

**Decisions or tasks left to the owner or orchestrator**
- Per-life scoping of the state subject: static NATS roles cannot scope by life, so any Body credential may ask for any life's state and baseline sheet. Acceptable only while all Bodies are ours; flag before bring-your-own-body.
- Where eventsink gets its XP thresholds (env override now; the brief says shard setting). Recommend mounting the shard file read-only into the sink.
- Self-registered creation (`register_create_player`, 0010 to 0012) leaves `agents.character_sheet` NULL; a NULL baseline is "not adopted" and the first Body start adopts its config or standard sheet. Changing the definer functions is a separate migration if the owner wants adoption at birth.
- `pack` of a release tarball is not built; the artifact is the tag plus `psyche/RELEASE.json`.
- Plugin-published events that carry an `agent_id` (the Java `EventExporter`: damage, death and the like) are **not** stamped by GX-01; the cohort report joins them on `agents.harness` and `declared_model`. A sink-side fill from the `agents` row is the follow-up (a GX-01d) if the owner wants every row stamped.
