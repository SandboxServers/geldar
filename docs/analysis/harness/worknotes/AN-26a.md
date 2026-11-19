# AN-26a worknote: pickup provenance in the plugin

Status: listener and tests green (11 of 11 after AN-26a review fix 1). `:core:verifyJarContents` passes.

## Review fix 1 (AN-26a review 1)

- `publish` returns at once when `count < 1`, before the per-tick cap, so a zero-count call neither sends nor uses a cap slot. Test: `aPickupOfZeroItemsSendsNothing`.
- Test `throwerInAnotherWorldSendsDistanceNull`: the thrower is online in another world at the same x/z; the thrower name is sent and distance is null.
- Test `aNonPlayerPickupSendsNothing`: a `LivingEntity` stub (not a Player) through `onPickup` sends nothing. The event constructor accepts a `LivingEntity` stub, so no workaround was needed.
- Note: with the pattern guard in `onPickup` removed as a single line, Java does not compile (the pattern variable `picker` would be out of scope). The revert-check therefore replaces the three-line guard with `Player picker = (Player) e.getEntity();`.

## Design change (orchestrator ruling)

`ItemStack` cannot be built outside a server, so no unit test constructs or touches one. `onPickup` keeps the early returns that need no ItemStack (sink null, flag off, entity not a Player, thrower null, thrower equals picker). Only after those does it read the stack (type key without namespace, `getAmount() - getRemaining()`) and call the package-private `publish(world, picker, pickerAt, throwerId, itemKey, count, ageTicks, now)`. `publish` applies the per-tick cap, resolves the thrower, computes the distance and calls `sink.send("pickup", ...)`. `pickerAt` is a `Location` added to the signature so that `publish` can compute the distance without an ItemStack.

## Test coverage

- Through `onPickup` (Item proxy without `getItemStack`, so reaching it throws): thrower equals picker, no thrower, flag off or null sink.
- Through `publish`: right fields and distance, thrower offline (null name and null distance), partial pickup count (count passed directly), 65th pickup dropped and counted, `pickupJson` nine keys.
- Not unit-tested: the `onPickup` lines that read the ItemStack (`getItemStack`, the type key, the amount minus remaining). The evidence for them is the ops real-payload capture below.

## Revert-checks (one line mutated each time, restored from backup)

The original three checks were first recorded against commit c27166a8, a hash from before the amend. The reviewed head is 50978ff8, and the review re-ran the three checks on that head (AN-26a-review-1 report). The listener code at 50978ff8 is the base for fix 1, so these results hold for it.

Fix 1 checks, run on the fix-1 head (commit after 50978ff8):

4. Zero-count guard (`if (count < 1) {` replaced by `if (false) {`): `aPickupOfZeroItemsSendsNothing` fails at its `tails.isEmpty()` assertion (line 157).
5. Same-world check (`throwerPlayer != null && ...getWorld()...equals(world)` replaced by `throwerPlayer != null`): `throwerInAnotherWorldSendsDistanceNull` fails at its `distance` assertion (line 174).
6. Non-Player guard (three lines replaced by `Player picker = (Player) e.getEntity();`): `aNonPlayerPickupSendsNothing` fails with `ClassCastException` (line 182).

1. Drop the thrower-equals-picker check (`thrower.equals(...)` replaced by `false`): `pickedUpByTheThrowerSendsNothing` fails. It fails with `UnsupportedOperationException: getItemStack`, because the early return is not taken and the proxy refuses the stack read. The failure shows the early return was skipped, not an assertion about the send.
2. Send for a null thrower (`thrower == null || ...` replaced by `thrower != null && ...`): `noThrowerDeathOrMobDropSendsNothing` fails with `UnsupportedOperationException: getItemStack`, for the same reason as check 1.
3. Remove the per-tick cap (`if (sentThisTick >= PER_TICK_CAP)` replaced by `if (false)`): `the65thPickupInOneTickIsDroppedAndCounted` fails with `expected: <64> but was: <65>`.

## Ops evidence (pending, not run in this packet)

One real two-player toss on the scratch shard with `provenance.enabled` set by hand, after merge to the wave branch. The captured `pickup` JSON goes here before AN-26b writes its fixtures. This capture is the evidence for the ItemStack-reading lines of `onPickup`.
