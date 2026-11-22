# 0428. The dig-safety refusals are removed for plans, break and mine

- Status: Accepted (owner, 2026-11-22)
- Date: 2026-11-22
- Spec: section 2 principle 5; decisions 0164 (goto digging), 0349, 0420.

## Decision

`mine`, `break` and the plan lane no longer refuse a dig because a falling-block column is overhead, liquid touches the cell, the cell is walled in, or the block is under the agent's feet (the "would drop you" refusal in `mine`, owner ruling 2026-11-22; listed explicitly). Only physically impossible refusals stay: out of reach, an unbreakable block (bedrock, barrier and the like), an unloaded chunk, no reachable position. Goto tier-2 pathing is unchanged.

## Why

The owner wants survival to be the only limit. A fall, a flood or a cave-in is what a human player risks. Deaths are part of the experiment (principle 5).

## Consequences

- Agents will die building and mining; the reflexes stay (fall-stop, hazard-escape) but do not prevent the dig.
- Packet BLD-36 removes the refusals with tests that fail on revert. The research code `unsafe` no longer exists.
