# Wave 5 review, round 1: areas A (attention, loop, fallback) and D (Body additions)

18 findings (6 major). Paths relative to the repo root. Answer to the open question: the Body has no allow-list; the Mind's validator is the only gate before the ack (`golem/src/mind-link/server.ts:188-230`). The Body fails unsupported verbs only after acking (`golem/src/actions/registry.ts:136-139`, `golem/src/body/programs/index.ts:15-55`). Nothing authenticates the sender on the plan subject (loopback NATS; threat-model item).

## Major
1. Nothing wakes the Mind after a hold or an intent-less plan (`animus/src/attention/controller.ts:100-105,174-199`): a say-only thought, or a `no_thinker`/`tired`/`snapshot_unavailable` hold, leaves Adam standing until a reflex or chat line. Fix: an idle watchdog whenever no active intent and no thought in flight; controller test plus an e2e step that does not use an external event.
2. One addressed line causes two thoughts (`controller.ts:139-172`, `policy.ts:27-35`, `golem/src/voice/ears.ts:124-129`): `speech_addressed` and `directly_addressed` do not merge; the second can replace the first thought's intent. The Body treats any mention as addressed, the Mind's classifier as `about_me`. Fix: fold the two reasons (or drop a pending wake that predates the settled snapshot); test the pair.
3. One failed plan makes the next thought high effort (`animus/src/loop/fallback.ts:60-63,78`, `effort.ts:37`): the intent `failed` event and the `plan_result` both count (2 = high). Test theatre at `loop-parts.test.ts:143-153`, `thinking-loop.test.ts:405-413`. Fix: count only intent `failed`.
4. A refused plan is recorded as `planned` and nothing records why (`thinking-loop.ts:352-354,369-372,600-608`): wrong outcome, an `intent_id` that never existed, no rejection reason, no re-plan after `stale_generation`/`expired` (expiry is 60 s and a retry or high effort can pass it). Test theatre at `thinking-loop.test.ts:142-154`. Fix: `fallback_hold` and null intent for a refused plan; log the reason; re-snapshot and re-think once on `stale_*`/`expired`; check expiry before submit.
5. The Body supervisor can hang after a failed start or a bot that ends during start (`golem/src/adam/main.ts:95,132-173`, `adam-body.ts:140`): a throwing `startAdamBody` leaves the bot online with no Body and `acquire` waits forever; the `end` listener is registered after a KV round trip. Fix: quit the bot or reuse it; register `end` first; tests for both.
6. Silent failure paths in the loop (`thinking-loop.ts:240-250,576-580,534-536,625-629`, `mind.ts:185`, `controller.ts:308-312`): `loadDeterministic`/`journalSince` throws become `model_error` with no log; journal errors counted and dropped; thought event publish failure swallowed; invalid plans dropped silently; `recordSuppressed` failures swallowed. Fix: log each with life_id and an error code.

## Minor
7. The fallback resurrects a stale interrupted intent (`fallback.ts:94-101`): consider only the most recently changed intent.
8. Stale `idle`/`fallback` candidates are never dropped on settle (`coalesce.ts:99-107`, `controller.ts:100-105`).
9. `current_plan` is null after a Body restart resume, so the Mind may cancel the resumed intent (`server.ts:106,182-186,272-274`).
10. Drained events are lost when a snapshot fails or its reply is late (`server.ts:163-168`): peek, then clear after the reply is sent.
11. The `stuck` effort signal can never fire (`server.ts:154-168`): implement a Body watchdog or record a decision.
12. The ears read `senderUuid`/`networkName`, but the client event carries `sender`/`senderName` (`golem/src/voice/ears.ts:97-101`, tests `voice.test.ts:242-250`); the own-UUID filter is dead.
13. `cleanLine` leaves invisible characters (tags U+E0000-E007F, variation selectors, U+00AD, U+034F, U+061C, U+180E) (`golem/src/voice/text.ts:12-21`).
14. A plan whose ack times out is treated as a hold though the Body may run it (`thinking-loop.ts:533-541`): retry `submitPlan` once (the Body dedupes by thought id).
15. `Attention` has no `stop()`; timers outlive `Mind.stop()` (`controller.ts`, `mind.ts:167-174`).
16. Body shutdown waits for running plans before stopping the executor (`golem/src/adam/adam-body.ts:152-153`).
17. A reflection starts its slot late (`animus/src/reflection/trigger.ts:92-104`): call `thoughtStarted()` before the first await.
18. `animus/src/loop/thinking-loop.ts` is 640 lines (soft cap 500): split.

## Unverified
Event order speech-before-wake (2); whether the 8B returns say-only thoughts (1); whether `reasoning: on` at 1200 tokens truncates Qwen3 thinking; perception cost per snapshot; remembered blocks lost across a restart; Windows SIGTERM paths never run; `NatsEventSource` on a Thinker disconnect mid-job.
