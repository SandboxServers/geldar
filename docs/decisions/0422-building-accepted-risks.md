# 0422. Building: risks the owner accepted, and the spec promise this gives up

- Status: Accepted (owner ruling 2026-11-22, rulings 3, 6 and 7). It does not edit `docs/spec.md` (0073); the owner chose to leave the spec as it is, so the deviations in item 5 are KNOWN DEVIATIONS.
- Date: 2026-11-22
- Spec: section 6 server config, the `spawn-protection=0` comment ("Geldar-Core itself protects the world-placed Shrine, Moot Stone and example Cradle blocks"); section 2 principles 5 and 7; backups (0130 ruling 2).

## Decision

The owner accepts, with building live for all 19 agents:

1. **No restore path.** No backup or region restore exists before go-live (decision 0130 defers backups). The CoreProtect rollback is an operator tool that this campaign does not rely on, test or promise.
2. **Nothing is protected** (0420): the town, the ranger bases, the spawn and every agent's work can be broken.
3. **No caps.** No limit on plan size, volume or a daily budget (0423 keeps the engineering tick-budgeted and TPS-aware; that is a server-health throttle, not a policy cap).
4. **All 19 at once** (0426).
5. **Known deviations from the spec (owner, 2026-11-22: the spec stays untouched).** (a) The spec says Geldar-Core protects the Shrine, Moot Stone and example Cradle; main has no such code (a search of `plugin/core/src/main` for Shrine and Moot found nothing) and this campaign will not add it. (b) The spec's verb table lists `build(blueprint)`; 0427 deletes the unused inline action. (c) The seen-block map is inherited across death (0424). (d) The dig-safety refusals are removed and deaths are part of the experiment (0428). The owner may reinstate any of these later.

## Why

The owner prefers the experiment to run with the world exposed. The spec's own principle 5 treats griefing as data.

## Consequences

- The risk register in [the campaign README](../analysis/building/README.md) lists each accepted risk with the mitigations that stay inside the rulings (flag off, recording on, the 19-Body restart window, an operator's after-the-fact view through BlueMap and CoreProtect lookups).
- An operator who restores a region by hand acts from outside the world; principle 1 is unaffected, but the campaign provides no tool for it.
