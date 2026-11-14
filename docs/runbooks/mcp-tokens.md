# mcp-tokens: adding a sovereign player

## Put the name on the roster first

Before `mcp-tokens player add` for a NEW sovereign player, the player name must be in the roster.

- Add one name: `mcp-tokens roster add <name> --owner <o>`. `--max N` sets max_agents (1 to 4). The default is 1.
- Or seed the names from a shard file, once: `mcp-tokens roster seed --owner <o> --from <file>` (the file's `sovereign.players` list).
- Names are stored lower-cased, so `Ranger` and `ranger` are the same name.
- `player add` refuses an unlisted name with `ROSTER_NOT_LISTED`. Fix the roster, then run it again.
- Existing rangers and their tokens are unaffected by roster changes.
- Nothing seeds the roster automatically on the node. Run `roster seed` only with the owner's go-ahead.

Why: [decision 0108](../decisions/0108-mcp-roster-source-of-truth.md).
