# 0344. Explore, farm and patrol programs

- Status: Proposed
- Date: 2026-11-18
- Spec: section 13 gap (program shapes for the sheet campaign's explore, farm and patrol programs); card AN-44

## Decision

The explore, farm and patrol programs take a fixed set of start arguments and keep a checkpoint of fixed, bounded shape. The shapes are contract schema `contract/schemas/program-shapes.schema.json`, checked by `contract/src/programs.ts`:

- explore: `legs` 1 to 12 (default 6), `leg_blocks` 8 to 48 (default 24), `avoid_water` (default true); at most 96 visited chunks in a checkpoint.
- farm: `radius` 4 to 24 (default 12), `max_cells` 1 to 32 (default 16), `replant` (default true). Farm takes a radius around the Body, never a position.
- patrol: `route` of 2 to 8 integer points, `laps` 1 to 5 (default 1), `loop` (default true). Patrol has no limit of its own: the executor's world-tick bound is the only one.

A checkpoint repeats the start arguments, because `resume()` receives none, and the split counts farm reports. Every shape rejects an unknown key. A hard cap is a schema maximum: an oversize value is invalid, never clamped. Coordinates are integers the Body observed.

## Why

The three programs share one rule: the Body acts only on what it can see, and the Mind names bounded amounts, never positions it has not been given. Fixed shapes make a checkpoint small enough to echo (under 2 KiB) and let every program reject bad input the same way.

## What it changes

- A contract schema and validators; no generated change to the `act` tool input beyond one placeholder sentence in the `ActInput.intent` description.
- Outcome wording for explore, farm and patrol in `contract/src/outcome-words.ts`. These sentences are placeholders awaiting owner approval (D-CS-14); they reach an agent only through version selection, which is not part of this record.
- No change to the thought schema, the action set or the prompt versions. Rollback is revert.
