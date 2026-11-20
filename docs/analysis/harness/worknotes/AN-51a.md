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
- A click is a take source only for a player clicking a located storage holder: `Container` or `DoubleChest`. Other block menus (crafting table, anvil, enchanting table, the player's own 2x2 view) are not takes. Furnace and brewing stand are `Container`s and still pass. Operator ruling (2026-11-19, relayed by the orchestrator): DECIDED, keep furnaces and brewing stands as containers; taking a smelted or brewed item counts as taking from an owner's container, so a furnace and a brewing stand SEND a take. No fix card.
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
  Procedure: [capture-real-payloads](../../../runbooks/capture-real-payloads.md).
- Real capture of which holders report a location and a storage type: chest, double chest, crafting table, furnace, anvil. Not yet captured. Until it is, the holder rule is by type only, unverified against a server.
- The `onClick` argument wiring (the player check, the location check, the holder check, and the `sink`/`enabled` guard at the top of `onClick`) is not run by any unit test: a test would need a real `InventoryClickEvent`, which needs a server. It is covered only by the live capture above.
- Index line for AN-50a: not written in this packet (not in the may-edit list).

Captured 2026-11-20 at 73788889 (shard phase0). Take cases that sent a message:

single chest, withdraw:

Captured 2026-11-20 at 73788889, shard phase0, case chest-single, subject geldar.phase0.provenance.take, validator: ok

```json
{"world":"world","x":1314,"y":200,"z":800,"actor":"ag_capa_01","prior_owner":null,"item":"cobblestone","count":8,"tick":3982}
```

double chest (window generic_9x6 with 90 slots: 54 + 36):

Captured 2026-11-20 at 73788889, shard phase0, case chest-double, subject geldar.phase0.provenance.take, validator: ok

```json
{"world":"world","x":1314,"y":200,"z":800,"actor":"ag_capa_01","prior_owner":null,"item":"cobblestone","count":8,"tick":4513}
```

shift-click (mode 1) out of a chest:

Captured 2026-11-20 at 73788889, shard phase0, case chest-shift-click, subject geldar.phase0.provenance.take, validator: ok

```json
{"world":"world","x":1314,"y":200,"z":800,"actor":"ag_capa_01","prior_owner":null,"item":"cobblestone","count":8,"tick":5055}
```

number-key swap (mode 2) out of a chest:

Captured 2026-11-20 at 73788889, shard phase0, case chest-number-key, subject geldar.phase0.provenance.take, validator: ok

```json
{"world":"world","x":1314,"y":200,"z":800,"actor":"ag_capa_01","prior_owner":null,"item":"cobblestone","count":8,"tick":5562}
```

furnace output (SENDS):

Captured 2026-11-20 at 73788889, shard phase0, case furnace, subject geldar.phase0.provenance.take, validator: ok

```json
{"world":"world","x":1314,"y":200,"z":800,"actor":"ag_capa_01","prior_owner":null,"item":"iron_ingot","count":1,"tick":6065}
```

brewing stand output (SENDS):

Captured 2026-11-20 at 73788889, shard phase0, case brewing-stand, subject geldar.phase0.provenance.take, validator: ok

```json
{"world":"world","x":1314,"y":200,"z":800,"actor":"ag_capa_01","prior_owner":null,"item":"potion","count":1,"tick":6606}
```

Send-nothing cases (no file written, validator `take=0` pass): crafting-table (window minecraft:crafting, 46 slots), enchanting-table (window minecraft:enchantment, 38 slots), player-2x2 (own inventory, 46 slots).

anvil: NOT CAPTURED. The case failed INVALID before any take, twice (the first run and one `--clean` rerun, same message): `anvil: Error: anvil: no stick named "capture" in the inventory after the rename (INVALID)`. The `anvil` folder is empty, so its `take=0` validator row is vacuous. Script defect, reported, not fixed.

Holder table (what each capture shows; storage type is not in the payload, the window kind is what the script read):

| holder | location in message | storage type in message | sent a take | window seen by the script |
|---|---|---|---|---|
| chest, single | yes (1314,200,800) | no | yes, cobblestone x8 | generic_9x6 |
| chest, double | yes (1314,200,800) | no | yes, cobblestone x8 | generic_9x6, 90 slots |
| chest, shift-click | yes (1314,200,800) | no | yes, cobblestone x8 | generic_9x6 |
| chest, number-key | yes (1314,200,800) | no | yes, cobblestone x8 | generic_9x6 |
| furnace | yes (1314,200,800) | no | yes, iron_ingot x1 | not logged |
| brewing stand | yes (1314,200,800) | no | yes, potion x1 | not logged |
| crafting table | no message | - | no | minecraft:crafting, 46 slots |
| anvil | not captured (INVALID) | - | not run | minecraft:anvil, 39 slots |
| enchanting table | no message | - | no | minecraft:enchantment, 38 slots |
| player 2x2 | no message | - | no | own inventory, 46 slots |

## Ops re-run on aae77403 (anvil and enchanting table, 2026-11-20)

Run on origin/main aae77403 (the merge of PR #824, tree equal to its tip 80a8dae3), shard phase0, one case at a time, the
provenance flag set on the container copy and restored at teardown (`grep -c "^provenance:"` prints 0 after the restore).
Positive control first, then the two send-nothing cases. The script prints the validator table per case.

Captured 2026-11-20 at aae77403, shard phase0, case chest-single, subject geldar.phase0.provenance.take, validator: ok
```json
{"world":"world","x":1314,"y":200,"z":800,"actor":"ag_capa_01","prior_owner":null,"item":"cobblestone","count":8,"tick":8991}
```

- anvil: window `minecraft:anvil`, 39 slots. The stick in slot 30 (customName null) was renamed `capture`; the script then
  found the renamed stick in the inventory. The script logs no line for the output take. Result: 0 files, validator
  `take=0` pass. Case line: `case anvil: no message in 20 s (400-tick settle, 20 TPS), subscriber active since not recorded by the script`.
  This replaces the earlier INVALID result above as the current run; the earlier text is left as written.
- enchanting-table: window `minecraft:enchantment`, 38 slots. Offered levels logged as `[-1,-1,-1]` (the script says only
  option 0 is applied and the other costs are not captured). Option 0 applied; output slot 0 held 1 `stone_sword`, picked up.
  Result: 0 files, validator `take=0` pass. Case line: `case enchanting-table: no message in 20 s (400-tick settle, 20 TPS), subscriber active since not recorded by the script`.
- Validator note: for `take=0` it prints `expected at least 0, found 0`; the runbook sheet says `take=0 (exact)`. The check
  passed here, but the printed wording does not say exact.
