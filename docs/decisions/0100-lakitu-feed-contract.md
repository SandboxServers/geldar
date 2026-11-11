# 0100: Lakitu feed contract

Status: Proposed (orchestrator, 2026-11-11; owner to confirm)

## Context

Decision 0075 makes the Glass a Lakitu camera: free-fly, collision-bound, invisible in the world, targeted by login. Decision 0077 (Accepted by the owner on 2026-11-11, option A) says anonymous visitors get no camera; a camera needs an owner or admin login. Wave C2b needs one shared contract for the feed, the pane, the session, the target, the audit event and the per-session cap before any fan-out card starts. Cards 01 (Java feed) and 02 (relay) read the generated types and may not change the schema.

## Decision

1. **One-way feed.** The feed has no input path into the shard: no command, chat line, input packet or write. The Java side registers `MONITOR`-priority listeners only (0075 point 2; 0072).
2. **Invisible by construction.** The feed reads only chunks that are already loaded. It creates no entity, tab-list entry, message, scoreboard, team, bossbar or particle (0075 point 1).
3. **No names or tokens in the feed.** The feed carries block state names, never textures, player names, tokens or addresses. The session id is an opaque ULID, never a token.
4. **Positions only in the login-scoped feed.** Agent positions never appear in the public thought stream (0072, 0075).
5. **Pane cap.** `max_panes_per_session` is 4. The Java plugin enforces it and the relay refuses earlier with the same rule (0075 point 5). The page only mirrors it. Owner to confirm (0075 point 5 is still open).
6. **Frame caps (proposed, owner to confirm).** `max_sections_per_frame` 256 and `max_updates_per_frame` 512. A frame over either cap is refused, never truncated silently.
7. **Audit.** Each pane open, target change, mode change and close is recorded with a SHA-256 hash of the login id, never a login name, token, secret, address or account name (0075 point 6). No Glass role writes audit rows.
8. **Error shapes.** `pane_cap_reached`, `target_not_permitted`, `feed_unavailable`, `feed_overloaded`.
9. **Schema version.** The feed is version 1 (`feed_version` const 1). The schemas are `contract/schemas/lakitu-feed.schema.json` and `contract/schemas/lakitu-audit.schema.json`. Their `description` fields carry the same statements as this record.

## Consequences

- Card P1-C2b-01 (Java) and P1-C2b-02 (relay) implement these limits. They must read the generated types and must not change the schema.
- Feature flag `lakitu.enabled` stays false until the owner confirms 0075 point 5 and 0077 (invariant I8).
- Agent-visible text rules (0059, 0068) still apply. No Lakitu term reaches a prompt or observation.

## Open for the owner

- Confirm `max_panes_per_session` 4.
- Confirm `max_sections_per_frame` 256 and `max_updates_per_frame` 512, both proposed by the orchestrator.
