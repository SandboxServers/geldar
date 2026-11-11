# Phase 1 decision-number registry and integration decisions

Status as of 2026-11-10, branch `docs/phase1-reconcile`. Integration step for the five wave packet files (c1, c2, c2b, c3, c4). It records what each number is for, the clashes found and how each was resolved, the prompt-version reservation, the soak question, and the consistency checks.

## Rule

Only the numbers in a packet's own row may be used. A packet that needs a record and has no number in its row writes a worknote question; the orchestrator reserves a number. No record reuses a number.

## Registry

| Number | Block | Owner (packet) | Use | Status |
|---|---|---|---|---|
| 0053 | existing | C2-00 | Status line only: superseded by 0071 | Accepted, to change to Superseded in C2-00 |
| 0071 | existing | none | Public topology (Caddy, Cloudflare not wired) | Accepted |
| 0072 | existing | none | Glass and BlueMap public, read-only | Accepted |
| 0075 | existing | none | Glass is a Lakitu camera | Accepted |
| 0076 | pre-packet | owner | Backup scope and destination | Accepted (owner 2026-11-10); destination and build deferred (0130) |
| 0077 | pre-packet | owner | Invitee auth and the login rule | Proposed; owner confirms before C2-01, C2-07 |
| 0078 | pre-packet | owner | Mind placement for Phase 1 | Accepted (owner 2026-11-10) |
| 0079 | pre-packet | owner | Credit numbers and charge rules | Proposed; owner confirms before C4-04, C4-05 |
| 0080 | pre-packet | owner | NATS auth cutover | Accepted (owner 2026-11-10) |
| 0081 | C1 | C1-00 | Colo contract and gate definitions | Proposed |
| 0082 | C1 | C1-02 | Colo compose layout, ports and binds. C1-09 may extend it | Proposed |
| 0083 | C1 | C1-03 | Image contents, base pins | Proposed |
| 0084 | C1 | C1-04 | Deploy by pull | Proposed |
| 0085 | C1 | C1-05a | Append-only journals, reset rule | Proposed |
| 0086 | C1 | C1-05b | Backup v1 | Proposed |
| 0087 | C1 | C1-06a | NATS overlay live rules. Also covers C1-06b (cited, not added) | Proposed |
| 0088 | C1 | C1-07 | Exporters and replay window | Proposed |
| 0089 | C1 | C1-08 | Crash-window rules | Proposed |
| 0090 | C2 | C2-00 | Public MCP contract | Proposed |
| 0091 | C2 | C2-01 | Invitee token issuing | Proposed |
| 0092 | C2 | C2-02 | Velocity spectator whitelist and ghost rule | Proposed |
| 0093 | C2 | C2-03 | Glass hardening | Proposed |
| 0094 | C2 | C2-04 | BlueMap public, snippet, kill switch | Proposed |
| 0095 | C2 | C2-05 | Look projection cleanup | Proposed |
| 0096 | C2 | C2-07 | Public topology as built, NATS default-on | Proposed |
| 0097 | C2 | C2-R1 fix round | Only if needed | reserved |
| 0098 | C2 | C2-R2 fix round | Only if needed | reserved |
| 0099 | C2 | C2-R3 fix round | Only if needed | reserved |
| (none) | C2 | C2-06 | No record unless the orchestrator reserves one | none |
| (none) | C2 | C2-R4 | Reviews write no record. The C2 block is full. A fix-round record needs a number from the orchestrator | none |
| 0100 | C2b | C2b-00 | Lakitu feed contract | Proposed |
| 0101 | C2b | C2b-01 | Feed plugin, invisibility, cap | Proposed |
| 0102 | C2b | C2b-02 | Relay and login roles | Proposed |
| 0103 | C2b | C2b-03a, 03b, 03c | Renderer and camera (one record, sections per card) | Proposed |
| 0104 | C2b | C2b-04 | Invisibility test | Proposed |
| 0105 | C3 | C3-00 | Sovereign rows, wait cursor, roster | Proposed |
| 0106 | C3 | C3-01 | Sovereign intent rows | Proposed |
| 0107 | C3 | C3-02 | Honest sleep mark | Proposed |
| 0108 | C3 | C3-04 | Roster and cap source | Proposed |
| 0109 | C3 | C3-05 | prepared receipt and per-life cursor | Proposed |
| 0110 | C3 | C3-06 | Body crash reconciliation | Proposed |
| 0111 | C3 | C3-07 | Bench pass rule and harness checks | Proposed |
| 0112 | C3 | C3-09 | Chaos-day scripts | Proposed |
| 0113 | C3 | C3-10 | C3 roll-out record | Proposed |
| 0114 | C3 | C3-03 | Enclosed rest and shelter intent (moved from 0107) | Proposed |
| 0115 | C4 | C4-00 | Contract: chat, books, credits, life, Thinker | Proposed |
| 0116 | C4 | C4-01 | Proximity chat | Proposed |
| 0117 | C4 | C4-02a | Books and skills | Proposed |
| 0118 | C4 | C4-02b | Procedure library | Proposed |
| 0119 | C4 | C4-03 | Sleep reflection and hibernation | Proposed |
| 0120 | C4 | C4-04 | Credits allowance | Proposed |
| 0121 | C4 | C4-05 | Shrine pool, offers, server life IDs | Proposed |
| 0122 | C4 | C4-06 | Wake wording and due_tick (prompt work is v7, see below) | Proposed |
| 0123 | C4 | C4-07 | Thinker gateway | Proposed |
| 0124 | C4 | C4-07 | Thinker identity | Proposed |
| 0125 | C4 | C4-08 | Phase 1 exit run | Proposed |
| 0126 | C4 | owner | Shrine exit wording ruling. No packet writes it | reserved for owner |
| 0127 to 0129 | C4 | none | Spare in the C4 block | free |
| 0130 | after block | owner (ruling 2026-11-10) | Phase 1 owner rulings for C1 and the test schedule (deploy access, backups deferred, SigNoz, long tests at the end of the phase). Written by the owner-ruling docs packet | Accepted (owner ruling) |
| 0131 | after block | orchestrator | First free number after 0130 | free |

## Clashes and how they were resolved

- **0087 (C1-06a and C1-06b).** One record covers both. C1-06a writes 0087. C1-06b cites it and adds no record.
- **C1-09 (no number).** Decision: none. C1-09 extends 0082 or writes a worknote question. The 0081 to 0089 block is full.
- **C2-R4 (no number).** The C2 block 0090 to 0099 is full (0090 to 0096 by the cards, 0097 to 0099 by the fix rounds). So there is no "next free number in the C2 block". R4 gets none. A needed record is requested from the orchestrator, from 0130 on.
- **C2-06 (none).** Unchanged: none, unless the orchestrator reserves one.
- **0107 (C3-02 and C3-03).** C3-02 keeps 0107. C3-03 takes the spare 0114 and its card is updated (decisions line, record step 7, commit message, index line).
- **0114 (C3-03 and C3-10).** The C3 block is full after 0114. C3-10 keeps 0113 only. Its ruling record for O-soak, if the owner asks for one, needs a number from the orchestrator.

## Prompt version reservation

- v5 is the released default. It is not edited.
- v6 is reserved for C3-03 (`prompts/thought/v6.md`, a copy of v5 that renders `enclosed`).
- v7 is reserved for C4-06. The brief for this step said "v6". That would clash with C3-03, which merges first, so the reservation is v7. C4-06 must create a new version and must not edit v1 to v6.
- Status: the C4-06 card still says "v5" in its title, may-edit and checks. Not yet changed (see open items).

## Open owner question: soak length (O-soak)

Single open question, stated the same way in c3-packets.md (section 8, section 10.5, C3-10) and in c4-packets.md (section 10.4 to 10.6), which is not yet edited (see open items). The options:

- (A) The wave schedule: a 72-hour soak gates C3, and a 7-day run happens once after C4 freeze as the exit run.
- (B) plan.md: a 7-day soak.

Not decided here. plan.md itself is not edited by this step (it is not in the packet files this step owns).

## Consistency checks

- **C4-05 depends on C3-05 (`prepared` receipt).** Result: consistent. C3-05 step 1 writes the `prepared` receipt before `runtime.runAction`, keyed by `receiptIdFor(actionId, 'prepared')`. C4-05 step 2 needs exactly that: a repeated offer with the same action id returns the first `prepared` receipt. No change to C3-05. Still open: C4-05 should name the receipt id it looks up (not yet edited).

## Open items (not done in this step)

Done:

- C4-06 card and the C4 wave section say v7 (was v5).
- C4-05 names the receipt id it looks up.
- C4 sections 10.4 to 10.6 and the ledger text state the soak as O-soak, not settled.
- Ledger `docs/analysis/phase1/ledger.md` is created.
- `docs/analysis/phase1/RESUME.md` is created.
- Phase 0 RESUME and README point at the written retro and the next free number 0130.

Still open:

- The ledger README "pending" retro line.
- O-soak itself: the owner must answer option (A) or (B) in writing (c3-packets.md section 8 and 10.5, c4-packets.md 10.5).
- `./geldar.ps1 check` result: see the report.
