# Wave C7 plan: dependency graph, waves, migrations, live lane

Written 2026-11-13, after the owner's rulings (decisions 0170 to 0172). Cards: [c7-user-management-packets.md](c7-user-management-packets.md) (C7-01 to C7-07, rulings, shared rules), [c7b-packets.md](c7b-packets.md) (C3-04s, C7-12, C7-08 to C7-11, C7-13a to c), [c7c-packets.md](c7c-packets.md) (C7-03b split into C7-03b1, C7-03b2, C7-03b3) and [c7d-packets.md](c7d-packets.md) (C7-04 split into C7-04a, C7-04b, C7-04c, with the OpenAPI draft) and [c7e-packets.md](c7e-packets.md) (C7-03b4, the Body container spec). The card files for wave C7 are these five plus this plan. Process: the [campaign-packet skill](../../../../.claude/skills/campaign-packet/SKILL.md). Never edit the spec.

Already merged on `main`: C7-01 (sessions, migration 0021) and C7-08 (consent and legal text v1, migration 0022). The highest migration is 0023. Not merged: C3-00 and C3-04 (no `mcp_roster`), so the first packet is the C3-04 slice.

## Dependency graph

```
C3-04s roster (0024) --------------------------+
                                               v
C7-12 admin flag + audit base (0025) --+--> C7-03a supervisor (0027) --> C7-03b1 NATS binding, C7-03b3 adapters --> C7-03b2 compose wiring (geldar-93)
                                       |            |                          |
                                       +--> C7-02a tokens --> C7-02b owner keys (0026) --> C7-04a API core
                                                |                                         |   |   |
                                                +--> C7-05 onboarding                      |   |   +--> C7-10 operator console (0030)
                                                                                    C7-04a -> 04b (wave 2), 04c (wave 3, also needs C7-03b1)
                                                           |                               |   +------> C7-13a skin upload API (0031)
                                                           +------> C7-06 account page <---+                |
                                                                          |                                  |
                                                                          +--> C7-07 rename (0028)           |
                                                                          +--> C7-13c skin form <-- C7-13b skin moderation CLI <-+
C7-02b, C7-03b2, C7-13a --> C7-09 deletion and export (0029)
C7-05, C7-06, C7-09, C7-13c, owner approval --> C7-11 sign-up gate
```

## Constraints

- **One register-package packet at a time, except named pairs.** `threshold/register/` is one package. Packets that edit it run serially in this order: C7-12, C7-02a, C7-02b, C7-04a, C7-04b, C7-06, C7-04c, C7-07, C7-13a, C7-09, C7-13c. Allowed pairs with disjoint files, because the plan names their files: C7-02b with C7-05 (owner-keys files against `pages/onboarding*`, `static/onboarding.js`); C7-10 (`operator*.ts`) with C7-06 or C7-13a; C7-13a (`api/skins*`, `skin-validate.ts`) with C7-06 (`pages/account*`); C7-09 (`api/account-data*`, a confirm page) with C7-13c (`pages/skin*`). A pair never shares `server.ts` or `account*.ts`; the one-line route table entries in the C7-04 `api/` index (04a, 04b, 04c) are merged one at a time by ops.
- **Not in the register package** (these run in parallel with the register lane): C3-04s, C7-03a, C7-03b1, C7-03b2, C7-03b3, C7-03b4, C7-13b. `tools/mcp-tokens/src/cli.ts` is edited by C3-04s, C7-12 and C7-10 (one registration line each); ops merges them in that order.
- **Migrations are assigned here, so none collide.** A coder fetches `origin/main` at the start; if another wave has taken one of these numbers, the coder stops and asks, never renumbers silently. The registry holds 0024 to 0033 for C7. 0032 is C7-02a (token lifecycle, orchestrator ruling) and 0033 is C7-03b3 (`sql/0033_supervisor_display_name.sql`, wave 2). Neither is a spare.

| Packet | Migration |
|---|---|
| C3-04s | 0024 `mcp_roster` |
| C7-12 | 0025 admin flag, `register_audit` base |
| C7-02b | 0026 `owner_api_keys` |
| C7-03a | 0027 `body_ops` |
| C7-07 | 0028 rename definer function |
| C7-09 | 0029 deletion function and export view |
| C7-10 | 0030 audit extension, ban reasons |
| C7-13a | 0031 `skin_uploads` |
| C7-13d | none (Candidate, wave 3, size S; palette-to-RGBA for `skin set`) |
| C7-02a | 0032 `token_lifecycle` (ruled by the orchestrator; the plan had said none) |
| C7-03b3 | 0033 `supervisor_display_name` (wave 2; not a spare) |
| spare | none left; the next free number is 0034 |

- **Compose.** Only C7-03b2 edits `compose/colo*.yml`, as a new service in the base file under profile supervisor (off by default). It needs contact with geldar-93 before dispatch and before the node change, and a plan that does not recreate the `geldar-colo` network (see the card). No other C7 packet touches compose.
- **Fan-out rule.** Wave 1 starts with the two unblockers; fan-out packets start only after the unblockers are merged to the wave branch (conventions section 2). `contract/` is edited only by C7-03a, and only if the control messages need a schema.
- **At most about six agents at once.** No wave below exceeds four packets.

## Waves

Branches are `phase1/<id>-<slug>` as on each card. Size: S about 20k tokens, M about 40k, L two sessions.

### Wave 1: roster, admin flag, supervisor core, token lifecycle

| Order | Packet | Depends | Branch | Migration | Size |
|---|---|---|---|---|---|
| 1a | C3-04s DB roster slice (unblocker) | C1-08 | `phase1/c3-04s-db-roster` | 0024 | M |
| 1b | C7-12 admin flag, CLI, audit base (unblocker, parallel with 1a) | none | `phase1/c7-12-admin-flag` | 0025 | M |
| 2a | C7-03a supervisor package (fan-out; after 1a and 1b merge) | C3-04s, C7-12 | `phase1/c7-03a-supervisor` | 0027 | L |
| 2b | C7-02a player token lifecycle (fan-out, register lane; after 1b) | C7-12 | `phase1/c7-02a-token-lifecycle` | none | M |

Live lane: the roster integration test under `GELDAR_IT=1` on the shard (C3-04s). Wave close at the end (below).

### Wave 2: owner keys, NATS binding, adapters, onboarding, API

| Order | Packet | Depends | Branch | Migration | Size |
|---|---|---|---|---|---|
| 1 | C7-02b owner keys (register lane) | C7-02a | `phase1/c7-02b-owner-keys` | 0026 | M |
| 1 | C7-05 onboarding and README (pair with C7-02b, disjoint files) | C7-02a | `phase1/c7-05-onboarding` | none | M |
| 1 | C7-03b1 NATS contract, user binding, request/reply transport | C7-03a | `phase1/c7-03b1-nats-binding` | none | M |
| 1 | C7-03b3 Postgres adapter and Docker client (non-register lane) | C7-03a, C3-04s, C7-12 | `phase1/c7-03b3-adapters` | none | L |
| 2 | C7-04a API core: route tree, auth, problem errors, limiter admin exemption, onAuditLost (fan-out point; after C7-02b merges) | C7-02b, C7-12 | `phase1/c7-04a-api-core` | none | M |
| 2 | C7-04b agents and tokens resources, owner-key routes, onboarding hand-off (built; branch `phase1/c7-04b5-wiring`, migrations 0035 and 0036; pending merge into wave 3) | C7-04a | `phase1/c7-04b-agents-tokens` | none | M |
| 2 | C7-04b-3 owner keys by cookie session (built; decision 0173; route wiring and merge pending) | C7-04b | `phase1/c7-04b3-session-keys` | 0035 | M |
| candidate | C7-04d Bearer-driven token rotation and owner-key management (not scheduled in Phase 1) | C7-04b, C7-04b-3 | `phase1/c7-04d-bearer-keys` (proposed) | yes, at dispatch | M |

Wave 2 order: C7-04a starts when C7-02b is on the wave branch; C7-04b starts after C7-04a. C7-04 was one L card and is split (see [c7d-packets.md](c7d-packets.md)); the body routes are C7-04c in wave 3.

Live lane: none in wave 2 (C7-03b1 and C7-03b3 touch no node). The C7-03b2 rollout and the first supervisor start and stop of a DB-listed test player are wave 3, after geldar-93 has DONE. Nothing here touches the public Minecraft port (RESUME stop rule: C2-02c first).

### Wave 3: account page, rename, operator console, skin upload API

The packets below depend on the C7-04 cards (C7-04b for the resource routes, C7-04a for C7-10); C7-03b2 does not. C7-03b4 (c7e-packets.md, Body container spec) blocks enabling the supervisor service: the C7-03b2 node steps wait for it. C7-04c (body routes) is in this wave and needs C7-04a and C7-03b1. Serial order inside the register lane: C7-06, then C7-04c and C7-07; C7-13a and C7-10 run beside C7-06 on disjoint files.

| Order | Packet | Depends | Branch | Migration | Size |
|---|---|---|---|---|---|
| 1 | C7-03b2 compose service, deploy script, budget, runbook (before any live use; geldar-93 MERGE/DONE) | C7-03b1, C7-03b3 | `phase1/c7-03b2-compose-deploy` | none | M |
| 1 | C7-03b4 Body container spec (c7e-packets.md; blocks enabling the supervisor service) | C7-03b3 | `phase1/c7-03b4-body-spec` | none | S |
| 1 | C7-04c body routes (start, stop, restart, status, log, retire through the supervisor) | C7-04a, C7-03b1 | `phase1/c7-04c-body-routes` | none | M |
| 1 | C7-06 account page v2 | C7-04b, C7-05 | `phase1/c7-06-account-page-v2` | none | M |
| 1 | C7-13a skin upload API and held store | C7-04b, C7-12 | `phase1/c7-13a-skin-upload-api` | 0031 | L |
| 1 | C7-10 operator console, ban reasons (confirm the C7-04 part at dispatch) | C7-03a, C7-04a, C7-12 | `phase1/c7-10-operator-console` | 0030 | M |
| 2 | C7-07 agent rename (after C7-06 merges; it edits the account page rename form; the PATCH route in C7-04b stays rename-free) | C7-04b, C7-06 | `phase1/c7-07-agent-rename` | 0028 | S |

Live lane: the account page on the node (C7-06), looked at on a phone width.

### Wave 4: deletion, skin moderation, skin form, gate

| Order | Packet | Depends | Branch | Migration | Size |
|---|---|---|---|---|---|
| 1 | C7-13b skin moderation CLI, MineSkin, KV (non-register) | C7-13a | `phase1/c7-13b-skin-moderation` | none | M |
| 1 | C7-09 deletion and export (register lane) | C7-02b, C7-03b2, C7-13a | `phase1/c7-09-deletion-export` | 0029 | L |
| 1 | C7-13c skin form on the account page (pair with C7-09, disjoint files) | C7-06, C7-13a | `phase1/c7-13c-skin-form` | none | S |
| 2 | C7-11 sign-up gate (not a code packet beyond the config check) | C7-05, C7-06, C7-09, C7-13c, owner | `phase1/c7-11-signup-gate` | none | S |

Wave 4 is three code packets plus the gate, because C7-09 and C7-13b are long. Live lane: one real MineSkin generation for an approved test upload (C7-13b, owner's key, one call) and the login that shows the skin; the deletion check (C7-09) on the node. The owner reviews the erasure rule (0171) and decides to open sign-up.

## Wave close (each wave, campaign-packet skill section 6)

1. After the last packet of the wave merges to the wave branch: the full `./geldar.ps1 check` (the integration case-count floor set at the wave's start), then ONE review, split by area (docs; code, CI and security), one packet-reviewer each, with a narrow brief, up to 5 rounds with a fix round (a fresh packet-coder, findings only) between them. Reviews and live runs happen once per wave, not per packet or batch. Wave 3 and 4 reviewers get the knowledge-boundary and cross-owner checks and the admin flag rules (0170) in their brief.
2. The wave's live run, recorded step by step in the worknote (the live lane items above), run by ops, one at a time, never with `adam up`.
3. A docs sweep by a fresh coder from the reviewer's list; the retro in `retro/` with numbered actions; any process change as its own packet.
4. Ledger and RESUME updated; packet worktrees removed after copying useful reports to `worknotes/`.

The security review of every public surface (conventions 4.3) covers the register API, the skin upload and the supervisor's NATS subjects, at the campaign boundary.
