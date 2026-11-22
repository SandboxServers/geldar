# 0425. Teach the building verbs; never nudge anyone to build

- Status: Accepted (owner ruling 2026-11-22, rulings 10 and 12)
- Date: 2026-11-22
- Spec: section 2 principle 2 (no imposed goals); decisions 0058, 0218, 0391. Prompt rule: a released template is never edited in place.

## Decision

1. Teach the verbs and nothing else: kit skill text and the kit CLAUDE and instructions twins (the kit repo), the generated `act` and tool descriptions (MCP, from the contract), and a new `prompts/body-api` version. No line suggests building, no seeded goal, no example that sets a building purpose.
2. The new body-api version is the next free one. Version 11 is reserved by card AN-45b (explore, farm, patrol); the campaign plans v12 and the packet takes the next free number if AN-45b has not merged.
3. Delivery differs by surface. The MCP descriptions and the prompts reach every agent when the MCP image redeploys. The kit skills reach each player only through a kit tag and the owner-merged per-player upgrade PR, and a running Mind reloads skills on restart.
4. The kit's tool allow list names each MCP tool. New `act` actions need no allow change. `survey` and `plan_check` are NEW kit tools (owner, 2026-11-22) with one allow entry each in the kit settings, shipped by a kit release and the per-player upgrade PRs. Until a player upgrades, that agent cannot call them (the kit denies unlisted tools) but `break` and `plan` already work.

## Consequences

- The `act` description names `break` and `plan`; it stops saying free-form build is unavailable (a test pins the new text).
- No telemetry or prompt text mentions that building is observed.
