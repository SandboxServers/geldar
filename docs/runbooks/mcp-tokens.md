---
title: "mcp-tokens: adding a sovereign player"
type: how-to
audience: agents-never
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, open-signup.md, account-deletion.md]
sources: [../decisions/0108-mcp-roster-source-of-truth.md, ../decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md, deploy/colo-admin.sh, sql/0002_sovereign_mcp.sql, tools/mcp-tokens/src/cli.ts]
---

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
deploy/colo-admin.sh owner-set-cap <owner> <N>        # N 0 to 50 (see the note below); owner-add is limited by the shard's owner_cap_owner (20)
deploy/colo-admin.sh roster-list [--owner <owner>]        # read-only
```

### Moving a player to another owner (assign-cmd)

- `deploy/colo-admin.sh player-set-owner <player-id> <owner-id>` (`DEPLOY_DRY_RUN=1` prints the plan and writes nothing). It runs `mcp-tokens player set-owner` in the admin container as `admin player-set-owner`.
- One transaction moves three links: `mcp_players.owner_id`, the `mcp_roster` row of the player's name, and `agents.owner` of its life. A missing roster row makes the supervisor refuse Body starts, and a missed `agents.owner` breaks Kino and Glass scope and deletion, so all three move or none does.
- It refuses an unknown player, an unknown owner, a retired player, a move that would take the target owner past its `player_cap` (active and paused players count), and a roster name that another live player of the old owner also uses (a roster row with `max_agents` above 1 can serve two players; moving one would strand the other, so nothing is split). A player already on the target owner is a no-op: it prints `nothing changed` and writes no audit row.
- Before the move, stop the player's Body and clear any pending skin upload. The move does not change `skin_uploads.owner_id` or `body_ops.owner_id`; they keep the old owner. A running Body started under the old owner is not handled by the move.
- A successful move writes one `register_audit` row (action `player.set_owner`, detail with the owner ids only). Its `actor` is the first 16 hex characters of the sha256 of the word `operator`, not the plain word `operator` the other operator rows use. Filter on `action = 'player.set_owner'`, not on the actor.
- The target owner's cap must be at least its player count after the move. `deploy/colo-admin.sh owner-set-cap <owner-id> 20` (range 0 to 50) is enough for 20 players; the cap default is 3.

The wrapper runs each one-shot with `run --rm --no-deps admin` (incident admin-no-deps): it starts only its own container and never starts, stops or recreates postgres. It refuses while postgres is not running. Until that fix is deployed to the node, run the render gate for postgres first (compare `config --hash postgres` with the running container's config-hash label), because the older wrapper can recreate postgres when the render differs.

Note on the 0 to 50 range (unresolved, flagged 2026-11-16 at `03c1f5de`): three sources say different things. The code
enforces 0 to 50 (`deploy/colo-admin.sh` lines 136 to 145, whose comment cites decision 0052; the `player_cap` CHECK in
`sql/0002_sovereign_mcp.sql`). Decision 0052 raises the owner's cap to 20 and states no range. Spec section 5.15.6 sets a
default cap of 3 per owner per shard, raisable per person by the operator, and states no upper bound. Use the range the
code enforces; a decision record would settle which bound is intended.

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

## Sheet adoption: plan, then apply (S12-04b)

The plan shows, for each life you list, whether its character sheet would be adopted. It changes nothing. Both verbs take
an explicit list of lives, and `--lives` is required on both. There is no form that reaches every life.

    deploy/colo-admin.sh adopt-sheets-plan --lives <list>

The list is a comma list of life ids with no spaces. Rules:

- 1 to 120 ids.
- Each id matches `^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$`.
- No id appears twice.
- Every id must be in the shard file (`GELDAR_SHARD_FILE`): a life in the `mind.lives` tier table, or a ranger in
  `sovereign.players`.

Any bad id, a duplicate, or a count outside 1 to 120 refuses the whole run before docker or the CLI runs. The message
names only the offending id, or the count or duplicate problem.

The plan prints one line per listed life, `<life-id>: <verdict>`, then one line `plan: <12 hex>`. The 12 hex digits are
the plan hash. The hash covers exactly the listed lives: it is over the verdict lines of those lives, so it changes when
any verdict changes and when the list changes. No sheet value is printed.

    deploy/colo-admin.sh adopt-sheets-apply --operator-confirm --plan <12 hex> --lives <list>

Give the arguments in that order: the hash the plan printed, then the same list. The apply runs the plan again with that
list inside the admin container. If the hash differs from the one you give, it prints
`plan changed (expected <your hash>, now <new hash>)` and writes nothing: read the plan again and decide on the new one.
A plan that fails, or a bad argument, also writes nothing. Run the plan first; do not give a hash you have not read.
`DEPLOY_DRY_RUN=1` prints the command and starts no container.

The first list for the adoption (23 lives) is:

    deploy/colo-admin.sh adopt-sheets-plan --lives ag_jason_01,ag_kimberly_01,ag_tommy_01,ag_zack_01,ag_billy_01,ag_trini_01,ag_picard_01,ag_riker_01,ag_data_01,ag_troi_01,ag_laforge_01,ag_worf_01,ag_bcrusher_01,ag_wcrusher_01,ag_lewis_01,ag_clark_01,ag_chapman_01,ag_macdonald_01,ag_leonardo_01,ag_zeopink_01,ag_zeoyellow_01,ag_zeoblue_01,ag_zeogreen_01

Every other life stays NULL. Lives outside a list are not adopted by any run. The owner widens the adoption only by a new
list, planned and applied the same way.

Until the apply is built into the CLI, the apply step ends with `adopt-sheets: --apply is S12-04b` and exit 2, and
nothing is written. The plan works now.