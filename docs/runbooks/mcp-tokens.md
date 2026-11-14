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

## Set a player's public camera or delayed public thoughts flag (C7-14)

The operator sets these flags with one command. `<player-id>` is the player id (`ag-...`), not a roster name.
Give `--public-camera`, `--thoughts-delayed-public`, or both; a flag you leave out stays as it is.

Operator, from a host with the PG variables set (the role is `geldar`, as for the other `player` commands):

    node tools/mcp-tokens/src/cli.ts player flags <player-id> --public-camera on --thoughts-delayed-public on

Node, through the admin container:

    deploy/colo-admin.sh player-flags <player-id> --public-camera on --thoughts-delayed-public on

The thoughts flag has a 10-second window: a second thoughts change within 10 seconds of the last one is refused
(exit 3, nothing changed, so wait 10 seconds and run it again). The camera flag has no window. An unknown player
exits 4, a retired player exits 4, and every call writes one `register_audit` row (actor `operator`, action `player.flags`).