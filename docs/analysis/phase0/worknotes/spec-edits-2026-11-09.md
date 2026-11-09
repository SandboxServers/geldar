# Spec edits, 2026-11-09 (owner-authorised, decisions 0042, 0045, 0047)

All edits are in `docs/spec.md`; no line was added or removed, so line numbers are unchanged.

## 1. Section 5.14 retitled and time dilation removed (decisions 0038, 0047)

| Line | Before | After |
|---|---|---|
| 36 | TOC: 5.14 Shards and Time Dilation | 5.14 Shards and Time |
| 144 | Tick: "Normally 20 per second. We slow this down (see 5.14)." | "20 per second on every shard (see 5.14)." |
| 794 | heading: Shards and Time Dilation | Shards and Time |
| 818 | "Time dilation:" paragraph (`/tick rate`, not validated, test at 20/10/5, start at 20) | "Time:" paragraph: shards run at 20 TPS; thinking time comes from intents, waits, wake conditions, reflexes (5.2, 5.3); Mineflayer physics runs on its own 50 ms timer so `/tick rate` does not slow the Body (0038, 0047). Kept: measure achieved tick duration, three clocks in every log line, money on wall time only (5.7), the timer table lead-in |
| 824 | timer row reason: "Legitimate actions take longer under dilation" | "Actions take world time" |
| 829 | alerts on mspt vs target | unchanged (kept) |

## 2. Dilation removed as the hardware lever

| Line | Before | After |
|---|---|---|
| 543 | "...how long legitimate world actions take, which under time dilation can be long" | "...which can be long" |
| 616 | "Time dilation (5.14) is the lever when hardware is the limit: halve the tick rate..." | "When hardware is the limit, capacity is controlled by the population target, more Body hosts and lower view distance (decision 0047)." |
| 715 | governance list: "Tick rate (time dilation, 5.14)" | "Tick rate" |
| 745 | "(can be long under dilation)" | "(can be long)" |
| 1381 | "...; time dilation trades world speed for inference time per simulated interval." | sentence ends after "failures." |
| 1401 | "All phases start at 20 TPS. Time dilation is adopted only after the dilation tests in 5.14 pass on a scratch shard." | "All phases run at 20 TPS." |
| 1434 | Phase 4: "time dilation tuned" | "population and host sizing tuned" |
| 1488 | risk row "Server can't hold 100+ bots": mitigation "time dilation" | mitigation dropped |
| 1793 | `tick_rate: 20  # dilation only after 5.14 tests pass` | `tick_rate: 20  # fixed (decision 0047)` |
| 2109 | review row 13 (historical) | appended "(superseded: decision 0047)" |

### Round 2 (owner-approved): no tick-rate law

Governance no longer changes the tick rate. The "Tick rate" item is removed from the governance list (line 715). The governance row in Appendix F now reads "apply gamerule / config and publish `law`". The Appendix F "Tick rate" row now reads "Startup | Set from shard config at startup only (20 on every shard, decision 0047); governance does not change it". The flag below is resolved.

### (Resolved) governance can still change the tick rate

Line 715 now reads just "Tick rate" in the list of things the Moot Stone can govern, and line 1839/1840 (governance row "on pass, apply gamerule / tick rate / config"; Appendix row "Tick rate: Startup, `law`: Apply `/tick rate` from shard config or law") still say a law can apply `/tick rate`. I left 1839 and 1840 untouched as they were not on the list. Decide whether a law may still change the tick rate for non-Body purposes, or whether those two rows and the list item should go.

## 3. Release criterion (decision 0045), line 1292

"A kit release ships only if no test reaches the host, the config, or the remote." became "A kit release ships only if the deterministic CI checks pass and the owner has run the live malicious-book check on the kit since its last change. The live check is local and owner-run, never in CI (decision 0045)." The rest of the bullet is unchanged.

## 4. Session path rule (decision 0042): added in round 2 (owner-approved)

Round 2 added a "Session path rule" paragraph in 5.15.4, after "Books into repos". It says a session may write only under `memory/` and `skills/` (matching 5.15.7, line 1288 and Appendix J); `memory/identity.md` is write-once and locked; any path whose ASCII-lowercased form starts with `memory/identity.md/` is rejected in every mode (decision 0042); and the host re-check, required of the gate, also rejects an added path whose case-folded form collides with an existing path in the start tree. Round 1 had not found a place for it; the text below is the round 1 note.

The spec has no section stating which paths a sovereign player's session commit may touch. Searched for identity.md, path rule, session commit, allowed paths, case-insensitive. Only related text: 5.15.4 tree (line 929, `memory/identity.md` "write-once"), 5.15.6/7 (line 967, edits allowed under `memory/` and `skills/`; line 1288, settings.json allows edits only under `memory/` and `skills/`; line 1996, `Edit(...)` path rules in the permission policy). None is a commit-gate path rule that locks `memory/identity.md`, so the `memory/identity.md/` rejection and the start-tree case-collision re-check were not added. The owner should say where that rule belongs (or whether it lives only in the Scriptorium spec).

## Occurrences left unchanged

| Line | Text | Why left |
|---|---|---|
| 11, 626, 1358, 1379 | "baseline tick rate (of 10)" in the in-game-day arithmetic and the v0.6 correction history | Historical cost-model explanation, not dilation as a mechanism |
| 1413 | Phase 1 "no time dilation" | Consistent with the decision (a negation) |
| 818 | "`/tick rate` does not slow the Body" in the Time paragraph | Explains why dilation is not used; consistent |
| 1425 | Phase gate (6) | Edited in round 2: gate is the Body benchmark at 20 TPS at 100%; the 10 and 5 TPS rows are informational findings, not part of the gate (owner). Decision 0047 item 4 corrected to match |
| 1839, 1840 | governance / Tick rate rows | Edited in round 2, see above |

Round 2 grep of `tick rate` and `/tick` in the spec: the remaining hits are lines 11, 626, 1358, 1379 (baseline tick rate 10 in historical arithmetic, left), 818 (above), and the Appendix F "Tick rate" row (edited). No other hit offers a tick-rate law.
| 2100, 2102, 2114 | review rows citing 5.14 for Commons vs research, one-variable shards, per-tier deadlines | They do not claim dilation tests |
