# Phase 1 ledger

Status as of 2026-11-11 (orchestrator night log: `worknotes/orchestrator-2026-11-11.md`); first written 2026-11-10 on branch `docs/phase1-reconcile`. One row per wave packet, taken from the ledger-row tables of the five wave files: `packets/c1-packets.md` (Ledger rows), `packets/c2-packets.md` (5.3), `packets/c2b-packets.md` (Ledger rows), `packets/c3-packets.md` (10.4), and `packets/c4-packets.md` (10.7). Where a table has no `depends` or `lane` column (c2b, c3), those come from the card's `depends-on` and `lane` lines.

Conventions:

- **id** is the short form used in the wave tables (`C1-00`, `C2b-00`, `C3-00`). A card may write the same packet as `P1-C1-00` or `P1-C2b-00`; it is the same packet.
- **status** is copied from the wave file. `B` means buildable now. `O` means it waits on an owner answer or on access. `planned` is the C2 wave's own word.
- **decision numbers** come from `packets/decision-number-registry.md`. A row with no number writes no record.
- **owner-blocked?** is `Y` when the status carries `O`, or when the registry says an owner confirmation (0076 to 0080) gates the packet. The reason is in brackets.
- Campaign rows (10.8 of c4, CAMP-C4-A to E) are not wave packets and are not listed here. They are in `packets/c4-packets.md` section 10.8.

The Phase 0 ledger README (`docs/analysis/phase0/README.md`) is not edited by this file.

| id | title | wave | lane | depends | status | decision numbers | owner-blocked? |
|---|---|---|---|---|---|---|---|
| C1-00 | Contract for the colo shard, repo gates | C1 | A | none | merged (#49) | 0081 | N |
| C1-01 | Split over-500 files, quarantine flaky tests | C1 | B | none | partial (#52, #54): flaky-test clock seams and two soft-cap files open (worknotes P1-C1-01, P1-C1-01b) | none | N |
| C1-02 | Integration: colo compose, shard config, geldar.ps1 | C1 | A | C1-00 | merged (#55); owner live step in C1-10 | 0082 | Y (owner items) |
| C1-03 | Body-host and Mind-host images | C1 | C | C1-00 | merged (#51) | 0083 | N [0078 accepted, 0130] |
| C1-04 | Non-PowerShell deploy by pull | C1 | D | C1-00 | merged (#62) | 0084 | N [runner or owner SSH, 0130] |
| C1-05a | Append-only journals, reset creates a new shard | C1 | E | C1-00 | merged (#60) | 0085 | N |
| C1-05b | Backup v1 per 0076 | C1 | E | C1-00, C1-05a | deferred (0130) | 0086 | N [deferred by 0130] |
| C1-06a | NATS overlay live test (owns `compose/nats-auth.yml`) | C1 | F | C1-00 | merged (#53) | 0087 | Y [0080] |
| C1-06b | Component credential reads | C1 | F | C1-06a | merged (#57) | 0087 (cited, no new record) | N |
| C1-07 | Metrics exporters, replay bound | C1 | C | C1-00 | merged (#58) | 0088 | N [SigNoz, 0130] |
| C1-08 | Crash hygiene | C1 | D | C1-00 | merged (#59) | 0089 | N |
| C1-09 | BlueMap pinned, internal | C1 | B | C1-00 | merged (#56) | none (extends 0082) | N |
| C1-10 | Node deploy, restore test, first ranger, smoke, load | C1 | ops | C1-02 to C1-09 | O: owner on the node (first ranger, no degradation) | none | N [node via runner or SSH, 0130] |
| C1-11a | Sovereign services on the colo stack (MCP, players host) | C1 | ops fix | C1-02 | merged (#73) | none | N |
| C1-11b | Colo admin tooling (one-shot admin container) | C1 | ops fix | C1-02 | merged (#75) | 0133 | N |
| C2-00 | Contract unblocker for the public surfaces | C2 | A | C1-00 | in progress (2026-11-11) | 0090 | N |
| C2-01 | Public MCP behind Caddy | C2 | A | C2-00 | planned | 0091 | Y [0077] |
| C2-02 | Velocity on the new TCP port | C2 | B | C2-00 | in progress (2026-11-11) | 0092 | N |
| C2-03 | Glass hardening (0072) | C2 | C | C2-00 | planned | 0093 | N |
| C2-04 | BlueMap public through Caddy | C2 | D | C1-09, C2-00 | in progress (2026-11-11) | 0094 | N |
| C2-05 | Look projection cleanup and MCP image slimming | C2 | E | C2-00 | in progress (2026-11-11) | 0095 | N |
| C2-06 | External port scan tool | C2 | F | C2-00 | in progress (2026-11-11) | none | N |
| C2-07 | Integration, public deploy, scan, live run | C2 | A | C2-01 to C2-06, 0077, 0080 | planned (O) | 0096 | Y [0077, 0080, node access] |
| C2-08a | Identities table and the register role | C2 | G | none | planned | 0135 | N |
| C2-08b | Register service: GitHub and Discord sign-in | C2 | G | C2-08a | planned | 0135, 0136 | N |
| C2-08c | Deploy wiring for register | C2 | G | C2-08a | planned | none | Y [owner creates the OAuth apps] |
| C2-08d | Per-player Body lifecycle (gate for turning registration on) | C2/C3 | G | C3-04, C1-11a | planned | none | N |
| C2-R1 | Review: MCP public endpoint | C2 | R | C2-00, C2-01, C2-05 | planned | none (fix round 0097 only if needed) | N |
| C2-R2 | Review: Velocity and public Minecraft port | C2 | R | C2-02, C2-07 desktop | planned | none (fix round 0098 only if needed) | N |
| C2-R3 | Review: Glass and BlueMap | C2 | R | C2-03, C2-04 | planned | none (fix round 0099 only if needed) | N |
| C2-R4 | Review: NATS, node and Caddy | C2 | R | C2-07 desktop | planned | none | N |
| C2-R5 | Fix round for C2-R1 to R4 | C2 | R | C2-R1 to R4 | planned | 0097 to 0099 only if needed | N |
| C2b-00 | Lakitu feed contract | C2b | A | C1-00 | B | 0100 | N |
| C2b-01 | Geldar-Core Lakitu feed plugin | C2b | A | C2b-00 | B | 0101 | N |
| C2b-02 | Lakitu relay, login roles, cap, audit | C2b | B | C2b-00, C2b-01 | B (login needs 0077) | 0102 | Y [0077] |
| C2b-03a | Voxel mesher and scene, placeholder palette | C2b | C | C2b-00 | B | 0103 | N |
| C2b-03b | Follow, orbit, free, collision | C2b | C | C2b-03a | B | 0103 | N |
| C2b-03c | Multi-pane page, target picker | C2b | D | C2b-03a, C2b-03b, C2b-02 | B (live login is O) | 0103 | Y [0075 point 5, 0077] |
| C2b-04 | Leak test, cap test, parity test | C2b | E | C2b-01, C2b-02 | B | 0104 | N |
| C2b-05 | Integration, texture swap, live browser run | C2b | A | C2b-03c, C2b-04, C2-03 | B/O | none | Y [texture licence, login] |
| C3-00 | Sovereign intent source, wait cursor, roster schema | C3 | A | C1-00 | B | 0105 | N |
| C3-01 | Sovereign intent, action and receipt rows | C3 | A | C3-00 | B | 0106 | N |
| C3-02 | Honest sleep mark | C3 | B | none | B | 0107 | N |
| C3-03 | Build handler, shelter intent, prompt v6 | C3 | C | C3-00, C3-02, C3-05 | B | 0114 | N |
| C3-04 | Roster and owner cap in the database | C3 | D | C3-00, C1-08 | B | 0108 | N |
| C3-05 | Prepared receipt and per-life wait cursor | C3 | E | C3-00 | B | 0109 | N |
| C3-06 | Body crash reconciliation on boot | C3 | E | C3-05, C3-00 | B | 0110 | N |
| C3-07 | Bench for N = 1, 5, 10, 15 | C3 | F | C1-10, C3-06 | build now, run at campaign end (0130) | 0111 | N [long run at campaign end, 0130] |
| C3-08 | C3 runbooks | C3 | F | none | B | none | N |
| C3-09 | Chaos scenario scripts and runner | C3 | F | C3-06, C3-08, C1-05b | build now, run at campaign end (0130) | 0112 | N [chaos day at campaign end, 0130] |
| C3-10 | Roll-out, chaos day and soak gate | C3 | A | C3-01 to C3-09, C1-10 | build now, run at campaign end (0130) | 0113 | Y [O-3, at campaign end; soak gate resolved by 0130] |
| C4-00 | Contract unblocker: chat, books, credits, life, hibernation, Thinker enrolment | C4 | A | C3-00 | B | 0115 | N |
| C4-01 | Proximity chat and the attention test | C4 | A | C4-00 | B | 0116 | N |
| C4-02a | Books and skills: copy stamp and learned_from | C4 | B | C4-00 | B | 0117 | N |
| C4-02b | Procedure library: the mechanism demo | C4 | B | C4-02a | B (numbers O) | 0118 | Y [demo pass bar] |
| C4-03 | Sleep reflection and hibernation | C4 | C | C4-00, C3-02 | B (live hour O) | 0119 | Y [live hour, 0078] |
| C4-04 | Credits allowance: reserve before dispatch, refund on failure | C4 | D | C4-00, 0079 | B (numbers O) | 0120 | Y [0079] |
| C4-05 | Shrine pool and birth: idempotent offers, server life IDs | C4 | E | C4-00, C3-05, 0079 | B (values O) | 0121 | Y [0079] |
| C4-06 | Prompt v7 and wake wording | C4 | C | C4-01, C4-02b, C4-03 | B | 0122 | N |
| C4-07 | Thinker gateway: per-Thinker NATS users, enrolment | C4 | F | C4-00, 0078, 0080 | B; enrolment O | 0123, 0124 | Y [0078, 0080, enrolment] |
| C4-08 | Integration and ops: Phase 1 exit run on the node | C4 | G | C4-00 to C4-07 | O | 0125 (0126 owner ruling, not used by a packet) | Y [0126] |

## Wave C5: Goldar learnings, Body parity and the unavailable tools

Cards: [packets/c5-goldar-packets.md](packets/c5-goldar-packets.md). Review: [worknotes/goldar-review.md](worknotes/goldar-review.md). Statuses: Ready, BlockedDecision, Writing.

| id | title | wave | lane | depends | status | decision numbers | owner-blocked? |
|---|---|---|---|---|---|---|---|
| C5-00 | Contract unblocker: outcome and death events, new tools | C5a | A | none | Ready | 0143 | N |
| C5-01 | Soft-dig pathing and fast stall-then-replan | C5a | B | none | BlockedDecision (0141, 0142 Proposed) | 0141, 0142 | Y [confirm numbers] |
| C5-02 | Per-action outcome events and `why` wording | C5a | C | C5-00 | Ready | 0143 | N |
| C5-03 | Death event and `died_at` | C5a | D | C5-00 | Ready | 0144 | N |
| C5-04 | `give`, `note`, `follow` with line of sight | C5a | E | C5-00 | Ready | 0145 | N |
| C5-05 | Crafting hardening | C5b | F | C5-02 | Ready | none | N |
| C5-06 | Smelting on the 0037 click machinery | C5b | F | C5-05 | Ready (sequential after C5-05) | none | N |
| C5-07 | `write_sign` and `build` programs | C5b | G | C5-00 | Ready | none | N |
| C5-08 | `write_book` | C5c | H | C4-00, C4-02a | BlockedDecision (0146 item 1) | 0146 | Y |
| C5-09 | `propose` and `vote`, social laws only | C5c | H | C5-08 | BlockedDecision (0146 item 2) | 0146 | Y |
| C5-10 | `offer` and the Shrine (plugin consumes items) | C5c | H | C5-09, C4-05 | BlockedDecision (0146 item 3, owner approval) | 0146 | Y |

## Wave PX: perception for body and mind

Cards: [packets/px-perception-packets.md](packets/px-perception-packets.md). Decision: [0154](../../decisions/0154-perception-owner-rulings.md) (owner rulings, Decided). Statuses: Ready, BlockedDecision, Writing. Each card's branch is `phase1/px-<id>-<slug>`.

| id | title | wave | lane | depends | status | decision numbers | owner-blocked? |
|---|---|---|---|---|---|---|---|
| PX-0 | Death fields: per-life counter, location, drops, respawn point (C6-DEATH) | PX | A | C6-BODY-EVENTS, C5-03 | Ready after deps | 0144 | N |
| PX-1 | Hurt event with source and bearing | PX | A | C6-BODY-EVENTS, C5-00 | Ready after deps | 0154 | N [live: pending] |
| PX-2a | Entity coordinates and item names | PX | A | none | Built, in review | 0154 | N |
| PX-2b | Threat reading and sight for reflexes | PX | B | PX-2a | Ready after deps | 0154 | N |
| PX-3a | Sun phase, ground below, trapped state | PX | B | PX-2a | Ready | 0154 | N |
| PX-3b | Light, health trend, regeneration rule | PX | B | PX-3a | Ready | 0154 | N [threshold checked in card] |
| PX-3c | Armour, status flags, air, tool wear | PX | B | PX-3b | Ready | 0154 | N |
| PX-4 | Heard sounds as compass and band | PX | C | PX-1, PX-2b | Ready after deps | 0154, 0143 | N |
| PX-5 | Hazard list and line of sight for block counts | PX | C | PX-3c | Ready | 0154 | N |
| PX-6 | Furnace state, remembered containers, `recall` | PX | C | PX-3c | Ready | 0154 | N |
| PX-7 | Reflex use: hiss, arrows, dark (body only) | PX | D | PX-1, PX-4 | Ready after deps | 0154 | N |
| PX-8a | `reach` dry run in the Body | PX | D | PX-2a, C5-01 | Ready after deps | 0154 | N |
| PX-8b | `reach` tool, free of credits | PX | D | PX-8a | Ready after deps | 0154 | N |

## Wave C7: User management, bodies as a service, terms before sign-up

Cards: [packets/c7-user-management-packets.md](packets/c7-user-management-packets.md) and [packets/c7b-packets.md](packets/c7b-packets.md). Plan (graph, waves, migrations, live lane): [packets/c7-wave-plan.md](packets/c7-wave-plan.md). Decisions: 0151 to 0153, 0155, [0170](../../decisions/0170-owner-management-values-and-admin-flag.md), [0171](../../decisions/0171-account-erasure-rule.md), [0172](../../decisions/0172-human-skin-upload-held-for-approval.md) (Decided). Owner questions Q1 to Q8 are answered (2026-11-13). Statuses: Ready, Waiting (on a packet), Done.

| id | title | wave | lane | depends | status | decision numbers | migration | owner-blocked? |
|---|---|---|---|---|---|---|---|---|
| C7-01 | Sessions that survive a restart | W0 | A | none | Done (0021) | none | 0021 | N |
| C7-08 | Terms, privacy notice, consent (v1 approved) | W0 | E | none | Done (0022; 0155) | 0153, 0155 | 0022 | N |
| C3-04s | DB roster slice (first packet) | W1 | D | C1-08 | Done (merged bbb5ed6b, PR #315) | 0108 | 0024 (applied on node) | N |
| C7-12 | Admin flag, operator CLI, audit table base | W1 | A | none | Done (merged bbb5ed6b, PR #315) | 0170 | 0025 (applied on node) | N |
| C7-03a | Colo body supervisor (package, quotas, audit) | W1 | B | C3-04s, C7-12 | Done (merged bbb5ed6b, PR #315). Package only: no NATS binding, Postgres adapter or Docker client (C7-03b) | 0151, 0152, 0170 | 0027 (applied on node) | N |
| C7-02a | Player token lifecycle | W1 | A | C7-12 | Done (merged bbb5ed6b, PR #315). SQL and service only: route wiring, server.ts limiter admin exemption and account.ts token lines go to C7-04 and C7-06 | 0170 | 0032 (applied on node; orchestrator ruling) | N |
| C7-02b | Owner API keys | W2 | A | C7-02a | Built (review pass 4 ship); merge pending (to merge with PR #321) | 0152, 0170 | 0026 | N |
| C7-05 | Onboarding and corrected players README | W2 | C | C7-02a | Built (review pass 4 ship); merge pending (to merge with PR #321) | 0151 | none | N |
| C7-03b1 | Supervisor NATS contract, user binding, request/reply transport | W2 | B | C7-03a | Built (review pass 4 ship); merge pending (to merge with PR #321) | 0067, 0152 | none | N (node auth edits are in the C7-03b2 runbook) |
| C7-03b2 | Supervisor compose service, deploy script, budget, runbook (geldar-93 MERGE/DONE, no network recreate) | W3 | B | C7-03b1, C7-03b3 | Blocked (needs C7-03b1 and C7-03b3 merged; geldar-93 DONE) | 0082, 0152 | none | Y [contact geldar-93; owner approves the node change] |
| C7-03b3 | Supervisor Postgres adapter and Docker client | W2 | B | C7-03a, C3-04s, C7-12 | Built (review pass 4 ship); merge pending (to merge with PR #321) | 0108, 0152, 0170 | 0033 (`sql/0033_supervisor_display_name.sql`) | N (live start is pending, after C7-03b2) |
| C7-04a | Owner API core: route tree, auth, problem errors, limiter admin exemption, onAuditLost (split of C7-04) | W2 | B | C7-02b, C7-12 | Built (commit e20bf608, on the wave 3 branch) | 0152, 0170 | none | N |
| C7-04b | Owner API agents and tokens resources, owner-key routes, onboarding hand-off (split of C7-04) | W2 | B | C7-04a | Built except PATCH; PATCH moved to C7-06 (branch phase1/c7-04b5-wiring; migrations 0035 and 0036; pending merge into wave 3) | 0152, 0170, 0173 | 0035, 0036 | N |
| C7-04b-3 | Owner keys by cookie session: session SQL, Postgres adapter, service (split of C7-04b; token and key routes cookie-only in v1) | W2 | B | C7-04b | Built (branch phase1/c7-04b3-session-keys; routes wired in C7-04b-4; merge pending) | 0152, 0170, 0173 | 0035 (`sql/0035_owner_keys_by_session.sql`) | N |
| C7-04b-4 | Owner API route wiring for agents, tokens and owner keys (split of C7-04b; PATCH not built, moved to C7-06) | W2 | B | C7-04b-3 | Built (branch phase1/c7-04b5-wiring; pending merge into wave 3) | 0152, 0170, 0173 | none | N |
| C7-04c | Owner API body routes through the supervisor, log tail, retire (split of C7-04) | W3 | B | C7-04a, C7-03b1 | Blocked (needs C7-04a and C7-03b1 merged) | 0152, 0170, 0173 | none | N |
| C7-04d | Bearer-driven token rotation and owner-key management (candidate; deferred from API v1 by 0173) | W2+ | B | C7-04b, C7-04b-3 | Candidate (not scheduled in Phase 1) | 0173 | yes, number at dispatch | N |
| C7-03b4 | Body container spec mirrors the golem-body service (blocks enabling the supervisor service) | W3 | B | C7-03b3 | Built (commit b60522fd); live: pending | 0152 | none | N |
| C7-06 | Account page v2 | W3 | C | C7-04b, C7-05 | Blocked (needs C7-04b and C7-05 merged) | none | none | N |
| C7-13a | Skin upload API and held store | W3 | D | C7-04b, C7-12 | Waiting | 0172 | 0031 | N |
| C7-10 | Operator console, ban reasons | W3 | F | C7-03a, C7-04a, C7-12 | Waiting | 0171 | 0030 | N (reason codes are the owner's) |
| C7-07 | Agent rename | W3 | D | C7-04b, C7-06 | Waiting | none | 0028 | N |
| C7-13b | Skin moderation CLI, MineSkin, KV write | W4 | D | C7-13a | Waiting | 0172 | none | N (live: owner's MineSkin key, one call) |
| C7-09 | Account deletion and data export | W4 | E | C7-02b, C7-03b2, C7-13a | Waiting | 0171 | 0029 | N (legal review of the rule is the owner's, gates C7-11) |
| C7-13c | Skin form and status on the account page | W4 | C | C7-06, C7-13a | Waiting | 0172 | none | N |
| C7-11 | Sign-up gate (not a code packet) | W4 | G | C7-05, C7-06, C7-09, C7-13c | Waiting; owner opens sign-up | 0153, 0155, 0171 | none | Y |
| C7-14 | Operator route to set a player's public camera and delayed public thoughts flags | C7 | operator tooling | none | Built; PR pending merge | none | 0034 | N |

Wave C7-1 closed 2026-11-13 (merge bbb5ed6b, PR #315). Migrations 0024, 0025, 0027 and 0032 are applied on the node (deploy run 43522419766; pre-deploy pg dump taken). Spares left: none. 0033 is C7-03b3 (`sql/0033_supervisor_display_name.sql`, wave 2, merge pending), so the next free number is 0034. Retro: [retro/wave-c7-1.md](retro/wave-c7-1.md).

Wave C7-2 built 2026-11-13: C7-02b, C7-05, C7-03b1, C7-03b3 reviewed at pass 4 (ship). Merge pending: PR #321 is held for geldar-93's metrics window until about 02:45Z. Nothing in wave 2 is merged or deployed. Retro: [retro/wave-c7-2.md](retro/wave-c7-2.md).
