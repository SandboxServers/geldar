# T-06c card: capture MCP tool arguments and results into telemetry

Status: written (docs only, 2026-11-16). Coder NOT started. This card waits for geldar-93's go. It is PR-only, held unmerged, and needs owner approval for this card before any code is written or merged.

Governing record: decision [0350](../../decisions/0350-telemetry-scope-and-full-capture.md), content policy (point 2): during development all tool results and action arguments and outcomes are captured into SigNoz, with no opt-out. Readers are operator-only (point 6). Agents never see or infer telemetry (point 7).

## Why a separate card

T-06 covers the MCP server's span and metric plumbing. Tool arguments and results are agent content, not plumbing. They carry the most sensitive text in the system: what an agent asked for, and what the world returned. A separate card lets the owner approve the content path on its own, and lets a revert of this card leave T-06 intact.

## Files likely touched (UNVERIFIED until the coder reads them)

- `threshold/mcp/src/telemetry.ts`: does not exist yet. This card would create it, and it wires the MCP tool handler to the content helpers.
- `threshold/mcp/src/world.ts`: the tool call path that produces results. It exists today.
- Tests under `threshold/mcp/test/` for the new path, and a live lane case only if the owner approves one.
- No schema change. No migration. No `contract/` change.

## Rules

1. **Helpers only.** Content goes through `@geldar/telemetry` (`telemetry/src/content.ts`, `telemetry/src/cap-text.ts`): `capText` (32 KiB cap, applied before export) and `addContentEvent`. Content is written as a span event or a log record. Never as a metric label, never as a metric value.
2. **Cap applied.** Every argument and result passes `capText` before it leaves the process. Truncation is marked in the record.
3. **Operator-only access.** Readers are the operator, through SigNoz on an SSH tunnel or through the read-only operator ClickHouse user. No agent, Mind, Body or kit can query SigNoz or ClickHouse. No public route serves these views (0350 point 6; no Caddy route for the UI).
4. **Nothing flows back to any agent.** No trace id, no span id, no telemetry text and no telemetry word appears in any tool result, prompt, skill, error, memory or file an agent reads (0350 point 7). The marker scan in `contract/src/agent-text.ts` (T-19) must cover this path.
5. **Off unless the endpoint is set.** With the telemetry endpoint unset, the code path does nothing: no capture, no queue, no export.
6. **Exporters stay asynchronous, bounded and dropping.** A slow or failing export must not change tool latency or results (0350 point 7: export latency is not a side channel).
7. **Erasure.** Outside players' content is captured and erased on request (0350 point 3). This card does not close that known gap. The erasure procedure in `open-signup.md` must exist before any outside player's agent runs.

## Tests (must fail without the change)

Each test must fail on the code before this card. Revert-check: remove the capture line and confirm the named test fails for the stated reason.

- **(a) Content as a span event with the cap applied.** A tool call whose result is larger than 32 KiB produces a span event whose content is the capped text, with the truncation marker. A result under the cap is carried whole.
- **(b) Byte-identical result, telemetry on and off.** The tool result returned to the agent is byte-identical whether the telemetry endpoint is set or unset. Compare the two serialized responses byte for byte.
- **(c) No trace id in agent-visible output.** With telemetry on, no trace id or span id appears in the tool result, the error text or the MCP response metadata.

Each test also needs the abort, close and error-path cases: a failing exporter, a closed queue and a timed-out export must each leave the tool result unchanged.

## Delivery

- PR only. Held unmerged until the owner approves this card and geldar-93 gives the go.
- No merge to main until the owner approves the PR.
- No live run from this card. A live case runs only when the orchestrator says so.
