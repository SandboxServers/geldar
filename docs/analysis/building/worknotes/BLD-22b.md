# BLD-22b: plan_check reaches the Body through the gateway

Status: done on `phase1/bld-planchk-gateway`. `plan_check` no longer refuses in `threshold/mcp/src/world.ts`; the dry run runs on the Body.
Base: `727109a3` (`building/integration`).

## Design

- The dry run moved to the Body. The Body holds the seen map and the pack, so the MCP tool forwards the plan and the Body answers the contract's `plan_check` result. No unseen cell crosses the gateway: the Body reads its seen map for a boolean per cell and reports `unknown_cells` as a count.
- `contract/src/subjects.ts`: `planCheckSubject(shard, lifeId)` returns `geldar.<shard>.body.<life_id>.plan_check` (same `checked` rules as `surveySubject`). Exported in `sovereign.ts`; golden updated (sorted).
- `threshold/mcp/src/ports.ts`: `BodyGateway.planCheck(lifeId, { plan })`.
- `threshold/mcp/src/body-gateway.ts`: `NatsBodyGateway.planCheck` sends on the subject with a 5 s window. The Body's `{"error":"plan_too_large"}` returns as data; any other reply the contract does not accept (including the flag-off `not_available`, bad JSON, timeout) rejects `BodyUnavailable`.
- `threshold/mcp/src/tools/plan-check.ts`: `planCheckTool(deps, call, input)` checks the session, then the input, forwards to the Body, and maps the reply. Messages are exported as `PLAN_CHECK_MESSAGES`; `plan_too_large` is a new closed code.
- `threshold/mcp/src/world.ts`: the always-refuse is removed; the handler runs `planCheckTool` with `wired.body.planCheck`.
- `golem/src/building/plan-check-reply.ts`: `answerPlanCheck(body, request, building)` and `planCheckFrom(seen, bot)`. The dry run uses `expandPlan` and `tallyMaterials` from player-core, lazily. `PLAN_CHECK_CELL_CAP = 8192`: the visit that would pass the cap throws, so no cell past it is expanded and the answer is `plan_too_large`. Flag off: `not_available`, and the map is not read. A bot with no position: `not_available` (the gateway fails closed).
- `golem/src/mind-link/server.ts`: `MindLinkServerOptions.planCheck`; the server serves `planCheckSubject`. Survey and plan_check share one `answerFrom` helper.
- `golem/src/adam/adam-body.ts`: `planCheck: planCheckFrom(seen.map, bot)` is passed beside `survey` when the seen wiring exists (the building flag is on).

## Tests

- `golem/src/building/plan-check-reply.test.ts`: counts from the seen map and pack; flag off refused without reading the map; unseen cell counted as unknown, no coordinates in the reply; huge plan refused as `plan_too_large` with at most cap+1 reads; missing palette key listed as invalid; bad input refused.
- `golem/src/mind-link/plan-check-serve.test.ts`: the served subject; round trip through the server to the seen map (contract keys only); not_available when unwired; not_available for non-JSON without calling the dry run; not_available when the bot has no position.
- `threshold/mcp/src/tools/plan-check.test.ts`: forwards to the Body; closed session and bad input never reach the Body; a throw and an invalid reply are `body_unavailable`; the Body's `plan_too_large` is `plan_too_large`.
- `threshold/mcp/src/plan-check-gateway.test.ts`: the subject and the body; `plan_too_large` as data; `not_available`, bad JSON and timeout reject `BodyUnavailable`.
- `contract/test/view-tool.test.ts`: the subject builder and its rejections.

## Revert-checks (each run on its own; the file restored from a scratchpad copy; diff empty after)

- `plan-check-reply.ts`: `if (!building) return ...` set to `if (false)` fails the flag-off test.
- `plan-check-reply.ts`: the cap line set to `if (false)` fails the huge-plan test.
- `plan-check-reply.ts`: the `stepUnknown++` guard set to `if (false)` fails the unseen-cell test.
- `tools/plan-check.ts`: the `plan_too_large` mapping line removed fails the pass-through test.

## Findings

- `threshold/mcp/src/instinct-door.test.ts` still lists `plan_check` in `NOT_CALLED` with the reason "the world does not wire the tool yet". The reason is stale; the packet did not name that file, so it is unchanged.
- `world.ts` stays above the 500-line soft cap, as it was before this packet (it was 547 at base; it is smaller now).
- The ToolError message for `body_unavailable` in `PLAN_CHECK_MESSAGES` reuses the wording the other tools use; it is a fixed string, not the shared constant from `world.ts`.
