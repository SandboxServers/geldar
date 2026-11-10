# fix-c: knowledge boundary (decisions 0058, 0059)

Branch fix/c-knowledge-boundary, from wave6-main. Items in priority order.

1. Prompts: DONE, committed in a92b2c9. thought v4 added (v3 with the observer, makers and credit wording removed; BC-10 kept). Default thought = 4. `mind.thought_version` in config.ts, main.ts and shards/phase0.yaml selects v1 to v4. v4 hash pinned in library.test.ts. Scan test animus/src/prompts/agent-text.test.ts. Mutation check: adding "observers" to v4 fails the scan; restored. Slot `credits` kept for v2 and v3; v4 uses `thinking_left`. prompts/README.md updated (also lists reflection v2 and thought v3, v4).
2. Contract schema descriptions (mcp-world, common, look.ts, mcp-common): TODO, not started.
3. Look projection (drop shard, snapshot_id, body_generation; in-world time) and opaque per-life wait cursor: TODO, not started.
4. Wake reasons rendered to the model (raw mind_start, fallback, idle, unexpected_damage) mapped to plain wording: TODO. The library golden snapshot still shows "Why you were woken: idle" and must change with it.
5. Persona lint at `player add` and seed update, with `--allow-meta`, documented in threshold/mcp README: TODO, not started.
6. Decision record: docs/decisions/0068-prompt-v4-and-agent-visible-text.md (coordinator ruling: 0068, not the next free number; 0066 and 0067 are taken on other branches), plus its row in docs/decisions/README.md. Must list the spec line docs/spec.md ~1584 ("observers can read it") for the owner to amend. TODO, not started.

## Session: items 2 and 3 (contract text, look projection, wait cursor)

Item 2 DONE in 7b2ff53. Descriptions an agent reads reworded (colo sandbox, colo's mirror, agent life, Minecraft item ID, written by other agents; watchdog in snapshot stuck). The untrusted note now reads "written by others in the world" (schema const, look.ts, test and mock copies). contract/test/agent-visible-text.test.ts scans the MCP tool list and agent-facing schemas for the marker words; the allow-list is empty and documented. Mutation check: putting "colo" back in mcp-world DefineSkillInput fails the scan; restored, tree clean.

Item 3 NOT committed (stopped on context). Findings for the next session:
- The look projection needs a PlaySnapshot without snapshot_id, shard, body_generation and world_time.ticks. The schema cannot express it through allOf with additionalProperties false, and contract/scripts/generator.ts resolveRef only accepts `#/$defs/<Name>` refs, so a pointer into snapshot.schema.json#/properties/... fails generation. Either extend resolveRef or move self, surroundings and world_time into $defs in snapshot.schema.json (type names change; check types.ts consumers).
- play-view.ts toPlayView currently spreads the snapshot (line ~52); it must build an explicit object and return the new PlaySnapshot type.
- The wait cursor is the shard-wide JetStream sequence (threshold/mcp/src/events/player-log.ts RingEventLog.since and head; mcp-mock sim/events.ts). Plan: a per-life counter kept in the ring, mapping stream seq to the counter, so the cursor is opaque and per-life; replay and dedupe keep using seq internally.

## Session: items 1, 4, 5, 6 (wake wording, persona lint, decision 0068)

- Wake wording (item 4): DONE in 4547227. `animus/src/prompts/wake-wording.ts` maps every reason to
  plain words; the journal line says "(woken because ...)". Mutation check: raw reason in
  library.ts fails two library tests; restored, tree clean. The golden snapshot changed with it.
- Shared marker list: 1400327 moves `markedWords` and `MARKER_WORD` to `contract/src/agent-text.ts`
  (used by the prompt scan, the contract scan and the persona lint). Minecraft phrases (Observer
  block, Echo Shard, end credits, spectator mode, happy ghast harness) are removed before the scan.
- Persona lint (item 5): DONE in 213cb08. `tools/mcp-tokens/src/persona-lint.ts`, called from
  `checkSeed`. Refuses watched-by-humans phrases, AI/model/simulation words, and the meta words
  harness, shard, colo and credits. `--allow-meta` keeps the persona and prints a warning. Documented
  in threshold/mcp/README.md. Mutation check: removing the software mark fails the lint test;
  restored, tree clean. There is no `seed update` command, so the lint runs at `player add` only.
- Decision record (item 6): DONE in fd823d5, `docs/decisions/0068-prompt-v4-and-agent-visible-text.md`
  and its row in the index. Status Proposed; it names the spec line docs/spec.md ~1584 for the owner.
  docs/spec.md is not edited.
- Still open: the opaque per-life `wait` cursor (low severity; about 20 literal `c_N` sites).
- `./geldar.ps1 check`: all checks passed. Two soft-cap warnings exist in files this packet did not
  touch: threshold/mcp-mock/src/server.ts (565 lines) and tools/adam-run/src/adapters.ts (514 lines).