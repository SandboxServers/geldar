# 0108. The roster of sovereign player names lives in the database, and each name allows one agent by default

- Status: Proposed (for owner review; the code follows the proposal and is reversible by a later migration)
- Date: 2026-11-13
- Spec: 5.15.5 (sovereign players); related 0006 (owner player cap), 0052 (owner cap), C3-04, C3-04s, C7-03a
- Related: `sql/0024_mcp_roster.sql`; `tools/mcp-tokens/src/roster.ts`; worknote `docs/analysis/phase1/worknotes/C3-04s.md`

## Context

A sovereign player start used to check the name against `sovereign.players` in the shard file. Self-registered owners (C7) need the roster to change at run time, through the operator CLI and the database, without editing a shard file and restarting. Migration 0024 creates `mcp_roster`, since no earlier migration on `main` has it.

## Decision

1. **The database is the source of truth for the roster.** `mcp_roster` holds one row per Minecraft name (the primary key is `player_name`), with its `owner_id` and `max_agents`. The name is the key, so one name has one owner at a time.
2. **The shard file seeds the roster once, by an explicit command.** `mcp-tokens roster seed --owner <o> --from <shard file>` adds the names in `sovereign.players`. It never runs on boot. A second run adds nothing, and a name already listed for anyone is skipped.
3. **`max_agents` defaults to 1 and runs from 1 to 4.** The default is the proposal. Raising it is an operator command (`roster add --max N`). The database check and the CLI both refuse 0 and 5 and anything that is not a whole number.
4. **A sovereign start is refused** with a stable error code when the name is not on the roster for that owner (`ROSTER_NOT_LISTED`), or when the agents of that name that are not retired already reach `max_agents` (`ROSTER_LIMIT`). The check runs inside the start's transaction and locks the roster row, so two starts for one name cannot both pass.
5. **The owner cap is unchanged.** `mcp_owners.player_cap` and trigger 0006 still bound the number of agents one owner holds (decision 0052). The roster check adds a per-name limit on top of it.

## Consequences

- An owner cannot add a name another owner holds; the unique key refuses it (`ROSTER_TAKEN`).
- Removing a roster name does not retire the agents that run as it. The start check only stops new starts.
- Enforcement scope (review fix, orchestrator ruling option a): the roster is enforced at `player add` (the operator CLI, `ROSTER_NOT_LISTED` and `ROSTER_LIMIT`) and by the supervisor's start path for the owner of the name (C7-03a). The body start path in golem still reads `sovereign.players` from the shard file at start time and the roster does not gate it. `max_agents` is enforced by `player add` only. The shard list is a seed input and is also read by golem at start.

## Open for the owner

- Whether `max_agents` above 1 should exist at all (the proposal allows up to 4, as the table's CHECK does).
