# AN-28b: Body subscription and the leakage gate

Status: built on `phase1/an-28b-observation-wiring` (base `d0ae058d`), reviewed in `AN-28b-review-1`
and fixed in one pass on top of `07710902`. Off by default: nothing in production sets
`AdamBodyEnv.observations`, and `main.ts` and `body-host.ts` are unchanged.

## Files

- `golem/src/perception/provenance/subscribe.ts` (new): `startObservations` subscribes to
  `provenanceBreakSubject` and `provenancePickupSubject` with a plain `{ callback }` (no replay). A
  message over 4096 bytes, one that fails `validateProvenance`, or one of the wrong kind for its subject
  is dropped with a counter and one log line (no content, no name). A break or pickup in a world other
  than `bukkitWorldOf(bot)` is ignored. Breaks go to `observeBreak` with a `TakeKeyLru`; pickups go to
  `observeGift` with a `Set<string>`. A result becomes an `observation` WorldEvent with
  `source_event_id = eventIdFor('observation:' + lifeId + ':' + key)`, checked by `validateWorldEvent`,
  and published on `geldar.<shard>.observation` (a publish failure is logged). `startBodyObservations`
  is the Body's wiring: selfName = life id, `observedActor` for names, `canSeeBlock` for sight.
- `golem/src/perception/provenance/subscribe.test.ts` (new, 30 tests).
- `golem/src/adam/adam-body.ts` (442 lines): `observations?: boolean` on `AdamBodyEnv`. When it is
  `true` and `owners` is set, `watchHurts` gets a fourth argument (`observedActor`) and
  `startBodyObservations` runs; both are stopped in `stop()` and in the failed-start cleanup. Otherwise
  the code path is today's.
- `golem/src/adam/adam-body-observations.test.ts` (new, 6 tests).
- `threshold/mcp/src/events/leakage.test.ts` (new, 8 tests).

## Tests

Golem, `subscribe.test.ts`:
- Subscription: both subjects subscribed and stop unsubscribes both; a subscription has only a
  `callback` key; a message after stop is ignored; a bad shape is dropped and counted; a wrong kind for
  its subject is dropped; an oversize message is dropped unread; a message of exactly
  `MAX_PROVENANCE_BYTES` is read and one byte more is dropped; a publish failure is logged, not thrown;
  a publisher that throws synchronously is counted as failed and does not escape the callback; an event
  the contract refuses is logged and not published; a subscribe that fails after the first unsubscribes
  the first and throws.
- Ownership and world: a valid break for the owner publishes one observation event; a break in another
  world gives nothing, the same world gives one; a pickup in another world gives nothing, the same world
  gives one; a break with another prior owner, or with no owner, gives nothing; a break the Body made
  itself gives nothing; a pickup with another picker, or one the Body threw itself, gives nothing; a
  repeated break is published once; a valid pickup of the Body publishes one gift observation.
- Sight and names: a break the Body cannot see gives nothing; a break whose breaker is out of sight is
  published unattributed.
- Leakage at the subscription (`the leakage gate at the subscription`): a visible breaker is named and a
  hidden one (life id `ag_capc_03`) is unattributed; a break in a cell the Body cannot see gives nothing
  even with a visible breaker; a pickup names a visible thrower and not a hidden one (`Hidden_Walker`).
  A hidden break's key
  ends in `:none` and a hidden gift's key has `:none:`. Each published body is scanned by `leaksIn`: no
  `provenance`; no coordinate triple in the payload without its `key`; no `ag_` id other than the Body's
  own agent id and the visible actor's life id, in the whole body; and no hidden name or life id anywhere
  in the body, the key included, matched case-insensitively (the producers lowercase the key). `leaksIn`
  itself is tested on hand-built bodies, one leak per scan, including a hidden name in a key.

Golem, `adam-body-observations.test.ts`: observations absent, false, or on without `owners` give no
provenance subscription and `watchHurts` gets three arguments; observations on subscribe both subjects
with no replay option, `watchHurts` gets four, and stop unsubscribes both; a start that fails after
the subscription unsubscribes both.

Threshold, `leakage.test.ts` (the delivery-side gate): a visible breaker and thrower are named, with no
life id, key or coordinate; a hidden breaker and thrower are unattributed, with no `actor` field; the
recorded Body events (`test/fixtures/real-body-events.json`: intent, plan and wake, no observation) replay
with no leak; an injected life id and an injected coordinate are reported; a `key` and the word
`provenance` in an output are reported; a hidden name in an output is reported.

## What is enforced, and what is not

- The threshold test does not run the golem observers, because golem is not importable from threshold.
  Its observation payloads are hand-built from the fixtures' shapes, and its visibility is stated per case.
  It does not show that the Body decides sight correctly. That is tested in golem: the leakage cases and
  the subscription cases in `subscribe.test.ts` run `startObservations` with a fake sight decision.
- The golem leakage scan is not a scan of every byte. The payload's `key` is the contract's dedupe key,
  and it carries the coordinates and the breaker's name by design, so the coordinate scan reads the payload
  without it. The name and life-id scans read the whole body, the key included, so a hidden name or life id
  written into a key is caught. The Mind's presenter (threshold) is what keeps the key from the player; the
  threshold gate does not see the key at all, since its presenter drops `key`. The `ag_` ids
  the body may carry are the Body's agent id and the visible actor's life id, which the Mind needs; the scan
  rejects any other, in the key too.
- The real-body replay does not show a hidden actor: the recorded Body events hold no observation or damage
  event. The hidden-actor cases are the hand-built ones above.
- `startBodyObservations` is tested in `subscribe.test.ts` (describe `startBodyObservations (AN-28b wiring)`):
  a break is observed only when `blockAt` is called with a `Vec3` of its cell and `canSeeBlock` accepts it;
  a block behind another block, or no block, gives nothing; `selfName` is the life id; a breaker out of
  sight is unattributed (`observedActor`). The fourth argument of `watchHurts` is tested in
  `adam-body-observations.test.ts`: it returns what `observedActor(bot, name)` returns.
- The third-party, unowned and self cases are now tested at the subscription level (ownership tests above),
  not inferred from `property-break.test.ts` or `gift.test.ts`.

## Revert-checks (run for real, on the fixed code)

Each mutation changed one line (or one multi-line block, by regex), with the file restored from a
scratchpad copy afterwards and every file's hash checked against its original. Each row names the tests
that failed.

1. Default path and "observations off" (`adam-body.ts`):
   `const observeTransport = env.observations === true ? env.owners : undefined;` became
   `const observeTransport = env.owners;`. Killed by
   `observations off (absent): ...three arguments` and `observations false: the same as absent`.
2. Bad shape dropped (`subscribe.ts`): `if (!validateProvenance(msg)) {` became
   `if (typeof msg !== "object" || msg === null) {`. Killed by
   `a provenance message with a bad shape is dropped and counted`.
3. Sight (`subscribe.ts`): `canSee: opts.canSee,` became `canSee: () => true,` (a fake bot that sees
   through the wall). Killed by `a break the Body cannot see gives nothing` and by the leakage-gate case
   `a break in a cell the Body cannot see gives nothing, even with a visible breaker`.
4. `ag_` scan removed (`leakage.test.ts`): killed by
   `an injected life id in an observation is reported as a leak`.
5. Break world filter (`subscribe.ts`): `const inWorld = ... === bukkitWorldOf(opts.bot);` became
   `const inWorld = true;`. Killed by `a break in another world gives nothing; the same world gives one`
   and `a pickup in another world gives nothing; the same world gives one` (the second kills the
   pickup filter's own mutant too).
6. Pickup world filter removed (`subscribe.ts`, the `if (!inWorld) return;` line of the pickup branch).
   Killed by `a pickup in another world gives nothing; the same world gives one`.
7. Size cap `>` to `>=`: killed by `a message of exactly MAX_PROVENANCE_BYTES is read; one byte more is dropped`.
8. try/catch around `handle` removed: killed by `a publisher that throws synchronously is counted as failed and does not escape`.
9. Partial-subscribe cleanup removed: killed by `a subscribe that fails after the first unsubscribes the first and throws`.
10. `validateWorldEvent` branch removed (`return event;`): killed by `an event the contract refuses is logged and not published`.
11. `provenance` scan removed (`leakage.test.ts`): killed by `the word provenance in an output is reported as a leak`.
12. `"key"`/`brk:`/`gift:` scan removed (`leakage.test.ts`): killed by `a key in an output is reported as a leak`.

Body-wiring mutants (review 1, note 3), each one line in the production file, restored by copy from a
scratchpad backup (`git diff --stat` empty after each restore):
13. `canSee` in `startBodyObservations` replaced by `return true;` (`subscribe.ts`): KILLED by
    `a break in a cell behind another block gives nothing, even with a visible breaker` and
    `a break with no block at its cell gives nothing`.
14. Vec3 argument order swapped to `new Vec3(z, y, x)` (`subscribe.ts`): KILLED by
    `a break is observed when the Body sees its cell: blockAt gets the cell as a Vec3 and the visible breaker is named`
    (and two more in the same describe).
15. `resolve` replaced by `null` (`observedActor(opts.bot, username)` in `subscribe.ts`): KILLED by
    `a break is observed when the Body sees its cell: blockAt gets the cell as a Vec3 and the visible breaker is named`.
16. `selfName: opts.lifeId` replaced by a constant (`subscribe.ts`): KILLED by
    `selfName is the life id: a break whose prior owner is this Body is observed, another owner is not`
    (and two more in the same describe).
17. `watchHurts` fourth argument replaced by `(u) => null` (`adam-body.ts`): KILLED by
    `watchHurts gets this Body observed-actor function: it names the visible player and no one else`.

Review 2 (fix pass 2): each mutation changed one line, run through `vitest run` on the file named, then
restored with `git checkout --` on that file (`git status --short` empty after each). The test files were
committed first, so the restore brings back the committed test.
18. `property-break.ts:91`: `${actor?.name ?? 'none'}` became `${msg.actor ?? 'none'}` (the breaker's
    name in the key, unresolved). KILLED by
    `a visible breaker is named and a hidden one is unattributed; neither leaks`.
19. `gift.ts:95`: `${who}` became `${msg.thrower ?? 'none'}` (the thrower's name in the key, unresolved).
    KILLED by `a pickup names a visible thrower and not a hidden one`.
20. `leaksIn` provenance scan (`if (/provenance/i.test(body))` became `if (false)`): KILLED by
    `leaksIn reports each leak it scans for, one per scan, on hand-built bodies`.
21. `leaksIn` coordinate scan: KILLED by the same test.
22. `leaksIn` `ag_` scan (`if (!allowed.includes(id))`): KILLED by the same test.
23. `leaksIn` hidden-actor scan: KILLED by the same test.
24. `leakage.test.ts` life-id scan (`if (/ag_[a-z0-9_]+/.test(text))`): KILLED by
    `an injected life id in an observation is reported as a leak`.
25. `leakage.test.ts` provenance scan: KILLED by `the word provenance in an output is reported as a leak`.
26. `leakage.test.ts` key scan: KILLED by `a key in an output is reported as a leak`.
27. `leakage.test.ts` coordinate scan: KILLED by `an injected coordinate in an observation is reported as a leak`.
28. `leakage.test.ts` hidden-name scan (`if (text.includes(HIDDEN_NAME))`): KILLED by
    `a hidden name in an output is reported as a leak`.

## Index lines

None for `ledger.md` or `RESUME.md`. The worknote is the only index entry for this packet.