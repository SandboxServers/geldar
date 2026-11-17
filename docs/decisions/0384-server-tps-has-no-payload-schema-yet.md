# 0384. `server_tps` has no payload schema yet; the NeoForge mod emits the Paper shape meanwhile

- Status: Proposed (lead-accepted 2026-11-17; owner to confirm)
- Date: 2026-11-17
- Spec: section 7 (event bus, contract); Appendix F (event export)

## Decision

1. No payload schema for `server_tps` is written now. Whether one is written, and its shape, is an owner decision. This record does not invent one.
2. Until the owner decides, the NeoForge mod emits the same payload shape the Paper plugin sends today: `tps` (double, the one-minute window), `players` (int), `dropped` (the publisher's drop count) and `connected` (bool), every 20 seconds.
3. Today the schema only names the type: `contract/schemas/event.schema.json` line 5 names `server_tps`; there is no separate payload schema file for it under `contract/schemas/`.

## Why

The owner has not decided what the payload should be. The Paper plugin's shape is the one the sink and the readers already receive, so the NeoForge mod matches it rather than inventing a second one. The source for the shape is `plugin/core/src/main/java/dev/geldar/core/EventExporter.java` lines 60 to 66 (`exportTps`).

## Consequences

- The NeoForge emitter must be checked against the Paper shape (UNVERIFIED: the NeoForge emitter was not read for this record).
- Readers must not depend on fields beyond the four above until the owner's schema exists.
- The owner's schema decision will change `contract/`; it is a separate packet, not part of this record.
