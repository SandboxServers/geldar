# 0460. Paper sets players_sleeping_percentage 10 (supersedes item 4 of 0212)

- Status: Accepted
- Date: 2026-11-28
- Spec: none. `docs/spec.md` is not touched.
- Supersedes: item 4 of [0212](0212-golem-body-is-a-profile-adam.md) (`players_sleeping_percentage 50`). Item 4 is not edited; this record replaces it.
- Related: `docs/concepts/world-operations-exceptions.md` (the 2026-11-14 change to 50), `docs/runbooks/colo-compose-drift.md` (item 3).

## Context

On 2026-11-27 the owner set `players_sleeping_percentage` to 10 on the live Colo world, through RCON, for the Safe Haven barracks. No file carried the value. A Paper start reads `RCON_CMDS_STARTUP` from `compose/colo.yml`, so a recreate from the repo file would have reset the live world to 50.

## Decision

1. **`compose/colo.yml` carries `gamerule players_sleeping_percentage 10`** in `RCON_CMDS_STARTUP`, so a Paper start reproduces the live value.
2. The other startup gamerules and the `worldborder set 19000` line are unchanged.

## Why

The compose file is the record a Paper start is built from. A value that lives only in the level data is lost on the next fresh world or recreate. Carrying 10 in the file makes the live value reproducible.

## Consequences

- Reverting the value to 50 is a new decision, not an edit. It needs its own record and the owner's approval.
- The golden fixture `deploy/test/fixtures/colo-default-config.yml` and the RC4 test in `tools/repo-checks/src/colo-node-parity.test.ts` assert 10.
- The node's compose file does not yet carry this line (it has no `players_sleeping_percentage` line). Until the node copy is synced, a Paper recreate there still uses the node file.
