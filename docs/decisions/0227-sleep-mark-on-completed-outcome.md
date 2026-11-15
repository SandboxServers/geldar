# 0227: The sleep mark and the "asleep" journal line wait for a completed sleep

- Status: Proposed (implementer; owner to accept). geldar-93 approved the design on 2026-11-15.
- Date: 2026-11-15
- Amends: the sleep mark and journal write of the MCP `sleep` tool and the `act` sleep path (`threshold/mcp/src/tools/sleep.ts`, `threshold/mcp/src/tools/act.ts`); adds `threshold/mcp/src/tools/sleep-completion.ts` and the settle step in `threshold/mcp/src/events/stream.ts`

## Context

The sleep mark (`lastSleepDay`, `cursor`) and the "asleep" journal line were written when the Body accepted the sleep plan, not when the sleep finished. Data from the live Mind shows the gap:

- 2026-11-15 11:40:27Z: journal 11157 reads "asleep". The Body had accepted the plan; the sleep had not happened.
- 2026-11-15 11:41:02Z: the Body reported the sleep plan `blocked`.
- 2026-11-15 11:41:27Z: journal 11158 reads "asleep" again, for the next attempt.
- 2026-11-15 11:41:34Z: the Body reported the sleep plan `completed`.

An agent that read its journal saw a sleep it had not had, and a blocked attempt advanced the mark, so the next sleep digested events the agent had not yet been told about as slept through.

## Decision

(a) The mark is written, and the "asleep" journal line appended, only on a `plan_result` whose sleep action is `completed`. A `failed`, `cancelled`, `running` or unknown outcome writes nothing; `accepted` and `running` keep the entry until the outcome is final. A sleep action cut short by an earlier failure in the same plan writes nothing.

(b) The `sleep` tool's accept result carries the real `days_since_sleep` (from the stored mark, not from the pending sleep), and the fixed event `Your body is going to sleep. The sleep has not finished.` The quiet digest (nothing new since the last sleep) does not add the `Nothing has changed` line. The quiet test (`sameAsLastSleep`) is pure: it reads the failure tracker and writes nothing. `recordSleep` runs when the Body accepts the plan, so "quiet" compares with the last accepted sleep, not the last completed one. A rare case follows: a sleep blocked, then a completed sleep at the same state with zero events since the mark, writes no `asleep` line, because the blocked attempt already counted as the last sleep.

(c) The `act` sleep path registers its sleep the same way: the entry is read before the plan is sent, and the mark is written by the same handler, with the journal line `Day N: asleep.` and no digest. An `act` sleep is not reported in a digest.

(d) The mark is monotonic: a settle keeps the later of the stored and the pending day and cursor, so a sleep that settles late never lowers it.

(e) The pending sleeps are held in memory, by life and thought, capped at 16 per life (the oldest is evicted). A death of the life clears them. An entry is removed only after its mark and journal writes both succeed; a store error keeps it, logs one payload-free line and rethrows, so the stream's retry loop runs the message again (up to 4 tries). The settle is idempotent, so a retry writes the mark and journal line once.

(f) A refused or failed submit removes its entry, so nothing waits for an outcome that will not come. The entry is added before the submit, so a `plan_result` that arrives during the submit still settles it.

## What `completed` means

`completed` means the bot lay down in a bed and `isSleeping` was true when checked at `golem/src/actions/sleep.ts:370`. It does not mean a full night, and it does not mean the agent woke. The action then waits up to `SLEEPERS_WAIT_MS` for the sleepers line and reports `completed` without re-checking, so the bot may be woken in between. A later action in the same plan may also wake it.

The journal line `Day N: asleep.` means the bot was confirmed asleep (lying in a bed) at that moment. It does not mean a full night.

An action that starts with the bot already asleep (`golem/src/actions/sleep.ts:222`) reports `completed` without lying down. The mark and the journal line are written for it all the same.

## Known limits

- A `plan_result` that never arrives leaves the mark unset. This covers a Body restart (the pending map is in memory and is lost), a publish failure, and an invalid payload. The late outcome is then dropped. A persisted pending table would avoid this, but it needs a migration; it is not chosen here.
- A settle whose store write fails rethrows into the stream's retry loop (4 tries, with a delay). If every try fails, the loop drops the message, and the sleep's mark and its journal line are lost: the entry stays in memory until the life dies, the 16-entry cap evicts it, or the process restarts. A later final `plan_result` for the same thought would still settle it, so a later outcome can write the mark and the line.
- The digest omits failures (F06). That is a separate issue and is not changed by this decision.
- `rest_stat` (decision 0225) stays operator-only. It is an independent cross-check of the sleep outcome and is not read by the agent.

## Consequences

- An agent's journal and its `days_since_sleep` count only the sleeps that completed. A blocked attempt leaves the mark where it was, so the next completed sleep digests everything since the last completed one.
- A sleep that the Body never reports leaves no journal line and no mark change. The operator sees it as a plan with no `plan_result` in the log.
- Deploy surface: the MCP image only. No contract change, no migration, no golem change.
