# AN-26a worknote: pickup provenance in the plugin

Status: listener and tests green (8 of 8). `:core:verifyJarContents` and `build` pass.

## Design change (orchestrator ruling)

`ItemStack` cannot be built outside a server, so no unit test constructs or touches one. `onPickup` keeps the early returns that need no ItemStack (sink null, flag off, entity not a Player, thrower null, thrower equals picker). Only after those does it read the stack (type key without namespace, `getAmount() - getRemaining()`) and call the package-private `publish(world, picker, pickerAt, throwerId, itemKey, count, ageTicks, now)`. `publish` applies the per-tick cap, resolves the thrower, computes the distance and calls `sink.send("pickup", ...)`. `pickerAt` is a `Location` added to the signature so that `publish` can compute the distance without an ItemStack.

## Test coverage

- Through `onPickup` (Item proxy without `getItemStack`, so reaching it throws): thrower equals picker, no thrower, flag off or null sink.
- Through `publish`: right fields and distance, thrower offline (null name and null distance), partial pickup count (count passed directly), 65th pickup dropped and counted, `pickupJson` nine keys.
- Not unit-tested: the `onPickup` lines that read the ItemStack (`getItemStack`, the type key, the amount minus remaining). The evidence for them is the ops real-payload capture below.

## Revert-checks (run on commit c27166a8, one line mutated each time, restored from backup)

1. Drop the thrower-equals-picker check (`thrower.equals(...)` replaced by `false`): `pickedUpByTheThrowerSendsNothing` fails. It fails with `UnsupportedOperationException: getItemStack`, because the early return is not taken and the proxy refuses the stack read. The failure shows the early return was skipped, not an assertion about the send.
2. Send for a null thrower (`thrower == null || ...` replaced by `thrower != null && ...`): `noThrowerDeathOrMobDropSendsNothing` fails with `UnsupportedOperationException: getItemStack`, for the same reason as check 1.
3. Remove the per-tick cap (`if (sentThisTick >= PER_TICK_CAP)` replaced by `if (false)`): `the65thPickupInOneTickIsDroppedAndCounted` fails with `expected: <64> but was: <65>`.

## Ops evidence (pending, not run in this packet)

One real two-player toss on the scratch shard with `provenance.enabled` set by hand, after merge to the wave branch. The captured `pickup` JSON goes here before AN-26b writes its fixtures. This capture is the evidence for the ItemStack-reading lines of `onPickup`.
