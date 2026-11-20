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

## Review 1 fixes

- One pending click per (actor, world, x, y, z) per tick. A second click by the same actor on the same block before the next tick adds nothing; the first click's counts and prior owner stand. A removal is counted once per actor.
- A click is a take source only for a player clicking a located storage holder: `Container` or `DoubleChest`. Other block menus (crafting table, anvil, enchanting table, the player's own 2x2 view) are not takes. Furnace and brewing stand are `Container`s and still pass; whether their output slot should count is open.
- `count` is clamped to 2304 (the schema maximum) in `send`.
- The next tick checks `enabled` again: a listener switched off between the click and the tick sends nothing. Click time does not decide; settle time does.
- `PriorOwner.of` and `BlockChangeListener.priorOwner` are two copies of one lookup; the only intended difference is the life-id filter (documented in `PriorOwner`).

## Known limits

- Double chest: `getLocation()` of a double-chest inventory is the midpoint of the two halves, so `prior_owner` is read for one half only. That half may belong to another owner.
- Two viewers, or a hopper, removing from the same chest in one tick: each click's snapshot differs, so a removal can be attributed to a clicker who did not make it, and a removal seen by two clicking players in one tick is reported once per clicker.
- Drag: `InventoryDragEvent` is not listened to. Drag over the top inventory only places items.
- Shift-click, number-key swap, double-click collect and drop-key removals are expected to be covered by the snapshot diff; unverified until the capture. No test exercises them: the tests call the seam with a hand-built before and after.
- Storage minecarts and other non-block holders are not takes: their holder is not a `Container` or `DoubleChest`, so they are excluded even when they report a location.

## Pending (ops evidence, not run)

- Real-payload capture: a `take` message from a live shard has not been captured. Record the first real reply here when the ops run happens. Nothing was run against a shard for AN-51a.
- Real capture of which holders report a location and a storage type: chest, double chest, crafting table, furnace, anvil. Not yet captured. Until it is, the holder rule is by type only, unverified against a server.
- The `onClick` argument wiring (the player check, the location check, the holder check, and the `sink`/`enabled` guard at the top of `onClick`) is not run by any unit test: a test would need a real `InventoryClickEvent`, which needs a server. It is covered only by the live capture above.
- Index line for AN-50a: not written in this packet (not in the may-edit list).
