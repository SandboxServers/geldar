# 0185. A per-turn record for kit Minds: the full Appendix D record, operator-only

- Status: Proposed (owner confirmed the scope to geldar-93 on 2026-11-14; nothing is built or switched on)
- Date: 2026-11-14
- Spec: Appendix D (the `thoughts` record); section 2 (principle 1); the sentence at spec line 867 ("the mirror records decisions and volunteered thoughts, not the model's hidden reasoning")
- Related: 0171 (account erasure), 0138 (thought visibility), 0085 (append-only audit), 0073 (the spec is never edited); harness cards GX-05 and HC-41 in `docs/analysis/harness/work-packets-turn-record.md`

## Context

The Postgres `thoughts` table was empty all day on 2026-11-14. Its only writer was the in-house Mind (`animus/src/memory/journal.ts`), which is frozen. A kit Mind (Claude CLI, ChatGPT, local) leaves in the world database only `mcp_journal` lines and one `sovereign_call` event per MCP call; that event has no model input, raw output, template version or tokens. Appendix D wants one record per model call, including `model_input`, `raw_output`, `prompt_template_version` and the token figures. Operators have nothing to read for a kit player's thinking, its prompt budget or its run health.

## Decision

1. Every model call of a kit Mind gets a **turn record** with the Appendix D fields that exist for a kit: `life_id`, `at`, `world_day`, `world_tick`, `wake_reason`, `harness`, `model`, a template version (a hash of the persona, skills and instructions the call used), `model_input`, `raw_output` (including the model's reasoning as the harness exposes it), token usage with provenance, latency, context size against the window, and the credits figures where they exist.
2. **This extends the sentence at spec line 867.** The spec says the mirror does not hold hidden reasoning; the owner now wants it stored. The spec is not edited (0073). This record is the amendment for the owner to list in the 0073 reconciliation.
3. **Operator-only.** The record goes in a **new table** (`turn_records`), not in `thoughts`. Reason: `geldar_glass` has a table-wide `SELECT` on `thoughts` (`sql/0005_glass_reader.sql:23`), so any prompt or reasoning stored there would reach Glass. The new table has no grant to `geldar_glass`, `geldar_mcp` or any player-facing role; only the sink writes it and operators read it through the operator role. No Glass column, no public view, no MCP tool reads it, and nothing in an agent's context, event stream or prompt carries it or says it exists (decisions 0059 and 0068).
4. **Retention and erasure are a gate.** Nothing stores a prompt or reasoning for a live player until the owner settles the questions below. The cards ship the schema and writers inactive and off by default.
5. The `thoughts` table keeps its role for the frozen animus path. It is not changed, and `thoughts` stays append-only (`sql/0007_journals_append_only.sql`). Erasure under 0171 for the new table needs its own, deliberate delete path (a definer function), because an append-only trigger would block it.

## Open questions (owner, before any switch-on)

- Retention period for prompts and reasoning, and whether the numeric fields outlive them.
- Erasure when an account is erased (0171): are turn records deleted, anonymised, or kept as world history?
- Who can read it: the owner of the player, operators only, or both.
- Backups and the dump copies: do they carry turn records, and for how long?
- Size and cost: a full prompt per turn is large; truncation, compression and a daily cap.
- Whether a child's turn records are linked to the parents' lineage (W10).

## Consequences

- Two cards: GX-05 (world: schema, contract event, SQL, sink, grants, erasure function) and HC-41 (kit: the supervisor and loop emit the record). Both inactive.
- The write path from the kit to the world database is new and must not use a path an agent can see.
