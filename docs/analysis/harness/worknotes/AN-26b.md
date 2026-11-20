# AN-26b: recipient-side gift observation

Paper-only; do not enable on NeoForge until the human-handling question is decided.

Inert: nothing wires `observeGift` yet; wiring is AN-28b.

Code: `golem/src/perception/provenance/gift.ts` and `gift.test.ts`. Fixture: `golem/src/perception/provenance/fixtures/pickup-real.json`.

The fixture is the real capture of 2026-11-20 at commit 73788889 (shard phase0, case toss), copied field for field from the JSON line in `worknotes/AN-26a.md` ("Ops evidence"). The fixture file is that JSON re-flowed by biome format (the repo lint requires it; one line became several): the field names, values and their order are unchanged, and the original one-line bytes stay in the AN-26a worknote, which was not edited. "Verbatim" here means field for field.

Index: AN-28b (Body subscription and leakage gate) takes `observeGift` from this card; it depends on AN-25, AN-26b, AN-27b and AN-28a. AN-28b must not resubscribe to provenance pickups with a replay policy: a duplicated delivery counts as a second toss (see the decision below).

## Key format and schema

The card key `gift:<tick>:<thrower or none>:<item>:<count>:<ordinal>`, lower-cased, satisfies `observation-event.schema.json` (`^[a-z0-9:_-]{8,96}$`) for every name and item the bounds allow. A key longer than 96 characters (a 16-character thrower, a 64-character item, a ten-digit tick) is refused by `validateObservationPayload`, and the gift is then null. No schema change; no contract change.

## Revert-checks (run on the committed code, one line each)

Checks 1, 2, 4 and 5 were first run against the 12-test file. Checks 3, 6 and 7 were run in the fix pass against the 17-test file. Each mutation was restored from a scratchpad backup, and `git diff --stat` was empty after each restore.

1. Remove the age bound (`msg.age_ticks <= MAX_AGE_TICKS` replaced by `true`). Output: `× an old drop (age over 100) is not a gift`, `AssertionError: expected { kind: 'gift_received', …(4) } to be null`. Tests: 12 run, 1 failed, 11 passed.
2. Name the thrower without `resolve` (`ctx.resolve(...)` replaced by `{ name: msg.thrower, life: msg.thrower }`). Output: `× an invisible giver gives an unattributed gift` (`expected … to not have property "actor"`), and `× a resolver that throws gives nothing`. Tests: 12 run, 2 failed.
3. Card revert-check 3: drop the `seen` check (`if (ctx.seen.has(key)) return null;` removed). Output: `× a key already in seen gives nothing`, `AssertionError: expected { kind: 'gift_received', …(4) } to be null`. Tests: 17 run, 1 failed. This replaces the card's `the same message twice gives one observation` test (see the decision below).
4. Skip the picker check (`msg.picker !== ctx.selfName` replaced by `false`). Output: `× a third party's pickup gives nothing`, and `× the captured real payload validates with validateProvenance and maps` (the other-self assertion). Tests: 12 run, 2 failed.
5. Own mutation: the raw thrower name in the key when the thrower is hidden (`actor?.name ?? 'none'` replaced by `actor?.name ?? msg.thrower ?? 'none'`). Output: `× an invisible giver gives an unattributed gift`, `AssertionError: expected 'gift:1178:ag_capa_01:cobblestone:4:0' to be 'gift:1178:none:cobblestone:4:0'`. Tests: 12 run, 1 failed.
6. Own mutation (fix pass): the distance cut-off applied to hidden or offline throwers (`if (actor !== null && (msg.distance === null || …))` replaced by `if ((msg.distance === null || …))`). Output: `× a hidden or offline thrower gives an unattributed gift whatever the distance`, `AssertionError: {"thrower":null,"distance":null}: expected null not to be null`. Tests: 17 run, 1 failed.
7. Own mutation (fix pass): `.toLowerCase()` removed from the prefix and the key. Output: `× a mixed-case giver gives a lower-case key`, `AssertionError: expected null to deeply equal { kind: 'gift_received', …(4) }`. The null is the contract refusing the upper-case key `gift:1178:Steve_One:…`; every visible mixed-case giver would give null without the fold. Tests: 17 run, 1 failed.

## Decision: the ordinal stays; redelivery is not a case

The card asks for `the same message twice gives one observation` and `two equal tosses in one tick get ordinals 0 and 1`, with the ordinal counting same-`(tick, thrower, item)` messages. The `observeGift(msg, ctx)` signature has no message id, so two identical tosses and a redelivery of one toss are the same input. The ordinal design cannot tell them apart, so the `seen` check never fires for a redelivered message.

The ruling (orchestrator, review 1 judged it sound): the redelivery case does not arise, because provenance is published on core NATS. `NatsBlockOwnerLink.publish` calls `nc.publish(subject, bytes)`, on `provenancePickupSubject`, which is `geldar.<shard>.provenance.pickup` (`contract/src/subjects.ts`). No JetStream stream carries provenance subjects. Core NATS does not redeliver, so the ordinal stays and the card's `the same message twice` test is replaced by these two tests:

- `a replay into a fresh seen gives the same keys`: the same sequence into two fresh sets gives identical keys (`:4:0`, `:4:1`, `:5:2`).
- `a replay into the same seen continues the ordinals`: the same sequence into one set gives continuing ordinals (`:4:3`, `:4:4`, `:5:5`), none null.

The card's revert-check 3 (drop the `seen` check) now maps to `a key already in seen gives nothing`, which fails with the line removed.

Residual: a duplicated delivery of the identical message counts as a second toss. This is accepted because core NATS does not redeliver. AN-28b must not resubscribe to provenance pickups with a replay policy, which would count tosses twice.

## Other decisions

- A resolver that throws gives null (the whole gift is refused), not an unattributed gift.
- Hostile names: the thrower and picker must match the Minecraft username pattern; a thrower equal to the picker (any letter case) is the Body's own toss and gives null.
- `seen` is kept at 256 by the function as well as by the caller.
- The message type is `Extract<Provenance, { kind: 'pickup' }>` (the card's `Provenance & { kind: 'pickup' }` includes the kind-less take member, which has no `picker` field).
- A visible player named `none` (a legal four-letter username) gives the same key segment as an unattributed gift. Keys still differ by ordinal, so nothing collapses. `none` is not reserved; the owner has not asked for that.
