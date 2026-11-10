# fix-c: knowledge boundary (decisions 0058, 0059)

Branch fix/c-knowledge-boundary, from wave6-main. Items in priority order.

1. Prompts: DONE, committed in a92b2c9. thought v4 added (v3 with the observer, makers and credit wording removed; BC-10 kept). Default thought = 4. `mind.thought_version` in config.ts, main.ts and shards/phase0.yaml selects v1 to v4. v4 hash pinned in library.test.ts. Scan test animus/src/prompts/agent-text.test.ts. Mutation check: adding "observers" to v4 fails the scan; restored. Slot `credits` kept for v2 and v3; v4 uses `thinking_left`. prompts/README.md updated (also lists reflection v2 and thought v3, v4).
2. Contract schema descriptions (mcp-world, common, look.ts, mcp-common): TODO, not started.
3. Look projection (drop shard, snapshot_id, body_generation; in-world time) and opaque per-life wait cursor: TODO, not started.
4. Wake reasons rendered to the model (raw mind_start, fallback, idle, unexpected_damage) mapped to plain wording: TODO. The library golden snapshot still shows "Why you were woken: idle" and must change with it.
5. Persona lint at `player add` and seed update, with `--allow-meta`, documented in threshold/mcp README: TODO, not started.
6. Decision record: docs/decisions/0068-prompt-v4-and-agent-visible-text.md (coordinator ruling: 0068, not the next free number; 0066 and 0067 are taken on other branches), plus its row in docs/decisions/README.md. Must list the spec line docs/spec.md ~1584 ("observers can read it") for the owner to amend. TODO, not started.
