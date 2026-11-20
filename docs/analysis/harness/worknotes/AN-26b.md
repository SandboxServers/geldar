# AN-26b: recipient-side gift observation

Paper-only; do not enable on NeoForge until the human-handling question is decided.

Inert: nothing wires `observeGift` yet; wiring is AN-28b.

Code: `golem/src/perception/provenance/gift.ts` and `gift.test.ts`. Fixture: `golem/src/perception/provenance/fixtures/pickup-real.json`.

The fixture is the real capture of 2026-11-20 at commit 73788889 (shard phase0, case toss), copied byte for byte from the JSON line in `worknotes/AN-26a.md` ("Ops evidence"). The worknote's JSON was not edited.

Index: AN-28b (Body subscription and leakage gate) takes `observeGift` from this card; it depends on AN-25, AN-26b, AN-27b and AN-28a.

## Key format and schema

The card key `gift:<tick>:<thrower or none>:<item>:<count>:<ordinal>`, lower-cased, satisfies `observation-event.schema.json` (`^[a-z0-9:_-]{8,96}$`) for every name and item the bounds allow. A key longer than 96 characters (a 16-character thrower, a 64-character item, a ten-digit tick) is refused by `validateObservationPayload`, and the gift is then null. No schema change; no contract change.

## Revert-checks (run on the committed code, one line each)

1. Remove the age bound (`msg.age_ticks <= MAX_AGE_TICKS` replaced by `true`). Output: `× an old drop (age over 100) is not a gift`, `AssertionError: expected { kind: 'gift_received', …(4) } to be null`. Tests: 12 run, 1 failed, 11 passed.
2. Name the thrower without `resolve` (`ctx.resolve(...)` replaced by `{ name: msg.thrower, life: msg.thrower }`). Output: `× an invisible giver gives an unattributed gift` (`expected … to not have property "actor"`), and `× a resolver that throws gives nothing`. Tests: 12 run, 2 failed.
3. Skip the picker check (`msg.picker !== ctx.selfName` replaced by `false`). Output: `× a third party's pickup gives nothing`, and `× the captured real payload validates with validateProvenance and maps` (the other-self assertion). Tests: 12 run, 2 failed.
4. Own mutation: the raw thrower name in the key when the thrower is hidden (`actor?.name ?? 'none'` replaced by `actor?.name ?? msg.thrower ?? 'none'`). Output: `× an invisible giver gives an unattributed gift`, `AssertionError: expected 'gift:1178:ag_capa_01:cobblestone:4:0' to be 'gift:1178:none:cobblestone:4:0'`. Tests: 12 run, 1 failed.

Each mutation was restored from a scratchpad backup, and `git diff --stat` was empty after each restore.

## Finding: the ordinal and the redelivery rule cannot both hold

The card asks for `the same message twice gives one observation` and `two equal tosses in one tick get ordinals 0 and 1`, with the ordinal counting same-`(tick, thrower, item)` messages. The `observeGift(msg, ctx)` signature has no message id, so two identical tosses and a redelivery of one toss are the same input. The ordinal design passes the two-toss test and gives a second observation for a redelivered message. The `seen` check therefore never fires for ordinal keys. The redelivery test was removed from the committed file and is open for a decision (a message id from the plugin, or dropping the ordinal). Revert-check 3 of the card (dropping the `seen` check) has no failing test under this design, and was not run.

## Other decisions

- A resolver that throws gives null (the whole gift is refused), not an unattributed gift.
- Hostile names: the thrower and picker must match the Minecraft username pattern; a thrower equal to the picker (any letter case) is the Body's own toss and gives null.
- `seen` is kept at 256 by the function as well as by the caller.
- The message type is `Extract<Provenance, { kind: 'pickup' }>` (the card's `Provenance & { kind: 'pickup' }` includes the kind-less take member, which has no `picker` field).
