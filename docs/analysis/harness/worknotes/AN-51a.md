# AN-51a: container-taking facts in the plugin

Paper-only; do not enable on NeoForge until the human-handling question is decided. AN-51a/b is dropped on NeoForge.

Inert: `ContainerTakeListener` is not registered. Nothing is registered in `GeldarCore` or `BlockOwnerSetup`; registration is AN-50a. The listener is disabled by default through the `enabled` supplier.

## What landed

- `plugin/core-common/.../provenance/TakeDiff.java`: Bukkit-free. `taken(before, after)` returns the positive decrease per item, sorted keys. Increases and unchanged counts are not takes.
- `plugin/core-common/.../provenance/PriorOwner.java`: created here (it was not on main). `of(cache, pos)` reads the owner from `OwnerCache` only: null on a cache miss, on an unowned block, or when the owner is not a life id. No CoreProtect call.
- `plugin/core-common/.../provenance/ProvenanceJson.java`: `takeJson(...)` adds the `TakeProvenance` body (keys world, x, y, z, actor, prior_owner, item, count, tick). The schema already has `TakeProvenance` (AN-46), so no contract change.
- `plugin/core/.../blockowner/ContainerTakeListener.java`: MONITOR, `ignoreCancelled = true`. A click on a block-backed container reads the prior owner at click time and the counts before the click. The next tick (injected `Consumer<Runnable>`) reads the counts again and sends one `take` per item whose count went down. At most 64 sends per tick; the rest are dropped and counted. `InventoryDragEvent` is not listened to.
- Tests: `TakeDiffTest`, `PriorOwnerTest`, `ContainerTakeListenerTest` (includes a schema check of the emitted payload against `provenance.schema.json`).
- `plugin/core/src/test/resources/jar-contents.golden`: three class lines added.

## Pending (ops evidence, not run)

- Real-payload capture: a `take` message from a live shard has not been captured. Record the first real reply here when the ops run happens. Nothing was run against a shard for AN-51a.
- Index line for AN-50a: not written in this packet (not in the may-edit list).
