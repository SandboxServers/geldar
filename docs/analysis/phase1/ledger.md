# Phase 1 ledger

Status as of 2026-11-21 for the C7 and BH rows (checked against origin/main a62ceb44; the C7-13a row re-checked against origin/main 2aa29c3a, the other rows not re-checked since a62ceb44); other rows as of 2026-11-11 (orchestrator night log: `worknotes/orchestrator-2026-11-11.md`); first written 2026-11-10 on branch `docs/phase1-reconcile`. One row per wave packet, taken from the ledger-row tables of the five wave files: `packets/c1-packets.md` (Ledger rows), `packets/c2-packets.md` (5.3), `packets/c2b-packets.md` (Ledger rows), `packets/c3-packets.md` (10.4), and `packets/c4-packets.md` (10.7). Where a table has no `depends` or `lane` column (c2b, c3), those come from the card's `depends-on` and `lane` lines.

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
| C7-02b | Owner API keys | W2 | A | C7-02a | Done (merged #321, 2026-11-14) | 0152, 0170 | 0026 | N |
| C7-05 | Onboarding and corrected players README | W2 | C | C7-02a | Done (merged #321, 2026-11-14) | 0151 | none | N |
| C7-03b1 | Supervisor NATS contract, user binding, request/reply transport | W2 | B | C7-03a | Done (merged #321, 2026-11-14) | 0067, 0152 | none | N (node auth edits are in the C7-03b2 runbook) |
| C7-03b2 | Supervisor compose service, deploy script, budget, runbook (geldar-93 MERGE/DONE, no network recreate) | W5 | B | C7-03c1, C7-03c2, C7-03c3, C7-03b5 | Open: PR #522 is open and held, not merged. Its four dependencies are merged (#415, #421, #447, #503). Un-shelved by decision 0260 (no Docker socket; the helper owns container control). Owner decides whether human-registered agents get a managed Body and where it runs (kit players do not use the supervisor). The `PASSWORD_ROLES` change moved to C7-03c2 (review F2) | 0082, 0152 | none | Y [owner decision; the node change waits] |
| C7-03b3 | Supervisor Postgres adapter and Docker client | W2 | B | C7-03a, C3-04s, C7-12 | Done (merged #321, 2026-11-14) | 0108, 0152, 0170 | 0033 (`sql/0033_supervisor_display_name.sql`) | N (live start is pending, after C7-03b2) |
| C7-04a | Owner API core: route tree, auth, problem errors, limiter admin exemption, onAuditLost (split of C7-04) | W2 | B | C7-02b, C7-12 | Built (commit e20bf608); merged in #336 (wave 3, 2026-11-14 12:53Z) | 0152, 0170 | none | N |
| C7-04b | Owner API agents and tokens resources, owner-key routes, onboarding hand-off (split of C7-04) | W2 | B | C7-04a | Built except PATCH; PATCH moved to C7-04e (branch phase1/c7-04b5-wiring; migrations 0035 and 0036; merged in #336, wave 3, 2026-11-14 12:53Z) | 0152, 0170, 0173 | 0035, 0036 | N |
| C7-04b-3 | Owner keys by cookie session: session SQL, Postgres adapter, service (split of C7-04b; token and key routes cookie-only in v1) | W2 | B | C7-04b | Built (branch phase1/c7-04b3-session-keys; routes wired in C7-04b-4; merged in #336, wave 3, 2026-11-14 12:53Z) | 0152, 0170, 0173 | 0035 (`sql/0035_owner_keys_by_session.sql`) | N |
| C7-04b-4 | Owner API route wiring for agents, tokens and owner keys (split of C7-04b; PATCH not built, moved to C7-04e) | W2 | B | C7-04b-3 | Built (branch phase1/c7-04b5-wiring; merged in #336, wave 3, 2026-11-14 12:53Z) | 0152, 0170, 0173 | none | N |
| C7-04e | Owner API PATCH /agents/{playerId} for the two visibility flags, cookie session only (split of C7-04b; C7-06 depends on it) | W3 | B | C7-04b | Built, merged in #346 (wave 4, window A, 2026-11-14 16:33Z); branch phase1/c7-04e; PATCH route, revert-checked | 0173 | none | N |
| C7-04c | Owner API body routes through the supervisor: start, stop, restart, status, log (split of C7-04; retire and production wiring split out) | W3 | B | C7-04a, C7-03b1 | Built, merged in #346 (window A, 2026-11-14 16:33Z); routes unmounted until C7-04c2 (#358); retire (C7-04d) split out; branch phase1/c7-04c | 0152, 0170, 0173 | none | N |
| C7-04d | Owner API retire route, POST /agents/{playerId}/retire, cookie session only (split of C7-04c) | W3 | B | C7-04c, C7-04c2 | Done (merged #365, 2026-11-14) | 0173 | none | N |
| C7-04d-mount | Mount the retire routes in the NATS wiring with retirePlayer and the shared slot (split of C7-04d; bodyWiring and main.ts change) | W3 | B | C7-04d, C7-04c2 | Done (merged #380, 2026-11-14) | 0173 | none | N |
| C7-04c2 | Body routes production wiring: NATS connection, mounting bodyRoutes, server.ts and main.ts (split of C7-04c) | W3 | B | C7-04c | Built and merged (#358, 2026-11-14 18:23Z); inert unless REGISTER_NATS_* is set; unconfigured gives 404 | 0152 | none | N |
| C7-04d2 | Bearer-driven token rotation and owner-key management (candidate; renamed from C7-04d; deferred from API v1 by 0173) | W2+ | B | C7-04b, C7-04b-3 | Candidate (not scheduled in Phase 1) | 0173 | yes, number at dispatch | N |
| C7-03c1 | Body helper: root-owned host helper, fixed verbs start, stop, status, logtail, fixed template, roster name checked against the DB, NATS subjects `geldar.<shard>.helper.body.*` and user `helper`, role `geldar_helper` (decision 0260) | W5 | B | C7-03a, C7-03b1, C7-03b3 | Done (merged #415, 2026-11-15) | 0260, 0152, 0067, 0261 | yes (number at dispatch, after 0037) | N |
| C7-03c2 | Helper install script (dry-run default, `--apply`), systemd unit, PASSWORD_ROLES for `geldar_helper` and `geldar_supervisor`, helper node-steps runbook (geldar-93 node steps) | W5 | B | C7-03c1 | Done (merged #421, 2026-11-15); node steps by geldar-93 still open; open: how the helper build reaches the node | 0260 | none | Y [geldar-93 node steps] |
| C7-03c3 | Supervisor uses the helper: docker.ts becomes a NATS client; no Docker socket and no host mounts except secrets | W5 | B | C7-03c1 | Done (merged #447, 2026-11-15) | 0260 | none | N |
| C7-03b5 | Supervisor process entry (main.ts), supervisor Dockerfile, colo-images build job | W5 | B | C7-03a, C7-03b3 | Done (merged #503, 2026-11-15) | 0260 | none | N |
| C7-03b4-live | Live check of the Body container spec, run against the helper (split of C7-03b4) | W5 | B | C7-03b2 | Blocked (C7-03b2 deployed) | 0152, 0260 | none | Y [geldar-93; orchestrator-run] |
| C7-03b4 | Body container spec mirrors the golem-body service (blocks enabling the supervisor service) | W3 | B | C7-03b3 | Done (on main, commit b60522fd); live: pending | 0152 | none | N |
| C7-06 | Account page v2 | W3 | C | C7-04b, C7-04e, C7-05 | Built (partial, #346, 2026-11-14 16:33Z): C7-06 and C7-06b; the items not built are in C7-06c | none | none | N |
| C7-06b | Account page view links and HTML error pages (split of C7-06, same branch) | W3 | C | C7-06 | Built partial (#346, 2026-11-14 16:33Z; branch phase1/c7-06) | 0138, 0139 | none | N |
| C7-06c | Account page v2 items not delivered by C7-06 and C7-06b: status and token lines, body buttons, visibility toggles (split of C7-06) | W4 | C | C7-06, C7-04c2, C7-04e | Partly done: status line merged (#366, 2026-11-14); body buttons went to C7-06d (#539); PATCH-driven visibility toggles still open (POST forms exist) | 0138, 0173 | none | N |
| C7-06d | Account page body controls: same-origin script and CSP for x-csrf-token, start/stop/restart buttons, PATCH visibility toggles, loader wiring (split of C7-06c) | W4 | C | C7-06c, C7-04c2, C7-04e | Done (merged #539, 2026-11-16): script, CSP and Body controls; PATCH-driven toggles deferred, export link still open | 0138, 0173, 0261 | none | N |
| LEGAL-SERVE | Serve the approved legal texts at `/register/terms`, `/register/privacy` and `/register/acceptable-use`, linked at sign-up, embedded at build, version v1 unchanged | W5 | Register | C7-05, C7-06 | Done (merged #404, 2026-11-15) | 0153, 0155, 0261 | none | N |
| SIGNUP-RUNBOOK | One runbook for opening sign-up (`docs/runbooks/open-signup.md`) for geldar-93, no values; fixes the stale `deploy/README.md` sentence | W5 | Docs | none | Done (merged #517) | 0070, 0135, 0153, 0261 | none | N |
| REG-NATS-COMPOSE | Register service NATS env (`REGISTER_NATS_URL`, `REGISTER_NATS_USER`, `REGISTER_NATS_PASSWORD_FILE`) and the `nats-register` secret mount in `compose/colo.yml`; folded into C7-03b2 as its only compose edit | W5 | Compose | C7-04c2 (merged), C7-03b2 | Card written; folded into C7-03b2 | 0152, 0261 | none | N |
| ROSTER-AUTO | Auto-roster on agent registration: SECURITY DEFINER writes `mcp_roster`; display-name shape (3 to 16 letters, digits, underscore) enforced at the form and in SQL (DISPLAYNAME-SHAPE folded); per-owner cap 3; idempotent; audited; additive migration | W5 | SQL and Register | C3-04s, C7-03b3, C7-04b | Done (merged #515, 2026-11-15; `register_roster_add`) | 0261 | 0061 | N |
| BODY-HOST | Managed Body for a sign-up agent: player-host entry point, config from the database and env, login name and life admitted by the helper (Paper whitelist, Velocity life key), no RCON; supersedes the open part of C7-03b4 | W5 | Golem, admin and helper | C7-03c1, C7-03c3, C7-03b5, C7-03b4 (built), ROSTER-AUTO | Open: BH-1, BH-2, BH-3, BH-5a, BH-5b and BH-6 merged; BH-4 folded into BH-1 to BH-3 (no separate card); sub-questions for geldar-93 (RCON whitelist verb, life key) | 0261, 0040, 0260 | none | Y [geldar-93: sub-questions] |
| BH-1 | BODY-HOST review fix: random per-agent key, ban and roster checks, tests | W5 | SQL and body helper | BODY-HOST | Done (merged #525, 2026-11-15); host_key, review fix pass 2 applied | 0260, 0261 | 0063 | N |
| BH-2 | Managed player host: config from the database, no RCON | W5 | Golem, admin and helper | BODY-HOST | Done (merged #527, 2026-11-15) | 0261 | none | N |
| BH-3 | Helper start runs a fixed admit one-shot, managed Body template | W5 | Golem, admin and helper | BODY-HOST | Done (merged #530, 2026-11-15) | 0260, 0261 | none | N |
| BH-4 | No card: helper secret files for the managed host, folded into BH-1 to BH-3 and body-helper-node-steps.md by owner ruling (named in open-signup.md rows 14 to 18) | W5 | Golem, admin and helper | BODY-HOST | Folded: no separate card, no PR, no commit; not separate open work | none | none | N |
| BH-5a | Admit-life add or remove mode (admission only), geldar.life label | W5 | Golem, admin and helper | BODY-HOST | Done (merged #537, 2026-11-15) | 0261 | none | N |
| BH-5b | Helper stop removes the admission for managed Bodies | W5 | Golem, admin and helper | BODY-HOST | Done (merged #573, 2026-11-16) | 0261 | none | N |
| BH-6 | Sweep removes an orphaned managed Body after two passes | W5 | Golem, admin and helper | BODY-HOST | Done (merged #575, 2026-11-16); live check open | 0261 | none | N |
| C7-13a | Skin upload API and held store | W3 | D | C7-04b, C7-12 | Done (merged #850, 2026-11-21): migrations 0031 and 0067, the PNG validator, the owner skin routes, the held store and the OpenAPI paths. Not verified here: whether 0031 and 0067 are applied on the node; open items in `worknotes/C7-13a.md` | 0172 | 0031, 0067 | N |
| C7-10 | Operator console, ban reasons | W3 | F | C7-03a, C7-04a, C7-12 | Waiting | 0171 | 0030 | N (reason codes are the owner's) |
| C7-07 | Agent rename | W3 | D | C7-04b, C7-06 | Waiting | none | 0028 | N |
| C7-13b | Skin moderation CLI, MineSkin, KV write | W4 | D | C7-13a | Waiting | 0172 | none | N (live: owner's MineSkin key, one call) |
| C7-09 | Account deletion and data export | W4 | E | C7-02b, C7-03b2, C7-13a | C7-09a2 merged (#470; every life of the owner erased, dead or alive; decision 0262 supersedes 0171 point 2). C7-09b and C7-09c merged. Open: the account-page export link; the 0261 open question (does M1 wait for C7-09?) | 0171, 0261, 0262 | 0039, 0040 | N (legal review of the rule is the owner's, gates C7-11) |
| C7-13c | Skin form and status on the account page | W4 | C | C7-06, C7-13a | Waiting | 0172 | none | N |
| C7-09b | Owner data export: SQL function register_owner_export (0062) built; route built and mounted via mountAccountDelete | W4 | E | C7-09a2 | Merged: SQL in #524 (migration 0062); route and migration 0065 (3 MB budget) in #541; the account-page export link is still open; carry-forward: a never-settling pool client leaks one pool client per timed-out export (follow-up card: release(true) on timeout) | 0171, 0261, 0262 | 0062 | N |
| C7-09c | Operator erasure script (skins KV key and Velocity registry) | W4 | E | C7-09a | Merged (#577, 2026-11-16); whether the operator run has happened is not recorded | 0171 | none | N |
| C7-11 | Sign-up gate (not a code packet) | W4 | G | C7-05, C7-06, C7-09, C7-13c | Gate merged (#576, 2026-11-16); sign-up stays closed until the owner opens it; new dependency: the 0261 open question (does M1 wait for C7-11?) | 0153, 0155, 0171, 0261 | none | Y |
| C7-14 | Operator route to set a player's public camera and delayed public thoughts flags | C7 | operator tooling | none | Done (merged #338, 2026-11-14) | none | 0034 | N |
| C7-14b | Owner admin verbs in the operator wrappers (`owner-admin` set/unset/list in admin.sh and colo-admin.sh; idempotent `owner-add`; deploy tests for the verbs) | C7 | operator tooling | C7-14, C7-12 | Built and merged (#359, 2026-11-14 18:29Z); no SQL, no migration | none | none | N |
| C7-MC | Minecraft Java ownership gate on NEW Microsoft sign-up (branch phase1/mc-ownership: wire, SQL, client and docs packets). Flag REGISTER_REQUIRE_MC_OWNERSHIP is OFF everywhere; fail closed; Mojang app id not filed by us (owner files aka.ms/mce-reviewappid); Bedrock not checked | C7 | B | C7-11, C7-12 | Built on phase1/mc-ownership, not merged; live pending | 0395 | decision 0395 and sql/0068_mc_ownership.sql | Y [owner: Mojang app id form; Entra permission UNVERIFIED] |
| CF-W4-1 | Split `threshold/register/test/body.test.ts` (534 lines) before more tests land in it | CF | register | C7-04c | Carry-forward, scheduled later | none | none | N |
| CF-W4-2 | PATCH write order for two turn-ons: thoughts first, so a 54000 refusal leaves nothing changed | CF | register | C7-04e | Carry-forward, scheduled later | none | none | N |
| CF-W4-3 | Owner id returned by the owner-agent SQL functions; loader guard made real (wave 2/3 code, C7-04b) | CF | register, SQL | C7-04b | Carry-forward, scheduled later | needs a migration number via decision-number-registry | needs a number | N |
| CF-W4-4 | Fetch-metadata check on `GET /register/onboarding`, so a cross-site navigation does not consume the token (wave 1/2 code, C7-05) | CF | register | C7-05 | Built | none | none | N |
| CF-W4-5 | `__Host-` prefix for `gr_session` and `gr_state`; Low to Medium, recommended before sign-up opens (wave 1/2 code). Tracking: remove LEGACY_CLEARS after one release. | CF | register | none | Built | none | none | N (the `gk_session` rename is an orchestrator call) |

Wave C7-1 closed 2026-11-13 (merge bbb5ed6b, PR #315). Migrations 0024, 0025, 0027 and 0032 are applied on the node (deploy run 43522419766; pre-deploy pg dump taken). Spares left: none. 0033 is C7-03b3 (`sql/0033_supervisor_display_name.sql`, wave 2, merge pending), so the next free number is 0034. Retro: [retro/wave-c7-1.md](retro/wave-c7-1.md).

Wave C7-2 built 2026-11-13: C7-02b, C7-05, C7-03b1, C7-03b3 reviewed at pass 4 (ship). Merged in PR #321 (2026-11-14 03:56Z). Deployment is not recorded here. Retro: [retro/wave-c7-2.md](retro/wave-c7-2.md).
