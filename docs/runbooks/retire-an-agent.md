---
title: Retire an agent
type: how-to
audience: operators
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, account-deletion.md, mcp-tokens.md, bring-up-phase0-shard.md, rotate-secrets-by-role.md, ../concepts/life-cycle-of-a-life.md, ../reference/register-service.md, ../reference/admin-service.md, ../reference/cli-tools.md, ../reference/database-schema.md, ../reference/supervisor-and-body-helper.md]
sources: [tools/mcp-tokens/src/cli.ts, tools/mcp-tokens/src/players.ts, golem/src/players/life-removal.ts, golem/src/config.ts, tools/players-cli/src/rangers-cli.ts, threshold/register/src/account.ts, threshold/register/src/api/body-retire.ts, sql/0010_register_definer_functions.sql, deploy/colo-admin.sh, deploy/colo-cd-players.sh, tools/admin/admin.sh, compose/colo.yml, compose/rcon-host.yml, shards/phase0.yaml, shards/colo-mind.yaml, geldar.ps1, docs/runbooks/account-deletion.md, ../decisions/0152-programmatic-body-management-for-owners.md, ../decisions/0135-self-registration-with-github-and-discord.md, ../decisions/0173-owner-keys-by-session-and-bearer-scope.md, ../decisions/0262-account-deletion-erases-dead-lives-too.md]
---

# Retire an agent

Retire one sovereign player: stop its Body, revoke its tokens, mark the player `retired`, and take its life out of the ingress registry and the Paper whitelist. The records stay.

**Owner:** retiring is the player owner's action ([decision 0152](../decisions/0152-programmatic-body-management-for-owners.md) item 1). The operator runs these steps when the owner of the player asks. Record the request by player id and date only, as [account deletion](account-deletion.md) does for erasure. An abuse report is not a retire request: the operator's tool for it is an identity ban ([decision 0136](../decisions/0136-register-ban-procedure.md); [incident response](incident-response.md#6-recover)).

**Tested?** No. Nothing here was run for this page (documentation freeze, plan decision D8). Every command and flag exists in the repo at `03c1f5de`.

## Retire, die or erase

| | Retire | Death | Account deletion |
|---|---|---|---|
| Who | The owner (or the operator for them) | The world | The owner |
| Player row | `mcp_players.status = 'retired'`, row kept | Unchanged (inferred, see note) | Removed |
| Tokens | Revoked | Unchanged (inferred) | Revoked, then deleted |
| Journal, thoughts, records | Kept | Kept (inferred) | Erased for every life of the owner |
| Can it be undone? | No: `resume` starts only from `paused`, and no action leaves `retired` (`FROM_STATUS`, `tools/mcp-tokens/src/players.ts` lines 70 to 74) | No revive ([life cycle](../concepts/life-cycle-of-a-life.md)) | No |
| Steps | This page | None | [account deletion](account-deletion.md) |

Note on the Death column: inferred, not traced through every writer. Permadeath is off on every shard, so a death respawns the same life ([life cycle, Death](../concepts/life-cycle-of-a-life.md#death)); the death migration writes only the per-life death count (`sql/0023_death_count.sql` names no `mcp_players`, `mcp_tokens`, journal or thought table, grep 2026-11-16).

A retired player still counts toward the owner's lifetime limit of 10 player creations, and no longer counts against the owner cap ([life cycle](../concepts/life-cycle-of-a-life.md#retirement); [register service](../reference/register-service.md)).

## What each retire path does

There are three ways to retire a player. They do not do the same things.

| Path | Stops the Body | Revokes tokens | Sets `retired` | Removes registry key and whitelist entry | Evidence |
|---|---|---|---|---|---|
| `mcp-tokens player retire <id>` (operator) | No | Yes | Yes | Yes, or prints the manual command | `tools/mcp-tokens/src/cli.ts` lines 349 to 365; `setPlayerStatus`, `players.ts` lines 313 to 338; `golem/src/players/life-removal.ts` |
| Account page, `POST /players/<player_id>/retire` (owner) | No | Yes | Yes | No | `Account.retire`, `threshold/register/src/account.ts` lines 486 to 489, calls `register_retire_player` (`sql/0010_register_definer_functions.sql` lines 98 to 126) |
| Owner API, `POST /agents/{playerId}/retire` (owner, cookie session only) | Yes, through the supervisor | Yes | Yes | Not in the route | `threshold/register/src/api/body-retire.ts` lines 90 to 141; [decision 0173](../decisions/0173-owner-keys-by-session-and-bearer-scope.md) |

The API route mounts only when `REGISTER_NATS_URL`, `REGISTER_NATS_USER` and `REGISTER_NATS_PASSWORD_FILE` are all set ([register service](../reference/register-service.md#configuration-names)). `compose/colo.yml` at `03c1f5de` sets none of them (`git grep REGISTER_NATS -- compose/colo.yml`, 2026-11-16, no hits), so on the Colo node only the account page path exists for owners. After an account-page retire, the Body keeps running until an operator stops it: see [After an owner retires a player](#after-an-owner-retires-a-player).

## Retire a player on the local Phase 0 stack

1. **Start the shard with RCON on the host.** The removal step whitelists and un-whitelists over RCON, which is published to the host only with `--rcon-host` (`compose/rcon-host.yml` lines 1 to 5).

   ```powershell
   ./geldar.ps1 shard up phase0 --rcon-host
   ```

2. **Find the player.** Note its player id (`ag-...`) and its owner.

   ```powershell
   ./geldar.ps1 players status
   ./geldar.ps1 mcp-tokens token list --player <player-id>
   ```

3. **Stop its Body.** `players down` stops the process and, once the Body is stopped, removes the life's registry key and whitelist entry (`tools/players-cli/src/rangers-cli.ts` lines 261 to 270).

   ```powershell
   ./geldar.ps1 players down --player <player-id>
   ```

4. **Retire it.** This sets `retired`, revokes every token in one transaction, then runs the removal again.

   ```powershell
   ./geldar.ps1 mcp-tokens player retire <player-id>
   ```

   Expected output: `player <player-id>: retire`, then one line per removal step: `registry key <life>: deleted` and `whitelist <life>: removed`. A step that fails prints the manual command to run instead and never fails the retire (`removeLifeFromShard`, `golem/src/players/life-removal.ts` lines 46 to 80). The manual commands it prints are `nats kv del geldar-life-registry <life>` and `docker compose -f compose/phase0.yml exec paper rcon-cli whitelist remove <life>` (lines 28 to 36). `GELDAR_NATS_URL` defaults to `nats://127.0.0.1:4222` for this step (`loadStackConfig`, `golem/src/config.ts` lines 58 to 62).

   If it fails with `cannot retire <id> from its current status`, the player is already retired.

5. **Keep it from starting again.** `./geldar.ps1 players up` with no `--player` starts one Body for every ranger listed under `sovereign.players` in the shard file (`rangers-cli.ts` usage, line 48; the file is `shards/<GELDAR_SHARD or phase0>.yaml`, line 301). A retire does not change the shard file: `setPlayerStatus` touches only `mcp_players` and `mcp_tokens`. Remove the player's entry from `sovereign.players` in `shards/phase0.yaml` in a reviewed change. Whether a Body started for a retired player would get as far as the world is not established here.

6. **Optionally free the name.** The roster keeps the Minecraft name. Removing it is a separate step the owner asks for:

   ```powershell
   ./geldar.ps1 mcp-tokens roster remove <name> --owner <owner-id>
   ```

7. **Record** the retire in the operator log by player id and date only.

### Verify

- `./geldar.ps1 mcp-tokens token list --player <player-id>` shows no active token.
- The player's status reads `retired`:

  ```powershell
  docker compose -f compose/phase0.yml -p geldar-phase0 exec postgres psql -U geldar -d geldar -tAc "select status from mcp_players where player_id = '<player-id>'"
  ```

- `./geldar.ps1 players status` shows the player down.
- Step 4 printed `deleted` and `removed`, or you ran both manual commands.

### Rollback

None. A retired player cannot be resumed by any tool, and revoked tokens stay revoked. If the retire was a mistake, the owner creates a new player, which counts toward the lifetime limit of 10. Before step 4, you can still undo step 3 with `./geldar.ps1 players up --player <player-id>`. Inferred from the code, not run: the player host whitelists the life over RCON before each connect and registers it through `registryFromConfig` (`golem/src/players/main.ts` header comment line 4 and line 144), so a restart should restore the registry key and the whitelist entry that step 3 removed.

## Retire a player on the Colo node

The Colo node has **no operator retire verb**. `tools/admin/admin.sh` has no `player retire` subcommand ([admin service](../reference/admin-service.md), the `mcp-tokens` verbs without an `admin.sh` subcommand), and `deploy/colo-admin.sh` offers `player-stop` and `token-revoke` but not retire. Each step needs the owner's go.

1. **Stop the player's host.** `player-stop` stops and removes the container `geldar-colo-players-host-<player-id>`, and works only while the shard file lists the player (`host_args`, `deploy/colo-admin.sh` lines 176 to 185; `player-stop`, lines 236 to 248):

   ```sh
   deploy/colo-admin.sh player-stop <player-id>
   ```

   If the player is no longer in the shard file, stop it as [account deletion](account-deletion.md) "After a self-serve deletion" step 2 says. A stopped and removed host is not restarted by the CD: `colo-cd-players.sh` acts only on hosts `player-list` reports as running or as exited non-zero (lines 3 to 6).

2. **Revoke its tokens** by id, from `deploy/colo-admin.sh players-status`:

   ```sh
   deploy/colo-admin.sh token-revoke <tk_id>
   ```

3. **Set `retired`.** No repo verb does this on the node. Ask the owner to retire the player on the account page. The account-page path does not stop the Body, which is why step 1 comes first.

4. **Registry key and whitelist.** The manual commands `life-removal.ts` prints are written for the Phase 0 stack (`compose/phase0.yml`). No Colo equivalent is in the repo; [account deletion](account-deletion.md) step 5 lists the registry entries as manual work too. Leave them, note them as open, and raise the gap with the owner.

5. **Shard file.** Remove the player from `sovereign.players` in the node's shard file (`GELDAR_COLO_SHARD`, default `shards/colo-mind.yaml`, `deploy/colo-admin.sh` line 176) through the normal change path, so `player-start` refuses it.

### Verify

- `deploy/colo-admin.sh player-list` no longer lists the host as running.
- `deploy/colo-admin.sh players-status` shows no active token for the player.

### Rollback

`deploy/colo-admin.sh player-start <player-id>` restarts the host while the player is still in the shard file and not yet retired. After step 3 there is no rollback.

## After an owner retires a player

An owner who retires a player on the account page stops nothing: the page path only changes the database (`account.ts` lines 486 to 489). Check after each owner retire you learn of:

1. List running hosts: `./geldar.ps1 players status` locally, `deploy/colo-admin.sh player-list` on the node.
2. For each host whose player is now `retired`, stop it: `./geldar.ps1 players down --player <player-id>` locally, `deploy/colo-admin.sh player-stop <player-id>` on the node.
3. Record the stop by player id and date only.

## Gaps and conflicts

1. **No Colo retire verb**, and no Colo command for the registry key and whitelist removal. [Admin service](../reference/admin-service.md) lists `player retire` among the `mcp-tokens` verbs `admin.sh` does not wrap.
2. **The account-page retire does not stop the Body**, while decision 0152 item 1 says retire "stops the body, revokes its tokens, retires the player". Only the API route matches the decision, and it is not mounted on the Colo node at `03c1f5de`. [Life cycle](../concepts/life-cycle-of-a-life.md#retirement) states the decision's version.
3. **Neither register path removes the registry key or the whitelist entry** (no call to the removal in `threshold/register/src` or `supervisor/`, `git grep removeRegistryKey`, 2026-11-16). Whether the supervisor's stop removes them by another path is unverified.
4. **The shard file outlives a retire** on both stacks. Nothing removes the `sovereign.players` entry.

## Related

- The life cycle, including death and erasure: [life cycle of a life](../concepts/life-cycle-of-a-life.md).
- Erasing every life of an owner: [account deletion](account-deletion.md).
- Adding a player and the roster: [mcp-tokens](mcp-tokens.md).
- Rotating instead of retiring: [rotate secrets by role](rotate-secrets-by-role.md#rotate-a-players-mcp-token).
- The supervisor and the body helper: [supervisor and body helper](../reference/supervisor-and-body-helper.md).
