# WM interface requests

Requests from the WM packets to the interfaces they depend on. Each packet adds a `## WM-nn` section.

## WM-06

- (a) No contract pattern exists for `book_id`. `contract/schemas/common.schema.json` (`book_id`, line 72) and `mcp-world.schema.json` only bound it with `minLength: 1` and `maxLength: 64`. The MCP tool code uses `bk_` followed by 26 hex characters, derived from a SHA-256 over title, author and text (`threshold/mcp/src/tools/read-book.ts`). A contract pattern is requested so the id format is checked at the boundary.
- (b) The sleep-mark port (`SleepMark`, `SleepMarks` in `threshold/mcp/src/tools/sleep.ts`) and the agent-profile port (`AgentProfile`, `AgentProfiles` in `threshold/mcp/src/resources.ts`) are defined in tool and resource modules. They should move to `threshold/mcp/src/ports.ts` (WM-11), next to the existing ports.
- (c) `buildSleepPlan` is injected into the sleep tool (`sleep.ts`, dependency `buildSleepPlan`). WM-11 must wire it to the animus sleep plan builder in production.
- (d) Sleep waits for the plan acknowledgement only. It calls `body.submitPlan` and returns on `ack.accepted`; a refusal raises `sleep_refused`. It does not wait for the plan to finish executing.
