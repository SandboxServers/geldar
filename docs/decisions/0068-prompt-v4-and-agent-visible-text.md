# 0068. Prompt v4 and the agent-visible text: no observer, harness or credit meta

- Status: Proposed (fix-c; the owner amends the spec line below)
- Date: 2026-11-10
- Spec: 5.15.5 (sovereign players and personas), docs/spec.md ~1584 (the reasoning line: "observers can read it"), 5.3 (wake reasons)
- Packet: fix-c (knowledge boundary), follows decisions 0058 and 0059
- Worknote: docs/analysis/phase0/worknotes/fix-c.md

## Context

Decision 0058 says a character knows only what its in-world knowledge gives it. Decision 0059 says
`identity_mode` governs whether humans may observe a shard, and that agents are never told they are
watched. The shipped prompts and schema text broke both rules: the thought prompt v3 said that
observers can read the reasoning, the schema descriptions named the colo, the shard and the credits,
the wake reasons reached the model as raw codes, and a persona could say any of this to the character.

## Rules

1. Nothing an agent can read may tell it that humans or observers watch it, or reveal the shard,
   harness, colo or credits. "Agent can read" covers the prompt templates, the schema descriptions
   of the MCP tools and their results, the wake wording and the journal lines.
2. Released prompt templates are immutable. A change is a new version (`thought/v4.md`); the old
   file stays, so a pinned hash in the library test still means the same text.
3. Thought v4 is the default. `mind.thought_version` selects v1 to v4; `shards/phase0.yaml` and
   `main.ts` read it.
4. One allow-list. A word that contains a marker may stay only with a reason an in-world reader
   would accept. The list is empty today (`contract/src/agent-text.ts`).
5. Minecraft-the-game phrases are not marks: the Observer block, the Echo Shard, the end credits,
   spectator mode and the happy ghast harness are removed before the scan.
6. The persona lint refuses, at `player add`, a persona that tells the character that humans or
   observers watch it, that it is an AI, a model or a simulation, or that names the harness, shard,
   colo or credits. `--allow-meta` keeps such a persona, with a printed warning (threshold/mcp README).

## What changed

- Thought prompt v4 (`prompts/thought/v4.md`): v3 with the observer, maker and credit wording
  removed; the credit slot is `thinking_left` in v4. v1 to v3 are unchanged.
- Schema descriptions an agent reads: colo sandbox, colo mirror, agent life, Minecraft item ID,
  "written by others in the world" (contract/test/agent-visible-text.test.ts scans them).
- The play snapshot an agent reads is an explicit projection: no shard, snapshot id, body
  generation or raw ticks (`play-view.ts`).
- Wake reasons reach the model as plain wording (`animus/src/prompts/wake-wording.ts`). The reason
  codes stay in the contract and the thoughts table.
- The shared marker list is `contract/src/agent-text.ts`; the prompt scan, the contract scan and
  the persona lint use it.
- The persona lint: `tools/mcp-tokens/src/persona-lint.ts`, called from `checkSeed`.

## Deferred

- The opaque per-life `wait` cursor. The cursor is the shard-wide JetStream sequence today
  (threshold/mcp/src/events/player-log.ts). Replacing it touches about 20 literal `c_N` sites, so it
  waits for its own packet. Low severity: the value is a shard number, not a rule breach.

## Spec line for the owner to amend

docs/spec.md ~1584 says the reasoning is not heard by anyone in the world, "(observers can read it)".
Under rule 1 that sentence must not reach the agent. The owner should replace it with a line that
says the reasoning is private to the character (for example: "reasoning is private to you and is
not heard by anyone in the world"), then re-check the schema text. This decision does not edit
docs/spec.md.
