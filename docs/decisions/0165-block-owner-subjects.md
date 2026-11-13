# 0165: Block ownership subjects

- Status: Accepted
- Date: 2026-11-13
- Spec: no spec section; a gap the spec leaves in the Body's digging rules (the owner ruling of 2026-11-13: the Body's goto may dig world-generated blocks and the ranger's own placements, never a block another player placed).

## Context

Minecraft keeps no owner for a block. The Body's goto must not dig a block another player placed, so something has to record who placed each block. The record is answered by the plugin (geldar-core) from CoreProtect's action log, a soft dependency; see the Decision. The Body reads it over NATS, lazily per chunk, and caches what it reads; a change event keeps the cache honest between reads.

## Decision

- The record is answered from CoreProtect (API 12, a soft dependency of geldar-core), not from a chunk PersistentDataContainer store. CoreProtect's log gives, per position, the newest place or break; the plugin resolves the owner from it and never writes its own per-chunk store. A node without CoreProtect answers every query with `truncated: true` and no blocks, which the Body reads as unknown. Operations are in `docs/runbooks/block-owner.md`.
- `geldar.<shard>.blockowner.query` is a NATS request/reply subject. The plugin subscribes and replies with a `BlockOwnerReply` for one chunk: the owned blocks (at most 4096) and `truncated`.
- `geldar.<shard>.blockowner.changed` is published by the plugin when one block's owner changes. `owner` is null when the ownership is cleared.
- Both subjects have four tokens, so they are outside the sink's `geldar.*.*` filter, like the Body and Kino subjects.
- Permissions: `paper` subscribes to the query and publishes the changed subject (its replies go to the inbox); it is denied publishing the query. `body` publishes the query and subscribes to changed, and is denied publishing changed, so a Body cannot forge an owner. `kino`, `mind`, `mcp`, `eventsink`, `velocity` and `deploy` have no access to either subject.
- The schema is `contract/schemas/block-owner.schema.json`. A block with no record is not in any reply, and the Body treats it as world-generated.

## Consequences

- The Java half (the CoreProtect bridge and its reply) and the Body's cache are separate packets. Until the plugin answers, a query gets no reply, and the Body must treat that as unknown, not as unowned.
- The Body's cache is live (`golem/src/body/block-owners.ts`, 2026-11-13): it reads on the Body's own NATS connection, subscribes to `changed`, and treats a missing, failed or truncated answer as unknown (protected by goto, decision 0164). Its query names the Body's world by the bot's dimension; the plugin's world name must match it (checked live).
- Ownership is only as complete as CoreProtect's log: blocks placed before CoreProtect was installed are unknown and read as world-generated (runbook, pre-tracking gap).
- CoreProtect is a third-party jar fetched at deploy, not bundled. Its lookups are off the server thread and the Body treats any failed answer as unknown.
- The records are facts about placement only. No agent-facing text is involved.
