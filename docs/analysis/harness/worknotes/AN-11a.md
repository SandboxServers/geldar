# AN-11a worknote: proficiency state service (sink side)

Base `5df59f9a` (origin/main, AN-10a and AN-11b merged). Branch `phase1/an-11a-state-service`.
Commit: `feat(character): proficiency state service in the sink` (one commit on the base; the fix pass is squashed into it).

## Status: inert

Nothing wires this service. `eventsink/src/main.ts` does not import or start it, and AN-12 owns that wiring. AN-12 must not wire it until the owner decides the Exposure question below. AN-12 must also not pass `thresholds` to the sink: the Body cache checks levels with its own thresholds, so a different list makes it refuse every reply.

## Exposure (owner decision, parked)

The reply carries the adopted sheet (`sheet`, `sheet_hash`), so the sheet can reach people it is not meant for. Facts from `geldar.ps1`, `Get-NatsUsers` (lines 376-397), and `allow_responses: true` on every user (line 358):

Who can request `geldar.<shard>.state.<life>.proficiency` today:
- `body`: yes. Its `Pub` is `geldar.<shard>.>` and its `PubDeny` is `state.*.level` only. It is one credential (`nats-body.txt`) for every life, so any Body can read any life's sheet, levels and XP, and can tell which lives exist (`unknown_life` against a state).
- `paper`: yes, the same allow and the same deny (`state.*.level` only).
- `eventsink`: publishes `geldar.<shard>.state.>`. It is the responder.
- `mcp`, `mind`, `velocity`, `kino`, `deploy`, `supervisor`, `register`, `helper`: no publish right on the subject.

Who can read a reply:
- Every role subscribes `_INBOX.>`, so `mind` and `mcp` can read a reply sent to a Body's inbox.
- The service answers the reply subject the request named (`msg.respond`), and `allow_responses` lets that through. Whether a deny list blocks it was not verified.
- The sink cannot tell who asked: a NATS message carries no sender identity.

Blocker for AN-12 as the role table stands: `eventsink` has no subscribe right on `geldar.<shard>.state.*.proficiency` (its `Sub` is `_INBOX.>` only). The server refuses the subscription. The loop now logs it and retries (see deviation 12), so the sink survives, but the service answers nothing.

Options (the owner decides; nothing here is implemented):
- (a) Omit the sheet from the reply. The Body already has its own sheet from the player config path (`golem/src/character/character-config.ts`). The reply keeps `life_id`, `version` and `levels`. No ACL change, and the sheet leaves the wire. Recommended first. Confirm that AN-11b's baseline comes from config.
- (b) Keep the sheet and scope the ACL per life: a user per life created by the supervisor at spawn (or JWT users with name templating), a private inbox prefix per role, and `paper` denied `geldar.<shard>.state.>` publish. Larger; belongs to geldar-93.
- (c) An application token per life from the supervisor. It does not stop inbox reads without the inbox prefix from (b).

Whichever option is chosen, AN-12 / geldar-93 must: deny `paper` publish of `geldar.$s.state.>`; give each role a private inbox prefix and narrow every `_INBOX.>`; add eventsink Sub `geldar.$s.state.*.proficiency` and body Sub `geldar.$s.state.*.level`; and add repo-check cases showing `paper` and `mind` cannot publish the request and no role can subscribe to another role's inbox.

## Files

- `eventsink/src/state/service.ts`: `serveProficiencyState` subscribes to `geldar.<shard>.state.*.proficiency` in the queue group `state-service` and answers one request at a time. Exports: `serveProficiencyState` and, for tests, the `Limiter` class.
- `eventsink/src/state/pg-state-store.ts`: unchanged in this pass. `pgStateStore(pool)`, two SELECTs, read only.
- `eventsink/src/state/service.test.ts`: 30 cases on a fake NATS and an in-memory store. The fake delivers every subject to every subscription and does no matching, so the service's own subject checks are what refuse a bad subject. The one-digit life id is checked against the contract's `proficiencyRequestSubject`, which throws on it.
- `eventsink/test/state.it.test.ts`: real Postgres and NATS, skipped unless `GELDAR_IT=1`. **Live: pending.**
- `.github/workflows/ci.yml`: one line added to the integration list (deviation 7).

## Deviations from the card (and why)

1. **`NatsConnection`** is the real type from `@nats-io/transport-node` (3.4.0, already in `eventsink/package.json`). No package.json edit.
2. **Optional `thresholds` option** (default psyche `DEFAULT_THRESHOLDS`). A bad list throws at startup. AN-12 must not pass it (see Status).
3. **The store's `version` is ignored.** The service sums the XP of the seven domains and sets `life_id` from the subject. A store that answers for another life is refused.
4. **Body over 256 bytes: no reply.** The card says "reject" and gives no reply shape. A silent drop costs no work.
5. **Malformed life token or other shard: no reply, no read.**
6. **Limiter memory bound (not in the card).** The limiter remembers at most 4096 lives. When it is full, a new life evicts the life admitted longest ago, so memory is bounded under any spread of ids. There is no sweep and no expiry, and each request costs O(1). The fix pass added the tests: the map never exceeds 4096 under 20,000 distinct lives, the 4096th life is held without eviction, and past the cap the oldest is evicted and admitted again. **Known effect:** a flood of distinct valid life ids can evict a legitimate life's slot, so that life is answered once more inside its interval. The read rate per life still holds for the lives that stay in the map.
7. **CI list.** `eventsink/test/state.it.test.ts` is added to the `ci.yml` integration list after `xp.it.test.ts`. `ci.yml` is outside the card's may-edit list. The brief allows it because the IT connects with no credentials, as `eventsink.it.test.ts` does.
8. **Ops checks with real roles are not automated.** They need NATS roles the lane does not provide, and they are for the orchestrator's ops run.
9. **Open item from the card:** any Body role can request any life's state (see Exposure).
10. **Queue group `state-service`** (fix pass). Two sinks on one shard share requests instead of both answering. The fake records the subscribe options.
11. **Read timeout** (fix pass, `readTimeoutMs`, default 2000 ms). A read not settled by then answers `{"error":"unavailable"}` and logs `state read failed`. A hung read cannot stall the requests behind it, and `stop()` does not wait for it past the timeout. A reply that is ready after `stop()` is not sent.
12. **Subscription supervision** (fix pass). A subscription the server refuses (subscribe throws, or the iterator rejects) or one that ends while the service runs is logged with one constant line (`state subscription failed` or `state subscription ended`) and resubscribed after a capped backoff: `retryBaseMs` (default 1000 ms), doubled per failure, capped at 30 s, reset after a delivered message. Nothing rejects unhandled, and `stop()` cancels a pending backoff.
13. **Log reasons are constants** (fix pass): `state read failed`, `state life mismatch`, `state level mismatch`, `state row invalid`, `state reply invalid`. No error message from the store is logged.

## Behaviour (what the code does)

- Request subject `geldar.<shard>.state.<life>.proficiency`. The life id comes from the subject and must match the contract pattern: `ag_<name>_<nn>` with at least two digits, so `ag_x_1` is refused. The payload is size-checked (256 bytes) and then ignored.
- Per-life minimum interval (default 1000 ms, on the monotonic clock `performance.now()`). Inside it: `{"error":"rate"}`, no read.
- Unknown life (no `agents` row): `{"error":"unknown_life"}`.
- Store error or timeout, another life's answer, a level that is not `levelForXp(xp, thresholds)`, or a reply that fails `validateProficiencyState`: `{"error":"unavailable"}`, with the constant log line from deviation 13.
- A life with no proficiency rows: seven zero levels, version 0. A life with no sheet: no `sheet` or `sheet_hash` key. A life with a sheet: the stored sheet and hash, as stored (not recomputed).
- `stop()` unsubscribes, cancels a pending backoff and waits for the loop. A request after it gets no reply.

## IT: each case reasoned through the SQL by hand

Seeding (`sql/0001_init.sql` NOT NULL columns): `agent_id` (the life), `name`, `life_seq` (1), `game_account` (the life id; UNIQUE, fresh per test), `shard` (`phaseitstate`), `model_config`, `tier` ('sovereign'); `mode` 'sovereign' passes its CHECK. Proficiency rows: domains in the CHECK set, xp >= 0, level from `levelForXp`. Only inserts, so the append-only triggers do not fire.

- **Life with rows:** version is 40 + 5 = 45; `character_sheet` is NULL, so no sheet key.
- **No rows:** all seven domains zero, version 0.
- **Adopted sheet:** `UPDATE ... SET character_sheet, sheet_hash, sheet_adopted_at`. The first write passes `agents_sheet_immutable`. **Not verified:** that `character_sheet_valid(STANDARD_SHEET)` accepts psyche's standard sheet. A live run shows it first.
- **Unknown life:** no agents row, reply `unknown_life`.
- **Another life's data:** both SELECTs filter on the subject's `life_id`.
- **Payload life id:** never parsed; the reply is for the subject's life.
- **Wrong shard:** no subscription matches, so the request has no responder.
- **Oversized body:** 257 bytes is dropped before any SQL; the request times out at 500 ms.
- **Rate:** a second service on its own shard with a 60 s interval; the second request gets `rate`.

## Checks (fix pass)

- `node node_modules/vitest/vitest.mjs run eventsink/src/state`: 30 passed.
- `node node_modules/typescript/bin/tsc -p eventsink --noEmit`: exit 0.
- `biome check` on the two service files: clean.

## Revert-checks (service.ts, one line each, file restored byte for byte, `git diff` empty after each)

| # | Mutation | Failing tests (named) |
|---|---|---|
| M1 | `version += row.xp;` to `version += 1;` | replies with the life own levels, version and adopted sheet; replies with zeros and version 0; version is strictly monotonic with XP; version is the sum of the XP, not the row count (3 domains, XP 5/10/20 expects 35) |
| M2 | level check skipped | a stored level that does not match its XP is refused |
| M3 | contract validation skipped | reply validates against the contract |
| M4 | another life's answer accepted | reply with another life data is refused, and the reason is logged |
| M5 | not re-run this pass | the service no longer parses the body, so there is no one-line mutation for it; the test "trust payload life id" guards the subject-only rule by the store calls it records |
| M6 | no rate limit | a request inside the minimum interval gets the rate error, per life |
| M7 | no body limit | a body over 256 bytes gets no reply and no read; 256 bytes is answered |
| A | loop `catch` rethrows (no supervision) | a refused subscription is logged, retried; a subscription whose iterator rejects is logged once and does not reject unhandled; stop ends a retry (stop rejects) |
| B | `store.read` not raced against the timeout | a read that never settles answers unavailable; stop resolves while a read never settles. Both fail by the 5 s test timeout, and the timeout promise is then unhandled, which is an artifact of the mutation |
| C | queue group removed | subscribes in the state queue group |
| D | limiter refuses when full, no eviction | past the cap a new life evicts the oldest entry |
| D2 | limiter cap check removed (unbounded map) | the map never exceeds its cap; past the cap a new life evicts the oldest entry |
| F | shard check removed | a subject for another shard, or a different prefix |
| G | `geldar` token check removed | a subject for another shard, or a different prefix |
| H | five-token check removed | a subject with five tokens too many or too few |
| I | `LIFE_ID` `{2,}` changed to `{1,}` | a one-digit life id is refused by the contract and by the service; two digits are answered |
| J | post-read `if (stopped) return` removed | stop resolves while a read never settles; a reply that is ready after stop is not sent |
| K | `performance.now()` changed to `Date.now()` | a request inside the minimum interval gets the rate error, per life |
| L | `stop()` does not cancel the backoff | stop ends a retry that is waiting out its backoff (5 s test timeout) |

Mutation D (refuse when full) passes the cap test on purpose: the map still never exceeds the cap, so only D2 proves the bound is what holds it.

## Open

- The Exposure decision (above), before AN-12.
- Not done in the fix pass: the limiter still records the slot before the read, so a failed read holds the slot, and a request inside the interval gets `rate` rather than the last good reply. `minIntervalMs` is not validated (NaN disables the limit).
- The oversize log line is not throttled.
- `have_version` from decision 0280 item 2 is not honoured: the reply is always full.
- The commit subject differs from the card (`feat(character): proficiency state service in the sink` against the card's `feat(character): sink service for proficiency state requests`).
- Live IT and the ops role checks are not run.
## Superseded (AN-11c)

The reply no longer carries `sheet` or `sheet_hash`. The sheet is operator-readable only (owner rule, settled by
geldar-93). The exposure notes above that list the sheet in the state reply no longer hold. See AN-11c for the
schema, service and cache changes.
