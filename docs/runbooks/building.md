---
title: "Building: the flag, rollback, restart windows and what to do after an incident"
type: how-to
audience: operators
status: draft
last_verified: 2026-11-22 against 727109a3
companions: [README.md, coreprotect.md, block-owner.md, nats-auth-inplace.md, kill-switch-programs.md, incident-response.md]
sources: [docs/analysis/building/work-packets.md, docs/decisions/0420-agents-build-and-break-freely-in-survival.md, docs/decisions/0422-building-accepted-risks.md, docs/decisions/0426-building-rollout-both-shards.md]
---

# Runbook: building (plan and break verbs)

Building lets a Body break blocks (`break`) and work through a background plan of block edits (`plan`). It is
governed by decision [0420](../decisions/0420-agents-build-and-break-freely-in-survival.md) (agents build and break
freely in survival) and the accepted risks in [0422](../decisions/0422-building-accepted-risks.md). Read 0422 before
you turn the flag on: it says that nothing is protected, there is no restore and there are no caps.

Who this is for: the node operator. Agents never read this file.

## Principle: operators act from outside the world

On the autonomous shard, operators act only from outside the world: a config change, a restart, a database or
NATS change, or a read of the records. An operator never builds, breaks, fills or sets blocks in the world, and never
gives a Body operator status or creative mode to do it. The Body never receives a server command for building. Any
change that adds `/fill`, `/setblock`, creative mode, operator status or a bulk world edit is wrong; stop and raise
it with the owner.

## What the flag does

- The flag is `body_actions.building`. It defaults to `false`. It is declared in the shard config schema and read
  like `body_actions.use` (decision [0218](../decisions/0218-use-mount-dismount-verbs.md) sets the pattern).
- Flag off: the `break` and `plan` verbs are refused with the neutral message `not_possible: building is not available`, the
  `survey` and `plan_check` MCP tools are refused. The MCP does not read `body_actions.building`; whether they are listed is `sovereign.mcp.show_unavailable_tools`, a separate colo setting. `plan_check` is refused even when the flag is on (see the TODO list). The plan lane is not registered. Nothing runs in
  the background.
- Flag on: agents may break blocks and queue plans, within the physical limits that remain (out of reach, unbreakable
  blocks, unloaded chunks, no reachable stand). The dig-safety refusals for falling blocks, liquids and walled-in cells
  are removed (decision [0428](../decisions/0428-dig-safety-refusals-removed.md)). Deaths are part of the experiment.
- The flag is a shard config change (`shards/colo-mind.yaml`), not a Paper plugin or jar change. It does not expose the MCP tools; see the TODO list.

## TODO after code fix

Not in the code yet. Do not treat these as behaviour.

- Bucket creation only when the flag is on: today the Body creates `geldar-plans` and `geldar-seen` at every start, flag on or off (`golem/src/body/restart.ts`, lines 149 to 150).
- Seed: `golem/src/seed-buckets.ts` does not seed either bucket. The owner seeds them by hand (`docs/runbooks/nats-auth-inplace.md`).
- Metrics emission: the plan and seen metric methods in `golem/src/metrics.ts` have no call sites; no `geldar_plan_*` or `geldar_seen_*` series is emitted yet.
- The MCP reads `body_actions.building`: today it does not.
- `plan_check` is refused even when the flag is on (`threshold/mcp/src/world.ts`; no caller of `planCheckTool`).
- Default Body API prompt: v10 today. The Mind is not taught `break` or `plan` until the default changes to v12 (`animus/src/prompts/library.ts`).

## Rollback: turn the flag off

Use this to stop new building on a shard. It is the only rollback this campaign provides.

1. Set `body_actions.building: false` in `shards/colo-mind.yaml` (the file has no `building` key today; add it under `body_actions`). The Body and MCP read that file through a read-only bind mount, so commit the change, then restart.
2. Restart the Bodies so the Body start reads the new value (the flag is read when a Body starts). The restart path
   is the one in [deploy/README.md](../../deploy/README.md).
3. Check that the flag is off: a `break` attempt is refused with `not_possible: building is not available`, and the MCP tools
   `survey` and `plan_check` are refused, and are not listed when `show_unavailable_tools` is false.

What turning the flag off does not do:

- It does not undo anything the agents built or broke. The world stays as it is.
- It does not delete stored plans or seen-block records. The campaign defines no cleanup for them. Do not delete the
  `geldar-plans` or `geldar-seen` buckets by hand without an owner ruling.
- It does not stop a Body that is already in the middle of a block edit; the edit ends with the restart.

## There is no restore

There is no backup or region restore for the world before go-live. Backups are deferred by decision 0130, and this
campaign does not build one. If an area is destroyed, the operator cannot put it back from a snapshot. Say so in any
incident note. A manual restore by an operator is outside the campaign's tools and is not tested; if it is ever done,
it is done from outside the world, and it is recorded in the incident note.

## How to see what happened

Use the views from outside the world; never ask an agent or a Body to report building status in the world.

- **BlueMap**: the map shows the world as it is now. Compare two render times to see what changed. The BlueMap
  setup is in `plugins/bluemap/README.md`.
- **CoreProtect lookups**: CoreProtect records block changes and who made them. Run its lookups from the Paper console
  or the database, not in game. Setup and the pinned jar are in [coreprotect.md](coreprotect.md); the block owner
  bridge is in [block-owner.md](block-owner.md).
- **Metrics and telemetry**: the building metrics (named in `golem/src/building/names.ts`) show how much building
  happened. They do not show what was built.

## Restart windows R1 to R3

Merging to `main` that touches the colo-images paths (`golem/**`, `contract/**`, `player-core/**`, `threshold/mcp/**`,
`eventsink/**`, `animus/**`, `supervisor/**`, `sql/**`, `shards/phase0.yaml` and the other paths in
`.github/workflows/colo-images.yml`) restarts all 19 Bodies. Test-only paths do not. The building packets are batched
into three windows so that the restarts happen together:

| Window | What merges | Why one window | Operator step before the flag goes on |
|---|---|---|---|
| R1 | Contract, validator, pure libraries and cell code | All dormant: the flag is off and the lane is unregistered | None |
| R2 | The plan lane, the seen-block map and the Body survey endpoint | Flag still off | The NATS role and bucket seed (below) |
| R3 | The MCP tools, their descriptions, metrics and the Glass plan-activity view | Flag still off | None; the prompts and the kit do not restart Bodies |

Before each window, tell the owner that a restart is coming. A window is one restart of all 19 Bodies, not
one per merge.

After R3, the Paper go-live is a config flip plus one restart. It needs no plugin or jar change.

## MANUAL steps: NATS role and bucket seed

The plan store and the seen-block map each use a NATS KV bucket (`geldar-plans` and `geldar-seen`). The Body NATS role
must be allowed to create and use them, and the buckets must be seeded. Both are operator steps; no coder performs
them.

1. Change the live NATS auth config in place, as in [nats-auth-inplace.md](nats-auth-inplace.md). Do not delete and
   regenerate the file, and do not run `shard nats-auth` on the node.
2. Seed the two buckets with the seed lines in `golem/src/seed-buckets.ts`.
3. Check the Body log for a failed bucket create or a denied publish before you turn the flag on.

Do the MANUAL steps before you set `body_actions.building: true`. The flag goes on only after the R2 window has
merged; a Body without the role cannot write its plans.

## Accepted risks (decision 0422)

The owner accepted these with building live for all 19 agents. An operator does not reduce them by changing code;
the owner must rule on any change.

1. **No restore path.** See above.
2. **Nothing is protected** (decision 0420). The town, the ranger bases, the spawn and every agent's work can be
   broken. There is no protected block code.
3. **No caps.** There is no limit on plan size, volume or a daily budget. The lane is tick-budgeted and slows down
   when the server is under load (decision 0423); that is a server-health throttle, not a policy cap.
4. **All 19 at once** (decision 0426), behind the flag.
5. **Known deviations from the spec.** The spec says Geldar-Core protects the Shrine, the Moot Stone and the example
   Cradle; the code does not, and the campaign does not add it. The inline `build` action is deleted (0427). The
   seen-block map is kept across death and read by the next life (0424). The dig-safety refusals are removed (0428).
   The spec file itself is unchanged.

Principle 5 of the spec treats griefing as data. The records above are the data.

## Kit upgrade lag

The agent kit teaches the building verbs and allows the `survey` and `plan_check` tools (decision 0425). Those kit
files are in the kit repo and reach an agent only through a kit upgrade PR, which is a MANUAL step. Until the upgrade
lands:

- An agent on the old kit does not know the building verbs and does not call `survey` or `plan_check`. It can still
  try `break`; the flag decides what happens.
- Turning the flag on does not teach agents anything. Expect the first building to come a few days after the flag
  goes on, not on the same day.
- Do not hand-edit the kit or an agent's `identity.md` to speed this up. Kit changes go through the kit repo.

## Go-live checklist

1. R1, R2 and R3 are merged to `main` and the Bodies have restarted for each.
2. The owner has accepted the risks in 0422 for this shard.
3. The NATS role and both buckets are in place (MANUAL steps above) and the Body log is clean.
4. Set `body_actions.building: true` on the shard and restart the Bodies.
5. Watch the first hour: the BlueMap render, the CoreProtect lookups and the metrics. If an incident happens, follow
   [incident-response.md](incident-response.md). If the owner orders it, roll back as above.
