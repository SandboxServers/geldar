# Findings (status: open/sent/fixed/wontfix)

| id | status | owner | summary |
|---|---|---|---|
| F1 | sent | geldar-vitals / geldar-93 | Phantoms and skeleton arrows kill most agents at night on open ground |
| F2 | sent | geldar-ops | panic_burrow fails 904 of 938 firings in 24 h (no suitable block; seal out of reach at dawn) |
| F3 | sent | geldar-vitals | sleep refused: monsters nearby 211, not night 55, bed search time 39 in 6 h |
| F4 | sent | geldar-ops | give: "no such agent in sight" 110 of 295 gives; "too close to toss" 38 |
| F5 | wontfix (owner: no world edits) | geldar-93 | food: eat "no food" 37, only 7 till/0 sow/harvest in 24 h; most agents carry none |
| F6 | sent | geldar-ops | goto busy/blocked/no_effect/interrupted 497 of ~2,450 |
| F7 | open | geldar-3b / geldar-93 | Tommy 22 deaths and Billy 15 in 24 h; deaths cluster in bursts (e.g. Tommy 21:51-21:55Z) |

## Notes from owners (2026-11-14 ~21:45Z)
- F6 (geldar-ops): no_effect false failures fixed by #345 (13:27Z); busy = executor rejects a new action while one runs (queue vs supersede is an open owner decision); blocked = real terrain; interrupted = reflex preemption; not_found = naming needs sight plus proximity (0145).
- F4: "too close" rows are mostly before #352 (16:12Z); re-check on a clean window after 21:20Z. A distance for an unseen agent is an information-policy question (0145): needs geldar-93/owner. Proposal: a fact "ag_x is not in line of sight" without distance.
- F2: night failures come from the no-threat trigger; 0213 (hostile within radius or damage in 5 s) is on branch phase1/body-batch-0213, not merged. Dawn "seal out of reach" is in panic-burrow.ts (vitals).
- Re-check after 21:20Z on a clean window; the 24 h totals in report 21Z include pre-fix periods.

| F8 | open | geldar-93 (owner options) | 8 of 16 MCP tools never called (propose, vote, write_book, read_book, define_skill, offer, see, use_skill) per geldar-economy; 48 h journals have 0 hits for vote/law/book |

F8 evidence (2026-11-14 21:5xZ, 48 h journals, 24 h speech): "offer" (133 journal hits) means informal handing over food, not the offer tool; "trade" 56 journal and 46 speech hits, mostly about a trader NPC and wheat seeds; "farm" 275 journal and 56 speech hits, with wheat 956 hits (agents talk about farming, 7 till actions, no sow). No agent has written a book or proposed a law. The social tools are not mentioned in agent text, so either they do not know them or the world gives no need (no scarcity that governance or trade solves, food comes from give). Owner options: (a) by design for now, wait until farming and surplus exist; (b) check the tool descriptions state mechanics facts (what a vote does, who sees a book); (c) world supply that makes trade matter (proposal only); never a prompt telling them to use them.

| F9 | fixed pending re-measure (0224 #424, merged 02:39Z; deploy time pending) | geldar-vitals | sleep retried while a named hostile stays within range (98 of 181 refusals in 90 min named a phantom at 4 blocks); proposal: a fact for how long the hostile has been in range |

| F10 | open (not yet sent) | geldar-ops | agents avoid iron golems and mention them 549 times in 12 h journals, but no record shows a golem hurting anyone; damage events carry no attacker type. Proposal: record attacker type in damage events; check how the Body lists golems next to hostiles (facts only, e.g. not hostile) |

| F11 | sent (geldar-ops scoped; geldar-93 approved facts-only) | geldar-ops | first wheat plots have no water nearby and till/place results say only "worked"; hydration fact on ok till and place, till refusal naming the cause, place-on-own-tile wording; ok detail_text needs the threshold allow-list extended (contract slot with geldar-93/3b); hurt log gets attacker (log only) for F10 |

F8 update (2026-11-15, geldar-worldops): the Shrine and Moot Stone do not exist in Colo and governance code is not live, so offer, propose and vote have no backend. Zero calls is therefore expected, not a harness knowledge gap. Open question for geldar-93 and the owner: state in the tool result that these are not available yet, or stop advertising them. Backends of write_book, read_book, define_skill, use_skill not yet confirmed.

F11 plot facts (geldar-worldops, read-only, 2026-11-15 about 03:36Z): farmland at (-265,65,323) and (-266,65,323) with wheat above both, both moisture 0 (dry), dirt below, grass neighbours, no water found at y=65 within radius 4 (partial scan), light 15. Riker's farmland at (-263,65,323) (03:28:50Z) is grass again with no logged change (undiagnosed); another at (-264,65,326) 03:33:36Z. Confirms the hydration fact would tell them the truth. Re-check: do plots with a crop survive, and does the wheat ripen at all.

F8 backend check (2026-11-15, origin/main): threshold/mcp/src/tools/unavailable.ts marks write_book, define_skill, use_skill, offer, propose, vote as not running; each answers "This is not available in this world yet." and records a not_available sovereign_call. read_book has a handler but no agent can write a book. Owner ruled: hide offer, propose and vote (flag, off for Colo); the other three fall under the same ruling. Zero outcomes in events for all four checked tools.

| F12 | open (not sent) | geldar-93 / owner | agents get saplings from leaves (24 journal mentions in 12 h, 4 dropped by Zack and 2 by Riker on death) but there are zero place actions on a sapling in 24 h. The Body has no sapling code and the kit has no tree text. Facts only could say what a sapling needs; no coaching |

F11 update (geldar-ops via geldar-93): the Body has no revert path for tills. Riker's till at (-263,65,323) was farmland at 03:28:49Z; the seed place at 03:28:55Z failed "seeds need farmland below", so the cell stopped being farmland about 6 s later. Same at (-264,65,326). Tills since 03:00Z: 4 ok, 6 failed. Likely cause (unverified): dry farmland with no crop reverts to dirt. Ship time of the hydration fact: pending.

| F13 | open | geldar-ops / geldar-93 | `use` has 1 ok of 40 since 02:57Z; 35 are agents using it on a bed or to sleep ("that block is a bed" 21, "sleeping is the sleep verb" 14). The refusals already state the fact; check whether the tool description says what use covers (doors, gates, trapdoors, buttons, levers, seeds, bone meal) |
| F14 | sent (accepted as 0226, after 0225 merges) | geldar-vitals / geldar-worldops | 7-8 beds found per attempt against 18-19 agents, 8-9 asleep needed; best 4 of 8. Need the real bed count; proposal: fact "N beds within R blocks, M occupied" in the sleep result |
