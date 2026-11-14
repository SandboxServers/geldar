# Harness cards: the per-turn record (GX-05, HC-41)

Status: **Proposed, inactive, nothing dispatched.** Decision [0185](../../decisions/0185-per-turn-record-for-kit-minds.md). Written 2026-11-14 by the geldar coordinator from the owner's scope (confirmed to geldar-93): the full Appendix D record, prompt text and hidden reasoning included, **operator-only**. Neither card is `Ready` until the retention and erasure gate below is settled by the owner; they may be built behind a flag that defaults off once their `(to confirm)` items are resolved.

## Precondition (gate for both cards, owner)

Nothing stores a prompt or reasoning for a live player until the owner settles: the retention period; erasure when an account is erased (0171); who can read it; backups and the dump copies; the size and cost cap; and whether children's records link to lineage. Until then the writers ship with `turn_record: false` and the sink drops the event before it reaches a table.

## Findings the cards rest on (read 2026-11-14)

- `geldar_glass` has a table-wide `SELECT` on `thoughts` (`sql/0005_glass_reader.sql:23`). The full record therefore must **not** go in `thoughts`. `geldar_mcp` has no grant on `thoughts`.
- `thoughts` is append-only (`sql/0007_journals_append_only.sql`). The new table needs its own erasure path.
- `sovereign_call` events are stored in `events`; the sink stores every non-projected type there. The turn record must not ride `sovereign_call` or any event type that `events` replays to players or Glass. `events` is not read by `geldar_glass`, but this is `(to confirm)` per column grant.
- The MCP stream skips `sovereign_call` (`threshold/mcp/src/events/stream.ts:89`); the new type must be added to the guard list that keeps it out of the agent-visible stream (the same test AN-07 adds for `MIND_EVENT_TYPES`).

## GX-05: the `turn_record` event, table, sink writer and erasure path (world)

- **Repo** geldar. **Branch** `phase1/gx-05-turn-record`. **Depends on** GX-01a (harness and model names), the gate above, decision 0185. **Size** over 50k: split before dispatch into GX-05a (contract and SQL), GX-05b (sink writer, grants test), GX-05c (erasure function and the exposure tests). **Status** Proposed.
- **Do.**
  - Contract: schema `turn-record-event` (`TurnRecordPayload`) and WorldEvent type `turn_record` (3-token subject; sink-only). Fields: `turn_id`, `life_id`, `harness`, `model`, `template_version` (64 hex), `wake_reason`, `world_day`, `world_tick` `(to confirm: where the kit reads the tick)`, `model_input` (text or JSON, bounded), `raw_output` (text, bounded, includes reasoning as the harness exposes it), `tokens_in`, `tokens_out`, `usage_source` (`provider` or `estimated`), `latency_ms`, `context_tokens`, `context_window`, optional credits. Hard size cap per field and per event; over-cap truncates with a marker, never drops the numeric fields.
  - SQL (migration number `<allocate via registry>`, SQL 0037 or higher after #336): table `turn_records`; **no grant to `geldar_glass`, `geldar_mcp`, `geldar_register` or any player-facing role**; sink writes it; an operator role reads it; a definer function `erase_turn_records(life_id)` for 0171 (the delete path; the table is not append-only, or has its own exempt trigger). Schema test asserts `has_table_privilege` is false for every role except the sink and the operator role.
  - eventsink: writer for the type, off unless `GELDAR_TURN_RECORD=1`; the guard test adds `turn_record` to the types kept out of the MCP stream and Glass queries.
- **Prove.** Exposure tests (each fails if the guard is reverted): no role but the sink and the operator can select; `geldar_glass` and `geldar_mcp` get permission denied; the MCP stream never emits `turn_record`; a Glass query over `thoughts` is unchanged; flag off means no row; erasure removes a life's rows.
- **Must not.** Edit `thoughts`, its grants or its trigger; add a Glass column or view; put the text in `sovereign_call`; touch `docs/spec.md`.

## HC-41: the kit emits the turn record (kit)

- **Repo** geldar-scriptorium. **Depends on** HC-03 (meter), HC-04 (stamps), HC-05 (mind-loop), GX-05, the gate. **Size** over 40k: split into HC-41a (Claude and ChatGPT streams to a local `turns.jsonl`) and HC-41b (the send to the world). **Status** Proposed.
- **Do.** The supervisor and the owned loop write one row per model call to `turns.jsonl` in the supervisor volume: harness, model, template hash, usage and its source, latency, context size, and the input and output as the harness exposes them (Claude: the session stream; ChatGPT: the Responses stream; local: the chat transport). HC-41b sends the row to the world as a `turn_record` over a path the model cannot see or call (the supervisor's own link, not an MCP tool and not a header on `act`), flagged off by default.
- **Prove.** The child-environment test (HC-26) still shows no turn data or switch in the model's environment; the model's tool list gains nothing; the flag off sends nothing; a leak scan of prompts and skills finds no mention of the record.
- **Open.** How a Claude CLI session exposes reasoning (hidden thinking may not be in the stream) `(to confirm)`; the template-hash input set; how the kit learns the world tick.

## Open items

Everything under the gate above; the migration and event names `(allocate via registry)`; whether the operator role is a new role or an existing one `(to confirm)`; the size caps; how Adam's own record is handled (frozen animus `thoughts` stays as is).

## GX-06: a server-set `source` tag on the sovereign call (world)

- **Repo** geldar. **Branch** `phase1/gx-06-act-source`. **Depends on** GX-01a (contract owner order: after AN-02b, strictly serial, because it regenerates `contract/src/generated`). **Size** about 35k. **Status** Proposed (asked for by the kit orchestrator for HC-18 to HC-24; inactive until the kit sends a non-default source).
- **Why.** The instinct step (HC-19) settles routine acts in code on its own connection. Operators need to tell a model act from an instinct act from an operator act in the world record. Nothing carries that today: `sovereign-call-event.schema.json` and `intent-event.schema.json` are `additionalProperties: false` with no actor field (read at origin/main, 2026-11-14).
- **Do.**
  - `contract/schemas/sovereign-call-event.schema.json`: optional `source`, enum `model | instinct | operator`; absent means `model`. Regenerate. No change to `ActInput`, `thought.schema.json` or any Body-bound shape.
  - `threshold/mcp/src/tools/act.ts` (about line 415, `callPayload`): set `source` server-side from the **authenticated connection**, never from tool input: the model cannot send it and `ActInput` stays closed. How a connection earns `instinct` is `(to confirm)` and is the open design point below.
  - eventsink needs no change (stored in `events` as is).
- **Server-side only.** The value is never put in a tool result, an event or a snapshot an agent can read, and appears in no prompt (decisions 0059, 0068). A test scans every MCP tool result for the field name and the values.
- **Design (agreed in outline with geldar-registration, 2026-11-14).** A **keyed header** checked by the MCP front, not a new token class. A second token class would need a registration migration and new mint and verify functions; avoid it unless the header cannot work.
  - The check lives in `threshold/mcp` where the player token is verified. The key is a server-side secret the front loads at start (the same pattern as the token pepper file), compared in constant time. The header is `X-Geldar-Instinct-Key` (a name proposed by the geldar coordinator, to confirm with geldar-registration and geldar-93; it carries only the secret, never a claimed class). A matching key means `instinct`; an absent or wrong header means the model class. Nothing goes in `threshold/register`, owner keys (`gowner-`) or the owner API; `gmcp-` tokens and SQL 0032 stay as they are. Owners and the web have no path to mint or read the key.
  - The value goes only into `callPayload` (`act.ts` about line 415). It never appears in a tool result, an error text, a log an agent can read or a prompt (0059, 0068). The scan test covers tool results **and error text**.
  - Delivering the secret is an operator step (compose secret file and the node, geldar-93), not repo code. Nothing in the repo: no account names or addresses.
- **Kit-side proof (scriptorium, 2026-11-14).** The instinct step is a supervisor child (uid 1001) outside the model's process; the model runs as uid 1000. The key is a 0400 file owned by 1001 in the supervisor volume, handed to the child on a private descriptor, never in an environment variable, argument, log, stream or workspace file. HC-26c-style proof test required before any card trusts the class: the model uid cannot open the key file or read the supervisor or instinct `/proc/<pid>/environ` or `fd`; the model child environment holds no key; a scan of workspace, logs and stream finds no key text. If any part fails, `source` stays advisory.
- **Security gate (settle before dispatch).** A header proves the class only if the model cannot read the key. The instinct step runs for the supervisor, so the key must live in the supervisor or a separate non-model process with its own secret mount, **never in the kit shell, environment or files the model can reach**. If instinct code and the model share one process or container with file access, a header cannot prove the class and `source` is **advisory only**: the card and the operator export must then say so and no analysis may treat it as trustworthy. The kit orchestrator must confirm which holds (HC-26's child-environment test is the model for the proof). `operator` stays reserved and unused (Principle 1).
- **Prove.** Contract test: an event with each value validates, an unknown value fails; MCP test: a model-class connection records no `source` or `model`; an instinct-class connection records `instinct`; no tool result contains the field; revert the `act.ts` line and the instinct case fails.
- **Must not.** Edit `ActInput`, Body-bound schemas, tokens or auth beyond the one connection-class read, or `docs/spec.md`.

## GX-07: a BlueMap skin provider for our agents (plugin; owner chose option B, 2026-11-14)

- **Repo** geldar (`plugin/`, the `geldar-core` jar). **Branch** `phase1/gx-07-bluemap-skin-provider`. **Depends on** none in the harness chain. **Owner of the area** `(to confirm with geldar-93 and geldar-ops before dispatch)`. **Size** about 40k, over the plugin Gradle build. **Status** Proposed.
- **Why.** BlueMap 5.29's `PlayerSkinUpdater.updateSkin` deletes `playerheads/<uuid>.png` when the skin provider returns an empty result (one UUID per join, at most once an hour), and offline-mode agents have no Mojang profile, so every join of an agent can remove its head. Read from the v5.29 source by a read-only investigation; whether Mojang returns empty or throws for an unknown UUID is unverified.
- **Do.** Implement BlueMap's `SkinProvider` interface in `geldar-core` and register it with the BlueMap API. For an agent UUID (offline UUID of the login name) it returns the agent's skin from a read-only directory of PNGs; **it must never return empty**: for an unknown UUID it returns a default skin image so the delete path cannot fire, and it logs the miss without the name. Set `skin-download: false` only if the provider alone does not stop Mojang lookups `(to confirm)`. Skins come from the same source the `skin heads` verb uses (the skins directory), mounted read-only into Paper; nothing is baked into the jar.
- **Prove.** Unit tests: known UUID returns its PNG; unknown UUID returns the default image, never empty; no exception escapes. A live check after deploy: an agent joins and `/assets/playerheads/<uuid>.png` returns 200 with its skin, and stays after a second join an hour later.
- **Deploy.** Build the jar, mount the skins directory, **Paper restart (owner approval)**. A deploy window from geldar-93. Registration and geldar-ops files are not touched.
- **Open.** Who owns `plugin/`; whether BlueMap needs the provider registered at enable or reload; seven new agents have no skin PNG yet, so they get the default until one is added.
