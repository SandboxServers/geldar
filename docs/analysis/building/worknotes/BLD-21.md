# BLD-21 worknote

Status: Done (one commit on `phase1/bld-21-mcp-survey`; the commit is the one whose message is `BLD-21: MCP survey tool`)
Branch: `phase1/bld-21-mcp-survey`
Worktree: `C:\Users\Steve\source\projects\geldar-wt-bld-21`
Base sha: 84d91d5c (`building/integration`, local; no `origin/building/integration` ref exists)
Commit: see `git log` for `BLD-21: MCP survey tool`
Checks: biome check clean on the changed files; `threshold/mcp` and `threshold/mcp-mock` typecheck clean; `contract` typecheck clean; `contract` `check:generated` up to date; `vitest run threshold/mcp threshold/mcp-mock contract` 220 files passed
Revert check (test that failed): see the coder report
Live: pending (none in this packet)
Notes:

- The tool is exposed: `mcp-survey` is out of `NOT_YET_EXPOSED` (contract/scripts/generator.ts), and `survey` is in `MCP_TOOL_NAMES`. It stays hidden by name while the flag is off (`NOT_YET_EXPOSED_TOOLS` in unavailable.ts).
- `surveyTool(deps, call, input)` takes a `survey` port (the Body request), `isOpen`, and a per-life limiter (`createSurveyLimiter`, one admitted call per 5 s). Order: closed session, then contract input check, then the window, then the Body. A reply the contract does not accept is `body_unavailable`. The reply copies only `text` and `truncated`.
- Deviation: the Body request through `body-gateway.ts` is not written. The packet's file list allowed only `survey.ts` and its test, so the world registers `survey` as a refusal (`not_available`) for now. The wiring of the Body request and the real handler belongs to the packet that owns the gateway.
- Deviation: `threshold/mcp/src/world.ts` and `threshold/mcp-mock/src/sim/sim-world.ts` and `threshold/mcp-mock/src/fake-world.ts` each gained a `survey` handler, because `ToolHandlers` requires every tool and typecheck fails without one. The mock fixtures (`app.test.ts`, `registry.test.ts`, `cli.test.ts`, `image.test.ts`) and contract pins (`mcp-bundle`, `mcp-world`, `mcp-world-fixtures`) gained `survey` or its count.
- `survey-plan-stubs.test.ts` no longer asserts the survey body refusal (the body is real now); the plan_check assertion stays.
- The Body rendering that this tool returns is the BLD-20 `surveyBox` contract (see BLD-20.md).
