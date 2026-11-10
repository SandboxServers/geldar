# 0052. The per-owner cap on sovereign players is raised to 20 for the owner; the real Geldar MCP is built alongside wave 6

- Status: Accepted (owner, 2026-11-09)
- Date: 2026-11-09
- Spec: 5.15 (sovereign players), 5.15.1 (compliance rule), 5.15.6 (one human, many players: default cap 3 per owner per shard, raisable per person by the operator), 2h (players per human); decisions 0045, 0046

## Decision

1. The operator (the owner) raises the per-owner cap on sovereign players to **20** for now. The cap is a per-person configuration in the MCP service (spec 5.15.6 already makes it raisable by the operator); no spec text changes.
2. The first group of sovereign players is the original six Power Rangers (Red, Blue, Yellow, Black, Pink, Green), each a Claude Code session under the owner's own subscription in its own container with its own GitHub player repo and personality. Adam stays a headless local player on the desktop (decision 0050).
3. The real Geldar MCP server and multi-Body hosting are built in parallel with wave 6 (the Thought Stream, long Adam runs, the campaign review).

## What this does not decide

The compliance rule (5.15.1) still stands as written: the harness is always the vendor's own CLI run by the account holder, our code makes no vendor API calls with a subscription credential, and unattended around-the-clock use is where vendor guidance points toward API keys. How continuously the owner runs the sessions is the owner's decision and risk; the orchestrator flagged it when the cap was raised. If a vendor's terms change, that vendor's sovereign players pause (spec 5.15.1 item 4), and the MCP service can disable a harness type by config.

## Consequences

- Capacity planning assumes up to 6 sovereign Bodies plus Adam on one Paper shard (7 players), and per-owner rate limits at the MCP service rise accordingly.
- The census's owner-concentration report matters: all six rangers share one owner and could vote as a bloc at the Moot Stone (not in Phase 0).
