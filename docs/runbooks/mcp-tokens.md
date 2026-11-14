# mcp-tokens: adding a sovereign player

## Put the name on the roster first

Before `mcp-tokens player add` for a NEW sovereign player, the player name must be in the roster.

- Add one name: `mcp-tokens roster add <name> --owner <o>`. `--max N` sets max_agents (1 to 4). The default is 1.
- Or seed the names from a shard file, once: `mcp-tokens roster seed --owner <o> --from <file>` (the file's `sovereign.players` list).
- Names are stored lower-cased, so `Ranger` and `ranger` are the same name.
- `player add` refuses an unlisted name with `ROSTER_NOT_LISTED`. Fix the roster, then run it again.
- Existing rangers and their tokens are unaffected by roster changes.
- Nothing seeds the roster automatically on the node. Run `roster seed` only with the owner's go-ahead.

On the Colo node, run the same step through the operator wrapper (the name is the Minecraft name, 1 to 16 letters, digits
or `_`, the same name `player add --name` uses; the wrapper stores it lower-case):

```sh
deploy/colo-admin.sh roster-add <name> --owner <owner>   # then player-add
deploy/colo-admin.sh owner-set-cap <owner> <N>        # N 0 to 50 (decision 0052); owner-add is limited by the shard's owner_cap_owner (20)
deploy/colo-admin.sh roster-list [--owner <owner>]        # read-only
```

Why: [decision 0108](../decisions/0108-mcp-roster-source-of-truth.md).

## First admin (C7-14b)

A first admin who can use the register UI exists only after a human's first Microsoft sign-in. That sign-in creates the
owner through `register_create_owner`. Then the operator runs `owner-admin set <owner id>` on that owner's id, with
`deploy/colo-admin.sh owner-admin set <owner id>` (or `tools/admin/admin.sh owner-admin set <owner id>` in the admin
container). The owner id is the `reg-...` id of the owner that signed in: it is the `owner_id` column of the `mcp_owners` row
that the sign-in created. Read that column only; the row holds no token.

- `owner-admin list` shows the flagged owners. `set` and `unset` change nothing, and write no audit row, when the flag
  already has the requested value, so a re-run is a no-op.
- An owner created by `owner-add` has no identity and cannot sign in. It is not a first admin. A second `owner-add` for
  the same id reports `exists` and changes nothing.
- The kill switch stays `true` until the owner opens sign-up (C7-11). This step does not change it.
- `roster seed` runs only with the owner's go-ahead, passed as the operator input. This step does not run it.

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