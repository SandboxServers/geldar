# BLD-38e: survey reaches the Body through the gateway

Status: partial. The contract subject, the gateway request, the tool wiring and the golem responder (`MindLinkServer` serves the survey subject) are in. The survey still reaches no live Body: no production caller passes the `survey` option to `MindLinkServer` (see below), so the server replies `not_available` and the gateway returns `body_unavailable`.

Base: `2423825f` (building/integration).
Branch: `phase1/bld-38e-survey-gateway`.

## Done

- `threshold/mcp/src/ports.ts`: `BodyGateway.survey(lifeId, { box, layers? }): Promise<unknown>`. Rejects with `BodyUnavailable` when the Body does not answer. The tool checks the reply against the contract.
- `threshold/mcp/src/fakes/world.fakes.ts`: `FakeBody.survey` records every request in `surveyRequests`; `setSurvey` scripts the reply; offline rejects.
- `threshold/mcp/src/world.ts`: the `survey` handler runs `surveyTool` with `wired.body.survey`, a per-world limiter and the session-closed check. Failures become `ToolError` with a fixed message (`surveyOf`). The flag-off refusal is the existing hidden-tool path in `unavailable.ts`, covered by `tools/survey-plan-stubs.test.ts`.
- `golem/src/building/survey-reply.ts`: `answerSurvey(seen, request, nowTick)` validates the request against the contract `survey` input, maps the contract box (`from`, `to`) to the seen map's inclusive `min`/`max` box, calls `survey(box, nowTick)`, and returns `{ text, truncated }` only. Pure; no subject.
- Tests: `threshold/mcp/src/survey-gateway.test.ts` (tool to FakeBody round trip, offline, bad reply, fail-closed NATS adapter), `golem/src/building/survey-reply.test.ts` (box mapping, reply shape, refusal without asking the map, unseen cell reads `unknown`).

## Contract subject (done, sanctioned by the orchestrator ruling)

- `contract/src/subjects.ts`: `surveySubject(shard, lifeId)` returns `geldar.<shard>.body.<life_id>.survey`, with the same `checked` validation as `viewSubject`. Exported through the `sovereign.ts` export block; `contract/test/public-surface.golden.json` gained `surveySubject`.
- Test: `contract/test/view-tool.test.ts` names the survey subject and rejects wildcard, `>` and dotted life ids. Revert-check: the builder returning the `.view` subject fails this test.

## Gateway request (done)

- `NatsBodyGateway.survey` sends the input on `surveySubject` with a 5 s window and validates the reply with `validateToolResult('survey')`. A flag-off `{"error":"not_available"}`, an owner field, bad JSON or a timeout reject `BodyUnavailable`. Tests: `threshold/mcp/src/survey-gateway.test.ts` (7 pass). Revert-check: `if (false)` on the validation line fails the flag-off and owner-field tests.

## Golem responder (done, not yet fed)

- `golem/src/mind-link/server.ts`: `MindLinkServerOptions.survey?: (request) => unknown`; `start()` serves `surveySubject`. `onSurveyRequest` replies `JSON(survey(request))`, or `{"error":"not_available"}` when no `survey` is passed or the request is not JSON.
- `golem/src/building/survey-reply.ts`: `answerSurvey(seen, request, nowTick, building)`. With `building` false it returns `not_available` and does not ask the map. `layers` counts y-layers upward from the box's lower y (max y clamped to `min.y + layers - 1`).
- Tests: `golem/src/mind-link/survey-serve.test.ts` (round trip through the server to the real map: text and truncated only; not_available with no survey wired, with the flag off, and for non-JSON, the survey not called); `golem/src/building/survey-reply.test.ts` (box, flag off, contract refusal, layers counting and clamping, unseen cell).
- `golem/src/mind-link/server.test.ts`: the "exactly the subjects" test now expects the survey subject too (it had asserted three).
- Revert-checks: `if (!building)` set to `if (false)` fails the flag-off test; the layers clamp set to `if (false)` fails the layers test. Both restored.

## Not wired (remaining)

- No production caller passes `survey` to `MindLinkServer`. `golem/src/adam/adam-body.ts:368` builds the server and does not hold the seen wiring; `golem/src/body/create-body.ts:104` exposes it as `seen` (null with the flag off), but that value is not carried to adam-body. The fix: pass `seen` from the create-body result to adam-body, then `survey: (request) => answerSurvey(seen.survey..., request, tick(), true)` when it is non-null, else omit it.
- The gateway test is a fake-transport test; no test yet drives the gateway against the golem server end to end.

## Decision item

- `layers` is applied (ruling): a count of y-layers upward from the box's lower y, clamped.

## Findings

- `layers` is accepted by the contract input but `surveyBox` has no layers parameter. `answerSurvey` ignores it. Needs a decision before the subject lands.
- No direct test of the `world.ts` wiring: the round trip test drives `surveyTool` with the gateway fake, not `createWorld`.

## Correction (2026-11-22)

- The status line ("partial ... reaches no live Body") is superseded by BLD-38g (ledger: Done).
- The "Not wired" item ("No production caller passes `survey` to `MindLinkServer`") is stale: `golem/src/adam/adam-body.ts:392` passes `survey: surveyFrom(restarted.body.seen, tick)`. Code-level only; no live run is claimed here.
