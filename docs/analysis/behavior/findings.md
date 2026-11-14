# Findings (status: open/sent/fixed/wontfix)

| id | status | owner | summary |
|---|---|---|---|
| F1 | sent | geldar-vitals / geldar-93 | Phantoms and skeleton arrows kill most agents at night on open ground |
| F2 | sent | geldar-ops | panic_burrow fails 904 of 938 firings in 24 h (no suitable block; seal out of reach at dawn) |
| F3 | sent | geldar-vitals | sleep refused: monsters nearby 211, not night 55, bed search time 39 in 6 h |
| F4 | sent | geldar-ops | give: "no such agent in sight" 110 of 295 gives; "too close to toss" 38 |
| F5 | open | geldar-93 (world) | food: eat "no food" 37, only 7 till/0 sow/harvest in 24 h; most agents carry none |
| F6 | sent | geldar-ops | goto busy/blocked/no_effect/interrupted 497 of ~2,450 |
| F7 | open | geldar-3b / geldar-93 | Tommy 22 deaths and Billy 15 in 24 h; deaths cluster in bursts (e.g. Tommy 21:51-21:55Z) |

## Notes from owners (2026-11-14 ~21:45Z)
- F6 (geldar-ops): no_effect false failures fixed by #345 (13:27Z); busy = executor rejects a new action while one runs (queue vs supersede is an open owner decision); blocked = real terrain; interrupted = reflex preemption; not_found = naming needs sight plus proximity (0145).
- F4: "too close" rows are mostly before #352 (16:12Z); re-check on a clean window after 21:20Z. A distance for an unseen agent is an information-policy question (0145): needs geldar-93/owner. Proposal: a fact "ag_x is not in line of sight" without distance.
- F2: night failures come from the no-threat trigger; 0213 (hostile within radius or damage in 5 s) is on branch phase1/body-batch-0213, not merged. Dawn "seal out of reach" is in panic-burrow.ts (vitals).
- Re-check after 21:20Z on a clean window; the 24 h totals in report 21Z include pre-fix periods.

| F8 | open | geldar-93 (owner options) | 8 of 16 MCP tools never called (propose, vote, write_book, read_book, define_skill, offer, see, use_skill) per geldar-economy; 48 h journals have 0 hits for vote/law/book |

F8 evidence (2026-11-14 21:5xZ, 48 h journals, 24 h speech): "offer" (133 journal hits) means informal handing over food, not the offer tool; "trade" 56 journal and 46 speech hits, mostly about a trader NPC and wheat seeds; "farm" 275 journal and 56 speech hits, with wheat 956 hits (agents talk about farming, 7 till actions, no sow). No agent has written a book or proposed a law. The social tools are not mentioned in agent text, so either they do not know them or the world gives no need (no scarcity that governance or trade solves, food comes from give). Owner options: (a) by design for now, wait until farming and surplus exist; (b) check the tool descriptions state mechanics facts (what a vote does, who sees a book); (c) world supply that makes trade matter (proposal only); never a prompt telling them to use them.
