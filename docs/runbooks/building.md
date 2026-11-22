---
title: "Building: the flag, rollback, restart windows and what to do after an incident"
type: how-to
audience: operators
status: draft
last_verified: 2026-11-22 against d87221c4
companions: [README.md, coreprotect.md, block-owner.md, nats-auth-inplace.md, kill-switch-programs.md, incident-response.md]
sources: [docs/analysis/building/RESUME.md, docs/decisions/0420-agents-build-and-break-freely-in-survival.md, docs/decisions/0422-building-accepted-risks.md, docs/decisions/0426-building-rollout-both-shards.md]
---

# Runbook: building (plan and break verbs)

Building lets a Body break blocks (`break`) and work through a background plan of block edits (`plan`). It is
governed by decision [0420](../decisions/0420-agents-build-and-break-freely-in-survival.md) (agents build and break
freely in survival) and the accepted risks in [0422](../decisions/0422-building-accepted-risks.md). Read 0422 before
you turn the flag on: it says that nothing is protected, there is no restore and there are no caps. Open gaps are in
[RESUME.md](../analysis/building/RESUME.md) under "Known gaps and owner decisions".

Who this is for: the node operator. Agents never read this file.

## Principle: operators act from outside the world

On the autonomous shard, operators act only from outside the world: a config change, a restart, a database or
NATS change, or a read of the records. An operator never builds, breaks, fills or sets blocks in the world, and never
gives a Body operator status or creative mode to do it. The Body never receives a server command for building. Any
change that adds `/fill`, `/setblock`, creative mode, operator status or a bulk world edit is wrong; stop and raise
it with the owner.

## What the flag does

- The flag is `body_actions.building`, default `false`. The Body reads it when it starts. It is not in `shards/` today:
  `shards/colo-mind.yaml` has no `building` key.
- **Flag off.** `break` and `plan` are refused (`not_possible: building is not available`). The `survey` and
  `plan_check` requests reach the Body, which answers `not_available`; the MCP tool then returns the tool error
  `body_unavailable`. The MCP does not read the flag. No plan lane is registered and nothing runs in the background.
- **Flag on.** Agents may break blocks, queue plans and survey or dry-run plans, within the limits that remain
  (out of reach, unbreakable blocks, unloaded chunks, no reachable stand). The dig-safety refusals for falling blocks,
  liquids and walled-in cells are removed for `break`, `mine` and plans (decision [0428](../decisions/0428-dig-safety-refusals-removed.md)).
  They still apply to the unstick, pillar, escape-ladder, escape-stairs and reflex digs. Deaths are part of the experiment.
- Persistence, on the Bodies that run with the flag on: a plan is stored in `geldar-plans` in chunks and its cursor
  is checkpointed, so a Body restart resumes the plan from its cursor. The seen-block map is kept in `geldar-seen`.
  Both apply to Adam's Body and to the player Bodies (`restartKvFor`, `golem/src/adam/main.ts`).
- Turning the flag on replays a saved plan: a plan stored before a rollback resumes when the flag is turned back on
  and the Body restarts.

## Limits that exist in code

- **Survey box:** a box over 32768 cells is refused as `box_too_large`; the MCP tool returns `invalid_input`.
- **plan_check:** over 8192 cells the reply is `plan_too_large`; at most 256 `invalid_steps` are returned. The
  contract has no `maxItems` on `invalid_steps`.
- **plan:** no size cap. A very large plan (for example a sphere of radius 60 or more) is expanded in full before it
  runs; see the known gaps in RESUME.md. Only the lane throttle limits the work per tick.
- **Facing:** a block state is accepted only as stairs `half`. `facing`, `axis` and other keys are refused by name
  (`state_unachievable`) for every block kind, so a plan asking for `oak_stairs[facing=north]` fails cell by cell.
- **Intents:** a `gather` or `travel` intent pauses the plan lane while it runs, as a reflex does.
- **Checkpoint:** one plan checkpoint per life. Cancelling a waiting plan does not remove the checkpoint of the active one.

## Rollback: turn the flag off

Use this to stop new building on a shard. It is the only rollback this campaign provides.

1. Set `body_actions.building: false` in `shards/colo-mind.yaml` (add the key under `body_actions`). The Body and MCP
   read that file through a read-only bind mount, so the node checkout must carry the change (the mechanism is not
   verified here), then restart.
2. Restart the Bodies so the Body start reads the new value. The restart path is in
   [deploy/README.md](../../deploy/README.md).
3. Check that the flag is off: a `break` is refused with `not_possible: building is not available`; `survey` and
   `plan_check` answer `body_unavailable` through the MCP; they are not listed when `show_unavailable_tools` is false.

What turning the flag off does not do:

- It does not undo anything the agents built or broke.
- It does not delete stored plans or seen-block records, and a stored plan resumes when the flag goes back on. The
  campaign defines no cleanup or expiry. Do not delete the `geldar-plans` or `geldar-seen` buckets by hand without an
  owner ruling.
- It does not stop a Body that is in the middle of a block edit; the edit ends with the restart.

## There is no restore

There is no backup or region restore for the world before go-live. Backups are deferred by decision 0130, and this
campaign does not build one. If an area is destroyed, the operator cannot put it back from a snapshot. Say so in any
incident note.

## How to see what happened

Use the views from outside the world; never ask an agent or a Body to report building status in the world.

- **BlueMap**: the map shows the world as it is now. Compare two render times to see what changed. The BlueMap
  setup is in `plugins/bluemap/README.md`.
- **CoreProtect lookups**: CoreProtect records block changes and who made them. Run its lookups from the Paper console
  or the database, not in game. Setup is in [coreprotect.md](coreprotect.md); the block owner bridge is in
  [block-owner.md](block-owner.md).
- **Metrics**: the plan and seen series (`geldar_plan_*`, `geldar_seen_*`, defined in `golem/src/metrics.ts`, lines
  270 to 275, and documented in [progress-metrics.md](progress-metrics.md)) are emitted by Bodies that run with the flag
  on. They are pushed only when `GELDAR_TELEMETRY_URL` is set. They show how much building happened, not what was built.
- **Erasure**: `tools/players-cli` erase (`erase-owner`) also removes the building data of each erased life: its
  `geldar-seen` sections, its `geldar-plans` chunks and its `<life>.plan` key in `geldar-checkpoints`
  (`tools/players-cli/src/erase-building.ts`).
  Run this step only after the life's Body is stopped: stop the life's Body before erasing, because a running Body's seen writer re-creates `<life>.<sx>.<sy>.<sz>` keys after the purge.

## Restart windows R1 to R3

Merging to `main` that touches the colo-images paths restarts all 19 Bodies. Test-only paths do not. The building
packets were batched into three windows:

| Window | What merges | Why one window | Operator step before the flag goes on |
|---|---|---|---|
| R1 | Contract, validator, pure libraries and cell code | All dormant: the flag is off and the lane is unregistered | None |
| R2 | The plan lane, the seen-block map and the Body survey endpoint | Flag still off | The NATS role for the two building buckets (below) |
| R3 | The MCP tools, their descriptions, metrics and the Glass plan-activity module | Flag still off | None; the prompts and the kit do not restart Bodies |

Before each window, tell the owner that a restart is coming. A window is one restart of all 19 Bodies.

After R3, the Paper go-live is a config flip plus one restart. It needs no plugin or jar change.

## MANUAL step: NATS role for the building buckets

The plan store and the seen-block map each use a NATS KV bucket (`geldar-plans` and `geldar-seen`). The Body creates
both itself at its start when the flag is on (`openRestartKv`, `golem/src/body/restart.ts`, lines 152 and 153). There is
no seed step for them. Two facts follow:

1. The live NATS auth config must let the `body` role create and use both buckets before the flag-on restart. Change it
   in place, as in [nats-auth-inplace.md](nats-auth-inplace.md). `geldar.ps1` does not grant these two buckets, so a
   regenerated file drops the edit.
2. Without the role, a Body with the flag on fails in `openRestartKv` and does not start. Check the Body log for a
   failed bucket create or a denied publish before you set the flag, and expect the failure on the first restart after it.

`golem/src/seed-buckets.ts` is a scratch-only one-shot. It creates the two identity buckets (`geldar-life-registry`,
`geldar-skins`) with the `seed` user. Its `seedBuildingBuckets` helper is not run by `main` and the `seed` user cannot
create the building streams, so the seed script is not an operator step for these buckets.

Do the role step before you set `body_actions.building: true`.

## Accepted risks (decision 0422)

The owner accepted these with building live for all 19 agents. An operator does not reduce them by changing code;
the owner must rule on any change.

1. **No restore path.** See above.
2. **Nothing is protected** (decision 0420). The town, the ranger bases, the spawn and every agent's work can be
   broken. There is no protected block code.
3. **No caps in policy.** The lane is tick-budgeted and slows down under server load (decision 0423). The code limits
   listed above (survey box, plan_check) are health bounds, not policy caps; `plan` has no size bound in code.
4. **All 19 at once** (decision 0426), behind the flag.
5. **Known deviations from the spec.** The spec says Geldar-Core protects the Shrine, the Moot Stone and the example
   Cradle; the code does not, and the campaign does not add it. The inline `build` action is deleted (0427). The
   seen-block map is kept across death and read by the next life (0424), but no predecessor source exists yet, so
   no life inherits a map today. The dig-safety refusals are removed for `break`, `mine` and plans (0428).

Principle 5 of the spec treats griefing as data. The records above are the data.

## Kit upgrade lag

The agent kit teaches the building verbs and allows the `survey` and `plan_check` tools (decision 0425). Those kit
files reach an agent only through a kit upgrade PR, which is a MANUAL step. Until the upgrade lands:

- An agent on the old kit does not know the building verbs and does not call `survey` or `plan_check`. It can still
  try `break`; the flag decides what happens.
- Turning the flag on does not teach agents anything. The default Body API prompt is v10 (`animus/src/prompts/library.ts`,
  `DEFAULT_BODY_API_VERSION = 10`); the Mind is not taught `break` or `plan` until the owner switches the default to
  v12, which is an `animus/**` change and restarts Bodies.
- Do not hand-edit the kit or an agent's `identity.md` to speed this up. Kit changes go through the kit repo.

## Go-live checklist

1. R1, R2 and R3 are merged to `main` and the Bodies have restarted for each.
2. The owner has accepted the risks in 0422 for this shard.
3. The NATS role for `geldar-plans` and `geldar-seen` is in the live conf (MANUAL step above) and the Body log is clean.
4. Owner decisions taken (see RESUME.md "Known gaps and owner decisions"): tool visibility on colo
   (`show_unavailable_tools` is `false` in `shards/colo-mind.yaml`, which hides `survey` and `plan_check`; setting it
   `true` also lists six other tools the world does not run); the default prompt switch to v12; and the open animus
   test failures (eight were reported failing at `6fe2448b`; not re-run for this revision).
5. Set `body_actions.building: true` on the shard and restart the Bodies.
6. Watch the first hour: the BlueMap render, the CoreProtect lookups and the metrics. If an incident happens, follow
   [incident-response.md](incident-response.md). If the owner orders it, roll back as above.
