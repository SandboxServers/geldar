# 0074. Shelter means an enclosed safe space

- Status: Accepted (owner)
- Date: 2026-11-10
- Spec: 5.4 (the fatigue rule, around line 503), the `sleep()` tool in 5.15 (around line 891). This record amends the fatigue rule. The spec is not edited.
- Packet: shelter-1
- Worknote: docs/analysis/phase0/known-gaps.md (Corrections, shelter)

## Context

The prompts and the Body-facing API taught agents that a bed is the place to be safe. An agent without a bed
reasoned that it had no shelter, and the one shelter the Body could name was a bed.

Facts at the time of this decision:

- The Body's `sleep` action still requires a bed within 32 blocks at night (`golem/src/actions/sleep.ts`).
- The MCP `sleep` tool writes the days-since-sleep mark immediately, whatever the Body's outcome
  (`threshold/mcp/src/tools/sleep.ts`, around lines 96 to 103). A refused sleep still resets the fatigue clock.
- The `build` action has no handler, so a call fails as unsupported. No agent can place a shelter.
- The burrow reflex exists (`golem/src/body/reflexes/panic-burrow.ts`), but no agent can call it.
- The adam-report survival criteria (`tools/adam-report/src/survival.ts`, around lines 106 to 153) check
  "bed placed, slept in bed".

## Decision

1. A shelter is an enclosed safe space: solid blocks close the Body's cell on every side, above and below
   (`isEnclosed` in `golem/src/body/view.ts`). A bed is one shelter, not the only one. A hut, a house or a
   hole in the ground counts.
2. A night rested in any enclosed shelter counts as sleep for the fatigue rule. This amends spec 5.4: the
   degraded reflection applies to an agent that has not rested in any shelter for 3 in-game days.
3. The snapshot reports `surroundings.enclosed`, an optional boolean, so an agent can tell whether it is
   enclosed. Light level is not exposed.
4. Prompt v5 (`prompts/thought/v5.md`) is the default thought prompt, and body-api v2
   (`prompts/body-api/v2.json`) is the default Body API. Prompt v4 and body-api v1 stay loadable. Released
   templates stay immutable (decision 0068).
5. The MCP `sleep` description says the agent rests best in a bed or a sealed shelter.

## Consequences

- Agents may reason that any enclosed space is a shelter. Nothing yet lets an agent build one: the `build`
  action has no handler, and no agent-callable shelter intent exists.
- The sleep mark is still written regardless of the Body's outcome. Until that changes, the fatigue clock
  can reset on a refused sleep.
- The Body's `sleep` action still needs a bed. An enclosed rest is not yet a sleep the Body accepts.
- The adam-report survival criteria are bed-only. The exit run is not revived until a follow-up decision
  sets its criteria to the enclosed rule.
- The follow-ups are listed in `docs/analysis/phase0/known-gaps.md` (Corrections, shelter).
