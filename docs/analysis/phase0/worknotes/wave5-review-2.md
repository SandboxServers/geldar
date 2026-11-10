# Wave 5 review, round 2 (of the fix round `35e16c0..phase0/wave5`)

Three reviewers (A+D, B+C, E). Round 1 status: most fixed; not fixed or partly: AD 2, 5, 6, 11, 16, 18 (13 mostly); BC 3, 6, 8, 9, 10, 11, 14; E 1, 2, 5, 8, 11, 13, 14, 15, 16, 17. Paths relative to the repo root. Fix packets: R4a (8B validity, running), R4b attention and voice, R4c prompt budgets, R4d commitments and reflection, R4e Body supervisor and loop, R4f Thinker hub and config.

## A + D (packets R4b, R4e)
- AD-N1 MAJOR: the addressed-line fold compares ticks from two Body clocks (speech uses `bot.time.age`, the wake uses `runtime.view.tick`), so the wake arrives with a greater tick and a second thought is queued (`animus/src/attention/controller.ts:274-283,326-328`; tests use equal ticks). Fix: pair by event type plus a ~3 s real-time window; never fold speech with speech; tests with wake tick > speech tick.
- AD-N2: a second addressed speaker in the same coarse tick can be dropped as a duplicate (same fix).
- AD-N3: a throw after the restart in `startAdamBody` (`golem/src/adam/adam-body.ts:136-170`: BotEars, BotVoice, perception, MindLinkServer, `link.start()`) leaves the bot online with a running Body and `acquire` waits forever; wrap the rest in the same try/catch, stop the Body, detach, quit the bot.
- AD-N4: executor-first shutdown is partial (`adam-body.ts:183-186`): add `MindLinkServer.stopServing()` first, then cancel the executor/runtime action, then wait for `link.idle()`, then stop; the test must see the link order.
- AD-N5: `withinLimit` abandons the memory load but does not cancel it (`animus/src/loop/thinking-loop.ts:96-104,226-227`): log `memory_load_timeout`, cap the pool, document.
- AD-N6: the single re-think drops the first cycle's bookkeeping: log `thought_rethink`, add its counts.
- AD-N7: no tests for the pre-submit expiry check and the once-only bound (`plan.ts:25-28`, `thinking-loop.ts:430-438`); `TICK_MS = 50` hard-coded instead of `config.tickRate`.
- AD-N8: U+E0100-E01EF passes `cleanLine` (`golem/src/voice/text.ts:28`).
- AD-N9: an `idle` wake that settles during a thought is dropped, Adam can stand 60 s (`controller.ts:123,127`): keep an idle candidate whose event is after the in-flight thought's snapshot, or record a decision.
- Still open from round 1: AD-11 (the `stuck` signal is never set: implement the Body watchdog or record a decision), `recordSuppressed` failures swallowed (`controller.ts:374-376`), thinking-loop.ts 562 lines.

## B + C (packets R4c, R4f)
- BC-N1 MAJOR: the prompt budget bounds only the quoted section; goals, commitments, beliefs, memories, recent thoughts and the snapshot are unbounded, and when `12000 - withoutWorld` is below the frame every line (wake_speech and plan too) is dropped (`animus/src/prompts/library.ts:255-260`, `world-text.ts:151-158`). Fix: render wake_speech and plan always; apply the budget to the memory blocks (drop oldest recent thoughts, then memories, then beliefs, within a reserved share, e.g. at most 60 percent); test with 40 beliefs of 512 chars plus a full journal.
- BC-N2 MAJOR: the budget counts characters, not tokens; 50 lines of 256 CJK or astral characters still overflow `num_ctx` 8192 (`world-text.ts:146-168`). Fix: per-line cost estimate (ASCII / 3, +1 per non-ASCII UTF-16 unit, +2 per astral); default budget about 8000 or a token estimate; test.
- BC-N3 MAJOR: the reflection prompt has no budget and my digest cap change made it unbounded (20 hostile `<` lines expand to about 19.8 KB) (`library.ts:288-299`). Fix: `reflectionBudgetChars`, cut the digest after escaping before relationships.
- BC-N4: escape set misses U+180B-180D, 180F, 206A-206F, FFA0, FFF0-FFFB, 17B4-17B5, E0100-E0FFF, 1D173-1D17A, 1BCA0-1BCA3 (`world-text.ts:53-69`, `golem/src/voice/text.ts`): test over `\p{Default_Ignorable_Code_Point}` and `\p{Cf}`.
- BC-N5: the welcomed-only cap is bypassable (open many sockets, then hello on all) and unwelcomed sockets are unbounded (`animus/src/thinker/hub.ts:124,144`): re-check in `onWelcomed`, cap total sessions at about 2x.
- BC-N6: `contract/test/mind-channel.test.ts:256` holds a lone 0x80 byte (invalid UTF-8): rewrite with `'€'.repeat(...)`.
- BC-N7: a partial warm result is cached for the process life (`lantern-local/src/thinker.ts:160`): cache only a result with every warm name, or retry the missing.
- BC-3 (partly): `max_tokens` offer is never enforced (`session.ts:135`, `runJob` ignores `frame.max_tokens`); BC-8 packet card `wave5-packets.md:109` still says 1 s to 30 s backoff; BC-10 (OWNER-LEVEL, open): memories/beliefs/goals sit outside the quoted section and the template does not say they are data: decision pending, recommended one v3 line; BC-11 validator bounds are not read from the shard config (`animus/src/main.ts:207`); BC-14 pin v2, reflection v1 and body-api v1 hashes (library.test.ts).

## E (packets R4d, R4f)
- E-N1 MAJOR: commitments with no due tick flood the thought prompt, render twice (as due commitments and as beliefs), cannot be retired once outside the newest 40 beliefs, and the reflection prompt has no commitments block (`pg-store.ts:185-197`, `reflection/apply.ts:102,117,150`, `prompts/render-memory.ts:32-49`, `prompts/reflection/v1.md:23`). Fix: `LIMIT` the due query (`mind.max_commitments`, default 10), exclude commitments from the beliefs query, add a commitments block to a reflection v2 template and pass them into `resolve`; test with 500 beliefs and 50 commitments.
- E-N2: the fake and Pg store differ (the fake's relationship embed is unguarded, its `loadDeterministic` ignores `maxBeliefs`) and `PgMemoryStore.commitReflection` has no unit test of statement order and rollback (mock pool: BEGIN, writes, COMMIT; throw at the goals delete asserts ROLLBACK and no `pool.query`).
- E-N3: embedder calls run inside the open transaction (`pg-store.ts:399-400`): embed before `inTransaction`, one batched call.
- E-N4: `lastReflectionTick` counts failed reflections (`journal.ts:82-89`): only rows with `parsed IS NOT NULL` and `world_day <= agents.last_sleep_day`.
- E-N5: a life that never slept never gets tired (bornDay null, lastSleepDay null): `MemoryStore.setBornDay` on the first thought.
- E-N6: reflection prompt has no total budget (covered by BC-N3).
- E-N7: the live fixture reset leaves `agents.last_sleep_day`/`born_day`; the guard is id-only: reset them too and key the guard on tier fast.
- E-N8: DECIDED (owner): identity_mode is declarative, decision 0059.
- E-N9: the healthcheck passes on a marker file holding only a newline (`compose/phase0.yml:102,132`): add `[ -n "$start" ]`.
- Still open from round 1: E-2 `dueTick` always null, E-8 trigger skip reasons silent and `creditsSettled` always 2, E-11 fatigue switch not configurable, E-13 provenance guard bypassed by rewording, E-14 COALESCE test is text-only, E-16 `p0-06-fix-2.md` holds `<container-ip>`, E-17 pgvector filter after HNSW (Phase 1).
- Docs stale (docs sweep): `docs/decisions/README.md` 0051 line, RESUME.md at wave 4, ledger P0-19 to P0-33, `animus/README.md` skeleton text, `shards/phase0.yaml:5` dilation comment and the undocumented `mind.memory_timeout_s`.
