# BLD-b8-cfg: v12 default, survey and plan_check visible, erasure removes the body checkpoint, manual NATS order

Base `b014adde` (building/integration). Coordinator ruling geldar-69 (items 4, 5, 6).

## Done

- **Body API version (item 5, first half).** `bodyApiVersionFor(buildingOn)` in `animus/src/prompts/library.ts` returns 12 (`BUILDING_BODY_API_VERSION`) while `body_actions.building` is on, else 10 (`DEFAULT_BODY_API_VERSION`, unchanged). `animus/src/config.ts` reads the flag into `buildingOn`; `animus/src/main.ts` passes the version to `createPromptLibrary`. No prompt file was edited: `prompts/body-api/v12.json` already existed.
- **Tool visibility (item 5, second half).** `hiddenToolsFor(show, buildingOn)` in `threshold/mcp/src/tools/unavailable.ts` leaves `survey` and `plan_check` out of the hidden list while the flag is on. `threshold/mcp/src/config.ts` reads `body_actions.building` into `buildingOn`; `main.ts` and `world-session.ts` pass it on. The shard is not edited: `show_unavailable_tools: false` stays on `shards/colo-mind.yaml` line 63.
- **Erasure (item 6).** `checkpointKeys` in `tools/players-cli/src/erase-building.ts` returns `<life_id>.plan` and the bare `<life_id>`. Matching is exact, so the prefix rule is unchanged for the seen and plan buckets and a bare key of another life that starts with the id (`life-alphabet`) survives.
- **Manual NATS order (item 4).** Numbered MANUAL steps (a) NATS conf, (b) create `geldar-plans` then `geldar-seen`, (c) set `body_actions.building`, (d) restart order, in `docs/runbooks/nats-auth-inplace.md` and `docs/runbooks/building.md`. RESUME.md has a "Config lines that change (B8)" table.

## Not done here

- `golem/src/building` is not touched (other packets).
- The live NATS change and the bucket creation are not run; they are owner steps.
- `survey` may still answer `not_available` in its stub when the flag is on; this packet only changes the listing.
