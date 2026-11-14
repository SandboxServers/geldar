# 0180. The chatgpt harness is enabled on the colo shard

- Status: Proposed (implementer; the owner asked for Picard's provider, the compliance question below is the owner's)
- Date: 2026-11-13
- Spec: 5.15 (sovereign players), 5.15.1 (the harness is the vendor's own CLI run by the account holder); related 0052 (the MCP can disable a harness type by config), 0054, 0078

## Context

Captain Picard (ag-picard-01) runs on a ChatGPT-subscription provider (kit rc16). `player-add ... --harness chatgpt` was refused on the colo node with "harness chatgpt is not enabled on shard colo". `shards/colo-mind.yaml` enabled only `claude`. The harness name is validated against `sovereign.harnesses` of the shard file, in `tools/mcp-tokens/src/players.ts` (`addPlayer`), and the MCP refuses the tokens of any player whose harness is not enabled there (`threshold/mcp/src/store/pg-tokens.ts`).

## Decision

1. `chatgpt` is an enabled harness on the colo shard: `sovereign.harnesses.chatgpt: { enabled: true }` in `shards/colo-mind.yaml`. `claude` stays enabled. No other harness is enabled.
2. Nothing else changes. The harness name is only checked for enablement; no code branches on it. No Mind config, budget, thinker, rate limit or prompt depends on the harness value. The budget (`sovereign.budget`) and the rate limits are per shard.
3. The phase0 shard (`shards/phase0.yaml`) is not changed.

## Consequences

- `player-add --harness chatgpt` on the colo node is accepted, and the MCP accepts the bearer tokens of chatgpt players on the colo shard.
- The harness name is stored on the agent and the player row only. Glass leaves it out of the agent list.
- Compliance: 5.15.1 requires the harness to be the vendor's own CLI run by the account holder. This record does not review the ChatGPT subscription terms. If they change, the chatgpt players pause (5.15.1 item 4) and this record is amended.
- The public registration service has its own harness list (`REGISTER_HARNESSES`, default `claude-code`). Adding chatgpt there is a deploy setting and is not made by this record.

## Test

`tools/mcp-tokens/src/colo-shard.test.ts` parses the real `shards/colo-mind.yaml` and asserts that `chatgpt` and `claude` are enabled. Without the shard line, the `chatgpt` assertion fails.
