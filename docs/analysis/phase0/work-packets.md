# Phase 0 work packets

Ledger and status: [README.md](README.md). Process: [campaign-packet skill](../../../.claude/skills/campaign-packet/SKILL.md).

## Dispatch rules (every packet)

Each packet is self-contained: the coder skips CLAUDE.md, so these rules travel with it.

1. Work only in the worktree named in your brief. PowerShell 7 only. Run every pnpm command as `./geldar.ps1 pnpm <args>` from the worktree root: it puts the pinned pnpm on PATH, including for scripts that call pnpm again (plain `corepack pnpm typecheck` fails on those). In a new worktree run `./geldar.ps1 setup` first.
2. Create or change only the files your packet lists. Never edit `docs/spec.md`, generated code, or another packet's files.
3. Pin exact versions, only the ones the packet names: `./geldar.ps1 pnpm add -E -D <pkg>@<version> --filter <package>` (drop `-D` for a runtime dependency). Images by digest: resolve with `docker buildx imagetools inspect <image>:<tag>` and write `<image>:<tag>@sha256:<digest>`.
4. TypeScript: ESM, `.ts` import specifiers (`import { x } from './x.ts'`), no enums, namespaces or parameter properties (`erasableSyntaxOnly`). Each package's `tsconfig.json` extends the root `tsconfig.base.json` by relative path (`../tsconfig.base.json` for a top-level package). Tests are `*.test.ts` under `src/` or `test/`, run by the root `pnpm test`.
5. Files stay under 700 lines (soft cap 500). No `utils.ts` or `helpers.ts`. LF line endings. No secrets, account names, or public or private-network IPs (`127.0.0.1` is fine); local passwords live in `.env` (gitignored) with working defaults in `.env.example`.
6. Run the packet's checks in order, ending with `./geldar.ps1 check` from the worktree root. Five fix rounds per check at most, then stop and report.
7. Confirm each new test fails without the change it guards (revert locally, run, restore) and say so in the report.
8. Commit once with the message in your brief. Never `git stash`, `git push`, `gh pr` or `git worktree prune`.
9. Report to the path in your brief; return one line: `<packet> <done|blocked|failed> <commit-sha|-> <report-path>`.

## Contract (what packets build against)

**Workspace.** Root `package.json` scripts: `lint`, `typecheck` (runs each package's `typecheck`), `test` (one Vitest run), `check:repo`, `check:generated` (runs each package's `check:generated`). `pnpm-workspace.yaml` already lists `contract`, `golem`, `animus`, `lantern-local`, `eventsink`, `glass`, `tools/*`.

**`@geldar/contract` layout** (created by P0-01, extended by P0-02 to P0-04):

```
contract/
  package.json            name @geldar/contract, "type": "module", "exports": { ".": "./src/index.ts" }
  tsconfig.json           extends ../tsconfig.base.json, include ["src", "scripts", "test"]
  schemas/<name>.schema.json      the source of truth, JSON Schema draft 2020-12
  scripts/generator.ts    exports generate(): Promise<Map<path, text>> and findStale(): Promise<string[]>
  scripts/generate.ts     CLI only: node scripts/generate.ts           -> writes src/generated/*
                                    node scripts/generate.ts --check   -> exits 1 and lists files that differ
  src/generated/types.ts          generated: one exported type per schema (json-schema-to-typescript)
  src/generated/validators.js     generated: Ajv standalone ESM, one export per schema
  src/generated/validators.d.ts   generated: declarations for validators.js
  src/index.ts            hand-written: re-exports the types and one typed function per schema
  test/<name>.test.ts     fixtures that must pass and must fail
```

Each schema file has `"$schema": "https://json-schema.org/draft/2020-12/schema"`, `"$id": "https://geldar.dev/schemas/<name>.schema.json"`, a `"title"` in PascalCase (it becomes the TypeScript type name), and `"additionalProperties": false` on every object. Shared definitions live in `common.schema.json` under `$defs` and are referenced as `"common.schema.json#/$defs/<Name>"`.

`src/index.ts` exports, per schema, the type and a validator:

```ts
export type { Snapshot } from './generated/types.ts';
export function validateSnapshot(value: unknown): ValidationResult<Snapshot>;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };   // "<instancePath> <message>", e.g. "/self/health must be <= 20"
```

`src/index.ts` has one marked block per packet (`// --- P0-01 snapshot ---`, `// --- P0-02 thought ---`, `// --- P0-03 records ---`, `// --- P0-04 thinker ---`), created empty by P0-01. Each later packet fills only its own block. P0-02, P0-03 and P0-04 run in parallel and all regenerate `src/generated/*`, so those files conflict when the wave branch merges them: the orchestrator resolves by keeping every block in `index.ts`, taking either side of each generated file, rerunning `./geldar.ps1 pnpm --filter @geldar/contract generate`, and committing the result. Coders don't resolve these conflicts.

**Schemas and owners:**

| File | Title | Spec | Packet |
|---|---|---|---|
| `common.schema.json` | (definitions only) | section 7, Appendix A | P0-01 |
| `snapshot.schema.json` | `Snapshot` | Appendix A | P0-01 |
| `thought.schema.json` | `Thought` (with `Intent`, `Action` in `$defs`) | Appendix C, 5.3.1 | P0-02 |
| `action-record.schema.json` | `ActionRecord` | section 7, Appendix D `actions` | P0-03 |
| `receipt.schema.json` | `Receipt` | section 7, Appendix D `receipts` | P0-03 |
| `event.schema.json` | `WorldEvent` | section 7, Appendix D `events` | P0-03 |
| `thinker-frame.schema.json` | `ThinkerFrame` (union of every frame) | Appendix H | P0-04 |

**Identifiers** (`common.schema.json` `$defs`). A ULID is `^[0-9A-HJKMNP-TV-Z]{26}$`. Prefixed IDs are `<prefix>_<ULID>`:

| `$defs` name | Prefix | Example |
|---|---|---|
| `SnapshotId` | `sn_` | `sn_01HZX3V9Q4M2K8R7T6Y5W4E3D2` |
| `ThoughtId` | `th_` | |
| `IntentId` | `in_` | |
| `ActionId` | `ac_` | |
| `ReceiptId` | `rc_` | |
| `EventId` | `ev_` | |
| `JobId` | `jb_` | |
| `LifeId` | `ag_` + name + `_` + two or more digits: `^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$` | `ag_kestrel_01` |

Also in `common.schema.json`: `Position` (`x`, `z` integers in ±30,000,000; `y` integer −64 to 320), `SelfPosition` (the three `Position` fields plus optional `biome`, `^[a-z_]{1,64}$`; written out in full, since `additionalProperties: false` doesn't combine with `allOf`), `ItemName` (`^[a-z0-9_]{1,64}$`, Minecraft item IDs without the `minecraft:` prefix), `ItemStack` (`item`, `count` 1–64, optional `book_id`), `WorldTick` (integer ≥ 0), `ShardName` (`^[a-z][a-z0-9-]{1,31}$`).

**Generator (D-P0-09).** `json-schema-to-typescript@16.0.0` for types; `ajv@8.20.0` with `ajv-formats@3.0.1`, Ajv `Ajv2020` class, `strict: true`, `allErrors: true`, standalone code with `code: { source: true, esm: true }`. Generated files start with `// Generated by contract/scripts/generate.ts. Do not edit.` Output must be byte-identical between runs (sort keys and schemas by name) so `--check` is stable on Windows and Linux. Cross-file `$ref`s resolve from the local `schemas/` folder, never over the network: load every schema into Ajv with `addSchema` before compiling, and give json-schema-to-typescript `cwd: <schemas dir>` (with `$refOptions` if needed). If a `$ref` still triggers a network fetch, stop and report rather than inlining definitions.

## Wave 1 — the contract and a healthy stack (ships as the wave 1 PR)

Packet worktrees branch from the integration branch `phase0/wave1` (created from `main` when the wave starts), not from `main`; the orchestrator merges each packet branch into `phase0/wave1` with `git merge --no-ff` once its review says `ship`. P0-02, P0-03 and P0-04 branch from `phase0/wave1` after P0-01 is merged into it.

### P0-00 — Threat model

- **Implementer:** a Sonnet general-purpose agent (design writing, not a packet-coder packet). Branch `phase0/p0-00-threat-model`, worktree `p0-00`. Commit: `docs: add the Phase 0 threat model`.
- **Spec:** section 8 (all of it), section 10 Phase 0 ("Write `docs/threat-model.md`; it shapes interfaces even though nothing is exposed"), Appendix H.
- **Create:** `docs/threat-model.md`, at most about 250 lines.
- **Contents:**
  1. Scope: what Phase 0 runs (one PC, compose stack, Ollama on the host) and what it doesn't (no Gateway, Envoy, step-ca, DMZ, Entra, ghosts).
  2. Assets, actors and trust boundaries, condensed from 8.1, marking each "exists in Phase 0" or "later".
  3. Phase 0 surfaces, each with its exposure and the control: Paper (offline mode, localhost only), RCON (localhost, random password from `.env`), Postgres, NATS (no auth, localhost only), the local Thinker WebSocket (no auth, localhost only), Ollama (host). Rule: no port binds to anything but `127.0.0.1` in Phase 0.
  4. **Interface rules that hold from day one** so security bolts on later without changing them: identity comes from the transport, never the payload (Appendix H); a completion is accepted only for a `job_id` issued to that connection, unanswered and before its deadline; frame and text size limits; strict schema validation with `additionalProperties: false`; actions carry `life_id`, `body_generation` and expiry so stale plans never run (section 7); agents have zero command permissions; nothing gives a human a way to act in the world (Principle 1).
  5. Agent-to-agent prompt injection is in-world behavior (Principle 5), not a vulnerability; injection that reaches infrastructure (the validator, the Mind, the host) is.
  6. Open items for Phase 2, linked to spec 8.x.
- **Check:** links resolve; nothing contradicts spec section 8 without saying so. No code, no tests.

### P0-01 — `contract/` package, generator, drift check, snapshot schema

- **Branch** `phase0/p0-01-contract`, worktree `p0-01`. Commit: `feat(contract): add the contract package, generator and snapshot schema`.
- **Spec:** Appendix A; section 7 (identifiers); decision record `docs/decisions/0001-contract-json-schema.md`.
- **Create** the layout in the Contract section above: `contract/package.json`, `contract/tsconfig.json`, `contract/scripts/generator.ts`, `contract/scripts/generate.ts`, `contract/schemas/common.schema.json`, `contract/schemas/snapshot.schema.json`, `contract/src/index.ts`, `contract/src/generated/*` (by running the generator), `contract/test/snapshot.test.ts`.
- **Dependencies** (devDependencies of `@geldar/contract`, exact): `json-schema-to-typescript@16.0.0`, `ajv@8.20.0`, `ajv-formats@3.0.1`. `ajv` is also needed at runtime only if the standalone output imports from it (it does for some formats): then make `ajv` and `ajv-formats` regular dependencies.
- **`package.json` scripts:** `"generate": "node scripts/generate.ts"`, `"check:generated": "node scripts/generate.ts --check"`, `"typecheck": "tsc -p . --noEmit"`.
- **`snapshot.schema.json`:** every field of Appendix A; `self.position` is a `SelfPosition` (Appendix A gives it a `biome`). Required: `snapshot_id`, `agent_id` (a `LifeId`), `shard`, `world_time`, `self`, `surroundings`, `heard`, `events_since_last_thought`. Bounds: `health` and `hunger` 0–20; `armor` 0–20; `budget_remaining_thoughts` integer ≥ 0; `world_time.time_of_day` one of `dawn`, `day`, `dusk`, `night`; `weather` one of `clear`, `rain`, `thunder`; `heard[].text` ≤ 256 chars; `heard` at most 50 items; `events_since_last_thought` at most 100 items, each `{ "type": string, ... }` with `type` matching `^[a-z][a-z_]{0,47}$` and other properties allowed (event payloads are typed later; this one object may set `additionalProperties: true`, with a `description` saying why). `current_plan` and `stuck` may be `null`. Add `revision` (integer ≥ 0, required): the snapshot revision the attention controller compares plans against (spec 5.3.2).
- **Generator behavior:** read every `schemas/*.schema.json` sorted by name, compile with Ajv (fail with the Ajv error if a schema is invalid), emit types and validators, and write them with LF endings. `--check` builds the same output in memory and compares it to the files; on a difference print `out of date: <path>` for each and exit 1, telling the reader to run `pnpm --filter @geldar/contract generate`.
- **Test (`contract/test/snapshot.test.ts`):** the Appendix A example (with `revision: 0` and IDs made valid ULIDs) passes `validateSnapshot`. Each of these fails, and some error string contains the named text: `self.health: 21` (`/self/health`), `agent_id: "kestrel"` (`/agent_id`), a missing `agent_id` (`agent_id`), an unknown top-level property `foo` (`foo`). For the last two the property name appears in Ajv's `params`, not its `instancePath`, so the error formatter must append it (for example `"" must have required property 'agent_id'`). A second test calls `findStale()` from `scripts/generator.ts` and expects an empty list: it fails if a schema changes without regenerating, which is the drift guard.
- **Checks** (each as `./geldar.ps1 pnpm <args>`): `--filter @geldar/contract generate`, `typecheck`, `test`, `check:generated`; then `./geldar.ps1 check`. Then edit one schema description without regenerating and confirm `check:generated` fails; restore.
- **Watch for:** Node strips types only outside `node_modules`. Workspace packages resolve through a symlink to their real path, so `import { validateSnapshot } from '@geldar/contract'` should work from another package; if it doesn't, report it rather than adding a build step.

### P0-02 — Thought schema: intents and actions

- **Depends on** P0-01 merged into the wave branch. Branch `phase0/p0-02-thought`, worktree `p0-02`. Commit: `feat(contract): add the thought, intent and action schemas`.
- **Spec:** Appendix C, 5.3.1, 5.2 (Body API table).
- **Create:** `contract/schemas/thought.schema.json`, `contract/test/thought.test.ts`. **Change:** `contract/src/index.ts` (export `Thought`, `Intent`, `Action`, `validateThought`). Regenerate.
- **Shape:** `reasoning` string ≤ 600 chars (the spec's "≤ 80 words"; put that in `description`); `say` string ≤ 256 or `null`; `intent` (`$defs/Intent`) optional; `actions` array of `$defs/Action`, `maxItems: 6`, optional. At least one of `intent`, `actions` or a non-null `say` (use `anyOf` of three `required` branches, the `say` branch with `"say": { "type": "string" }`).
- **`Intent`:** `goal` (`^[a-z][a-z0-9_]{0,63}$`), `program` (one of `travel`, `gather`, `craft`, `build`, `rest`, `flee`, `follow`, `trade_wait`, or a skill name `^[a-z][a-zA-Z0-9_]{0,63}$`), `arguments` (object), `preconditions` (array of identifiers, ≤ 16), `wake_on` (array, ≤ 16, of `directly_addressed`, `precondition_failed`, `unexpected_damage`, `goal_completed`, or `^new_agent_within_[0-9]{1,2}$`), `limits` (`max_world_ticks` 1–240000, `max_block_operations` 1–10000), optional `checkpoint` (object). Required: `goal`, `program`, `arguments`, `wake_on`, `limits`.
- **`Action`:** `oneOf`, one branch per verb in Appendix C, each with `"do": { "const": "<verb>" }` and only that verb's fields: `goto` (`target`: `Position` or an agent name `^[A-Za-z0-9_]{3,16}$`), `mine` (`block`, `count` 1–256), `craft` (`item`, `count` 1–64), `place` (`block`, `at`: `Position` or `feet`), `build` (`blueprint`: `name` plus `blocks` ≤ 512 of `{ block, dx, dy, dz }`), `attack` (`target`), `eat`, `sleep`, `give` (`to`, `item`, `count`), `write_sign` (`text` ≤ 60), `write_book` (`title` ≤ 32 and exactly one of `skill_id` or `text` ≤ 8192), `read_book`, `use_skill` (`name`, `args`), `define_skill` (`name`, `description` ≤ 256, `code` ≤ 8192), `offer` (`item`, `count`), `propose` (`rule`, `value`, `reason` ≤ 256), `vote` (`proposal_id` `^pr_`, `vote` `yes`|`no`), `note` (`text` ≤ 512), `wait` (`seconds` 1–600), plus the container verbs from 5.2: `open` (`at`: `Position`), `deposit` and `withdraw` (`at`, `item`, `count`). Item and block names use `ItemName`.
- **Test:** the Appendix C example's actions, each as its own one-action thought (with `blueprint.blocks` filled in), pass. These fail: seven actions; `{}`; `say: null` alone; `{ "do": "mine", "block": "oak_log", "count": 0 }`; `{ "do": "fly" }`; `{ "do": "eat", "item": "bread" }` (extra field); an intent with `program: "Travel!"`.
- **Checks** (each as `./geldar.ps1 pnpm <args>`): `--filter @geldar/contract generate`, `typecheck`, `test`, `check:generated`; then `./geldar.ps1 check`.

### P0-03 — Action record, receipt and event envelope schemas

- **Depends on** P0-01. Branch `phase0/p0-03-records`, worktree `p0-03`. Commit: `feat(contract): add action record, receipt and event schemas`.
- **Spec:** section 7 (distributed action protocol), Appendix D (`actions`, `receipts`, `events`), decision D-P0-10 in the ledger.
- **Create:** `contract/schemas/action-record.schema.json`, `contract/schemas/receipt.schema.json`, `contract/schemas/event.schema.json`, `contract/test/records.test.ts`. **Change:** `contract/src/index.ts`. Regenerate.
- **`ActionRecord`:** `action_id`, `intent_id` (nullable: a thought's immediate actions have no intent), `life_id`, `body_generation` (integer ≥ 0), `sequence` (integer ≥ 0), `source_snapshot_id`, `snapshot_revision` (integer ≥ 0: the snapshot `revision` the plan was made from, which the Body compares against its current one, spec 5.3.2), `expires_tick`, `kind` (the action's `do` verb), `args` (object), `state` (`accepted`, `running`, `completed`, `failed`, `cancelled`), `result` (object or null), `receipt_id` (nullable). All required.
- **`Receipt`:** `receipt_id`, `action_id`, `life_id`, `kind`, `phase` (`prepared`, `committed`, `aborted`), `at` (`date-time`), optional `item`, `count`, `credits` (integer), `detail` (string ≤ 256). Put D-P0-10's rule (decision 0020) in the schema `description`: every action ends with one `committed` or `aborted` receipt; economic kinds (`offer`, `give`, `write_book`, `read_book`) first write a `prepared` receipt. Each receipt is its own row with its own `receipt_id`; `(action_id, phase)` is unique.
- **`WorldEvent`:** `source_event_id` (`EventId`), `at` (`date-time`), `shard`, `world_day` (integer ≥ 0), `world_tick`, `type` (`^[a-z][a-z_]{0,47}$`; list the section 7 types in `description`), optional `agent_id`, optional `thinker_id`, `payload` (object). Subject rule in `description`: published on NATS `geldar.<shard>.<type>` (Appendix F).
- **Test:** a valid example of each passes; these fail: a record with `state: "done"`; a receipt with `phase: "pending"`; an event whose `source_event_id` lacks the `ev_` prefix; an action record missing `body_generation`.
- **Checks:** as P0-02.

### P0-04 — Thinker protocol frame schemas

- **Depends on** P0-01. Branch `phase0/p0-04-thinker`, worktree `p0-04`. Commit: `feat(contract): add the Thinker protocol frames`.
- **Spec:** Appendix H, section 6.3. Phase 0 uses these exact frames over a plain local WebSocket with no auth (spec section 10).
- **Create:** `contract/schemas/thinker-frame.schema.json`, `contract/test/thinker-frame.test.ts`. **Change:** `contract/src/index.ts` (export `ThinkerFrame`, each frame type, `validateThinkerFrame`, and `MAX_FRAME_BYTES = 1_048_576`, `MAX_COMPLETION_TEXT = 32_768`). Regenerate.
- **Shape:** `oneOf` of nine frames in `$defs`, each with `"type": { "const": ... }`. Thinker → colo: `hello` (`thinker_version` semver, `models` 1–16 of `{ name, max_concurrent 1–256, max_tokens 1–32768 }`), `heartbeat` (`load`: map of model name to integer ≥ 0), `completion` (`job_id`, `text` ≤ 32768, optional `usage_reported` `{ prompt_tokens, completion_tokens }`), `error` (`job_id`, `code` one of `model_unavailable`, `timeout`, `internal`; `message` ≤ 200), `goodbye` (`reason` `schedule`|`shutdown`). Colo → Thinker: `welcome` (`thinker`, `accepted_models`, `server_time` `date-time`), `job` (`job_id`, `model`, `messages` 1–64 of `{ role: system|user|assistant, content }`, `max_tokens`, `temperature` 0–2, `stop` array or null, `deadline` `date-time`, optional `cache_hint.stable_prefix_chars`), `cancel` (`job_id`), `drain` (`reconnect_after_seconds` 0–86400). No frame carries the Thinker's identity except `welcome`, which the colo sends: identity comes from the connection (Appendix H).
- **Test:** each Appendix H example passes (with valid IDs and dates); these fail: `completion` with 32769-char `text`; `error` with `code: "oops"`; a `hello` carrying an extra `thinker` field; `{ "type": "job" }`.
- **Checks:** as P0-02.

### P0-05 — `sql/` migrations from Appendix D

- **Branch** `phase0/p0-05-sql`, worktree `p0-05`. Commit: `feat(sql): add the Phase 0 schema with pgvector`.
- **Spec:** Appendix D; decision D-P0-11 in the ledger.
- **Create:** `sql/0001_init.sql`: Appendix D, every table, index and the `archive` schema, keeping the comments, **with three changes** that match the contract (decision 0020, P0-03): in `receipts`, drop `UNIQUE` from `action_id`, add `detail TEXT`, and add `UNIQUE (action_id, phase)`; in `actions`, add `snapshot_revision BIGINT`. Mark each change with a `-- differs from spec Appendix D: <why>` comment. Also create `sql/README.md` (naming `NNNN_slug.sql`, applied in order by Postgres init on a fresh volume in Phase 0, never edit a merged migration, add a new one), `sql/test/check-schema.sql` (fails via `RAISE EXCEPTION` unless every Appendix D table exists in `public` and `select extversion from pg_extension where extname = 'vector'` returns a row).
- **Change:** `.github/workflows/ci.yml`: add a job `sql` and add it to the `gate` job's `needs`. The job runs a service container `pgvector/pgvector:0.8.6-pg16@sha256:<digest>` (resolve the digest per dispatch rule 3) with `POSTGRES_PASSWORD: ci`, waits for `pg_isready`, applies every `sql/[0-9]*.sql` in name order with `psql -v ON_ERROR_STOP=1`, then runs `sql/test/check-schema.sql`.
- **Test:** the CI job is the test. Locally, run the same steps against a throwaway container (`docker run --rm -d -e POSTGRES_PASSWORD=ci -p 127.0.0.1:55432:5432 <image>`), and confirm `check-schema.sql` fails when one `CREATE TABLE` is removed. Stop the container.
- **Checks:** the local run above, `./geldar.ps1 check`.

### P0-06 — `compose/phase0.yml` and `shards/phase0.yaml`

- **BlockedDecision** on D-P0-07 (Minecraft version and Paper build) and D-P0-08 (whether the Body connects straight to Paper). At dispatch the orchestrator fills in: `MC_VERSION`, `PAPER_BUILD`, the Paper image tag, the Java version and the Ollama model tags. This section assumes D-P0-08's proposal (direct connection, offline mode, localhost only); if the owner chooses Velocity, re-spec this packet first.
- **Depends on** P0-05. Branch `phase0/p0-06-compose`, worktree `p0-06`. Commit: `feat(compose): add the Phase 0 stack with health checks`.
- **Spec:** 5.1 (`server.properties`, gamerules), 6.5, Appendix E, section 10 Phase 0; decision 0002.
- **Create:** `compose/phase0.yml`, `compose/.env.example`, `shards/phase0.yaml`, `compose/paper/server.properties` only if the image cannot set every 5.1 property through environment variables.
- **Services** (images pinned by digest; every port bound to `127.0.0.1`):
  - `postgres`: `pgvector/pgvector:0.8.6-pg16@sha256:...`, database and user `geldar`, password from `.env`, named volume, `sql/` mounted read-only at `/docker-entrypoint-initdb.d`, healthcheck `pg_isready -h 127.0.0.1 -U geldar -d geldar`. The `-h` matters: during first-boot init Postgres listens only on its socket, so a socket check reports healthy before `sql/` has been applied.
  - `nats`: `nats:2.15.1-alpine@sha256:...`, command `-js -sd /data -m 8222`, named volume, ports 4222 and 8222, healthcheck `wget -qO- http://localhost:8222/healthz?js-enabled-only=true`.
  - `paper`: the image and build filled in at dispatch, `EULA=TRUE`, `TYPE=PAPER`, the 5.1 `server.properties` values (online-mode false, white-list off for Phase 0 since there is no ingress yet: say so in a comment and in the PR), `ENABLE_RCON=true` with the password from `.env`, `SEED` set to the same value as `shards/phase0.yaml`'s `seed` (compose can't read that file; a comment in each says to keep them equal), the world border set at start through the image's `RCON_CMDS_STARTUP` to `worldborder set 3000` (diameter 3000 = radius 1,500, spec 5.1), named volume, port 25565 and RCON 25575 on `127.0.0.1`, healthcheck using the image's own `mc-health`, `start_period` long enough for first world generation.
- **`shards/phase0.yaml`:** Appendix E trimmed to Phase 0: `shard: phase0`, a seed, `tick_rate: 20`, `world_border_radius: 1500`, `population_target: 1`, `reflexes`, `chat`, `memory`, `attention`, `lifecycle: { permadeath: false }`, and `models: { strong: [<Ollama tag for Qwen3 32B>], fast: [<Ollama tag for Qwen3 8B>] }` with the exact tags in the dispatch brief. Leave out economy, shrine, governance, sovereign and historian blocks, with one comment line saying they arrive in later phases.
- **Change:** `.github/dependabot.yml`: add a security-only `docker` entry for `/compose` (same shape as the others).
- **`compose/.env.example`:** every variable the compose file reads, with a working local default (passwords like `change-me-local`). CI's `compose` job copies it to `.env` before validating, so a variable missing from it fails CI.
- **Test:** `docker compose -f compose/phase0.yml config --quiet` passes in CI (the existing `compose` job). Locally: `./geldar.ps1 shard up phase0` returns with every service healthy; every row of the health table in `.claude/skills/run-shard/SKILL.md` passes (update that table if a port or name differs); `./geldar.ps1 shard down phase0`. Paste the health results into the report.
- **Checks:** the local run above, `./geldar.ps1 check`.

## Wave 2 — Golem and the body benchmark (ships as the wave 2 PR)

Written in full when wave 1 closes, once D-P0-07 has fixed the Minecraft version and Mineflayer stack. Outline:

- **P0-07** `golem/` package (`@geldar/golem`): connect one bot to the phase0 shard (offline mode), reconnect with backoff, an RCON client for test control (tick rate, clearing the test area, giving nothing to a bot outside a benchmark), and a smoke test that joins, reports position and leaves. Records the pinned Mineflayer stack and prints `testedVersions` at start.
- **P0-08** body actions A: `goto`, `gather`/`mine`, `craft`, each returning `{ status: completed|failed|blocked, latency_ms, detail }`, with per-action timeouts.
- **P0-09** body actions B: `place`, `eat`, `sleep`, `open`, `deposit`, `withdraw`.
- **P0-10** the benchmark harness: the six scenarios in the `body-bench` skill, at 20, 10 and 5 TPS, JSON output to `bench-results/`, rows appended to [bench-results.md](bench-results.md), and `./geldar.ps1 bench` wired to it.
