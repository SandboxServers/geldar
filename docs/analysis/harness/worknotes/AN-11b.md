# AN-11b worknote: Body proficiency cache

Base `203d9af2` (origin/main). Branch `phase1/an-11b-body-cache` (the brief's name; the card's `codex/an-11b-body-cache` was not used).
Packet commit `e287740e`. Fix pass (this section) adds one commit on top of it: `fix(character): make pushes advisory and harden the proficiency cache`.

## Files

- `golem/src/character/proficiency-cache.ts`: the AN-S0 stub body replaced. Exported signatures unchanged (`StateTransport`, `ProficiencyCache`, constructor options, all members).
- `golem/src/character/proficiency-cache.test.ts` (new): 51 cases on a fake transport with fake timers (31 behaviour cases, 20 drift cases from the contract subject table).

## Fix pass: changes against the review (AN-11b-review.md, numbered)

1. **Pushes are advisory (review finding 1, ruling 1).** `#onPush` validates the push (schema, life id, `levelForXp`, safe integers) and never changes a level, the version, the baseline or `degraded`. A valid push newer than the cached version calls `#confirm()`, which sends one `#requestOnce()`. `#confirmInFlight` is set before the request, so repeated pushes (including a transport that emits synchronously) start nothing more until it settles. Only a valid reply changes state. Test: a burst of 100 newer pushes gives exactly one extra request (mutation M11 fails it). A forged `version: 1e300` push is refused by `isCount` and sends nothing.
2. **Safe integers.** `isCount(n)` = `Number.isSafeInteger(n) && n >= 0`, applied to reply `version`, reply xp, push `version` and push xp. Tests: reply version `1e300`, reply version `4.5`, reply xp `1e300`, reply xp `4.5`, push xp `1e300` with version `1e300`, push version `4.5`.
3. **Header comment** rewritten to describe what the code does (replies change state; a push is advisory and starts one confirming request).
4. **Equal version (review finding 2, ruling 2).** A reply is adopted when its version is `>=` the cached version (`#adoptReply`). An equal-version reply after a push at that version now fills the baseline and the other domains. Test: push `combat` v40 during a request, reply v40 with a sheet and `mining` level 2 gives baseline set, `mining` 2, `combat` 0, `degraded` false.
   - **Card contradiction:** the card's Rules say accept when `version >= this.version`; its Checks say "equal version is ignored". The fix follows the Rules, because the Checks line is what leaves the start race with no baseline (review finding 2). Consequence accepted: two replies at the same version may differ, and the later one wins. The sink's version is the total XP after the award, so an equal version describes the same state; a reply that repeats a version is not a regression.
   - An older reply is still ignored (test: v39 after v40 changes nothing).
5. **Subjects (review finding 3, ruling 3).** The local token patterns are now the contract's: `SHARD_TOKEN = ^[a-z][a-z0-9-]{1,31}$` and `LIFE_TOKEN = ^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$`. Shard `Phase_0` and life `AG` are refused at construction (test). The drift test `describe('subject drift ...')` imports `../../../contract/src/subjects.ts` by relative path (test file only, `contract/` not edited). It asserts the cache's request and push subjects equal `proficiencyRequestSubject` / `proficiencyPushSubject` for four valid pairs, and that the helpers and the constructor both refuse each of sixteen invalid pairs.
   - **Later:** export the helpers and `stateWildcard` from `contract/src/index.ts` (serial contract regeneration), then import them here, delete the local `stateSubject` and its patterns, and keep the drift test as a same-string test.
6. **Mutation-resistant tests (review finding 4, ruling 4).** Added: push life check; reply level/xp check; first adoption; `stop()` clears the timer (`vi.getTimerCount()` 1 then 0); push after `stop()` (captured listener); reply `sheet_hash` kept verbatim; two concurrent `refresh()` leave one timer. Each is listed in the mutation table below.
7. **`start()` twice (review finding 5).** `start()` subscribes only when there is no subscription (`#unsubscribe === undefined`). A failed subscribe is retried by the next `start()`. Test: two starts leave one listener; `stop()` removes it.
8. **Throwing log (review finding 6).** Every log line goes through `#say()`, which swallows a throw from the caller's `log`. The retry timer runs `void this.#runCycle().catch(() => undefined)`. Test: a log that always throws neither rejects `start()` nor produces an unhandled rejection; the retry still sends its three requests.
   - The constructor still throws `RangeError` for a bad threshold list, shard or life id. That is a configuration error by design; AN-12 must construct the cache where a throw cannot stop Body startup.
9. **Invalid-reply log throttled (review finding 7).** "invalid proficiency reply ignored" is logged once per degraded episode, reset by the next valid reply. Test: 6 invalid replies in two cycles give one line; after a valid reply and one more invalid cycle, two lines. The push log line ("invalid proficiency push ignored") is not throttled: it is written per invalid push. A flood of invalid pushes therefore writes one line each. Note for the Body: the push subject is writable by the body role (0280), so this is a log-volume exposure until the ACL follow-up lands.
10. **`sheet_hash` (review finding 8, ruling 4 item 8).** Decision: **kept as sent, not verified**. The reply's `sheet_hash` is the sink's hash over the canonical sheet (AN-02b); the Body does not re-derive it, because AN-04a's canonical form is not checked from this card. The computed SHA-256 (of `canonicalSheetJson`) is used only when the reply carries no `sheet_hash`. Test: a reply hash of `'a' * 64` is returned as `baseline.hash` (mutation M6 fails it).

## Open risks

- **Forged push (review finding 1).** Resolved in this card for the cache: a push cannot change a level, version or baseline, and cannot block a real reply (an unconfirmed push is never adopted). The remaining exposure is a request-rate and log-volume one: a body that floods pushes causes at most one confirming request in flight at a time, and one log line per invalid push. The ACL follow-up (deny publish on `state.*.level` for the body and paper roles, 0280) is still the real fix, and AN-12 must not turn the cache on for a live Colo until it lands.
- **Confirming requests are not rate-limited across time.** Coalescing bounds concurrency, not frequency: a push stream that stays newer than the cache keeps the confirm loop busy at the reply round-trip rate. Acceptable while the ACL gap stands; a minimum interval belongs with the ACL follow-up.
- **Equal-version replies are adopted** (see item 4). If the sink ever sends two different states at one version, the later reply wins. That is a sink invariant (version = total XP) to check in AN-02b, not here.

## Revert-checks (card names, first pass)

1. Accept any version (`if (false && this.#adopted && version <= this.#version) return false;`): fails 3 tests (first pass, superseded by the rules above).
2. Subscribe after the first request (`await this.#runCycle();` moved above the subscribe in `start()`): fails "a push during start is not lost" and "a stale reply after a newer push is ignored" (first pass; both tests were rewritten for the advisory rule).

## Mutation results (fix pass)

Each mutation was applied to the committed fixed file with a single-line (or two-line) replacement, the full cache test file was run with `node node_modules/vitest/vitest.mjs run`, and the file was restored from a scratchpad backup (SHA-256 matched). `git diff --stat` showed only the mutation each time, and is empty after the last restore.

| # | Mutation (in `proficiency-cache.ts`) | Result | Test that fails (name) |
|---|---|---|---|
| M1 | push life check removed (`push.life_id !== this.#lifeId ||` to `false ||`) | 1 fails | a push for another life is refused and sends nothing |
| M2 | reply level/xp check removed (`|| levelForXp(xp, ...) !== level)` dropped) | 2 fail | a reply whose level does not match its xp is ignored; the invalid-reply line is logged once per episode and again after a valid reply |
| M3 | first adoption removed (`if (this.#adopted && state.version < ...)` to `if (state.version <= ...)`) | 2 fail | first adoption: a cold reply at version 0 with a sheet fills the baseline; an equal-version reply is adopted, an older reply is ignored |
| M4 | `clearTimer()` in `stop()` removed | 1 fails | stop clears the pending retry timer |
| M5 | stopped check on push removed | 1 fails | a push delivered after stop changes nothing and sends nothing |
| M6 | reply `sheet_hash` ignored (`value.sheet_hash ??` to `undefined ??`) | 1 fails | a reply sheet_hash is kept as sent, not recomputed |
| M7 | timer guard in `#scheduleRetry` removed | 1 fails | two concurrent refreshes leave exactly one retry timer |
| M8 | log guard removed (`#say` try/catch dropped) | 1 fails | a throwing log neither rejects start nor makes the retry an unhandled rejection |
| M9 | start-twice guard removed (`if (this.#unsubscribe === undefined)` to `if (true)`) | 1 fails | start twice does not leak the first subscription |
| M10 | invalid-reply throttle removed | 1 fails | the invalid-reply line is logged once per episode and again after a valid reply |
| M11 | push coalescing removed (`if (this.#confirmInFlight) return;` dropped) | 1 fails | a burst of 100 newer pushes starts one confirming request |

The review's card-named mutations (accept any version; subscribe after the first request) are superseded: the rules they guarded changed with the advisory push.

## Checks

- `node node_modules/vitest/vitest.mjs run golem/src/character/proficiency-cache.test.ts`: 51 of 51 pass (before and after biome formatting; the final run is in the commit report).
- `node node_modules/typescript/bin/tsc -p golem --noEmit`: exit 0.
- `node node_modules/@biomejs/biome/bin/biome check` on the two files: exit 0 (after `check --write` formatting).
- Line counts: implementation 306, test 590 (both under the 700 hard cap; the test is over the 500 soft cap because of the 51 cases. The drift block is the last 40 lines and can move to its own file later).
- `live: not run` (unit tests only).
- `./geldar.ps1 pnpm check:repo`: see the report.
- Not run: the full vitest suite, `golem/src/character` other files (only this file was run, per the brief).
