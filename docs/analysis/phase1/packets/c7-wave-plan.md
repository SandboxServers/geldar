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
| 2 | C7-04b agents and tokens resources, owner-key routes, onboarding hand-off (built except PATCH, which moved to C7-04e; branch `phase1/c7-04b5-wiring`, migrations 0035 and 0036; merged into wave 3) | C7-04a | `phase1/c7-04b-agents-tokens` | none | M |
| 2 | C7-04b-3 owner keys by cookie session (built; decision 0173; routes wired in C7-04b-4, merged into wave 3) | C7-04b | `phase1/c7-04b3-session-keys` | 0035 | M |
| candidate | C7-04d2 Bearer-driven token rotation and owner-key management (renamed from C7-04d; not scheduled in Phase 1) | C7-04b, C7-04b-3 | `phase1/c7-04d2-bearer-keys` (proposed) | yes, at dispatch | M |

Wave 2 order: C7-04a starts when C7-02b is on the wave branch; C7-04b starts after C7-04a. C7-04 was one L card and is split (see [c7d-packets.md](c7d-packets.md)); the body routes are C7-04c in wave 3.

Live lane: none in wave 2 (C7-03b1 and C7-03b3 touch no node). The C7-03b2 rollout and the first supervisor start and stop of a DB-listed test player are wave 3, after geldar-93 has DONE. Nothing here touches the public Minecraft port (RESUME stop rule: C2-02c first).

### Wave 3: account page, rename, operator console, skin upload API

The packets below depend on the C7-04 cards (C7-04b for the resource routes, C7-04a for C7-10); C7-03b2 does not. C7-03b4 (c7e-packets.md, Body container spec) blocks enabling the supervisor service: the C7-03b2 node steps wait for it. C7-04c (body routes) is in this wave and needs C7-04a and C7-03b1. Serial order inside the register lane: C7-04e, then C7-06, then C7-04c and C7-07; C7-13a and C7-10 run beside C7-06 on disjoint files.

| Order | Packet | Depends | Branch | Migration | Size |
|---|---|---|---|---|---|
| 5 | C7-03c1 body helper (decision 0260: fixed verbs, fixed template, NATS helper subjects, role `geldar_helper`) | C7-03a, C7-03b1, C7-03b3 | `phase1/c7-03c1-body-helper` | number at dispatch (after 0037) | M |
| 5 | C7-03c3 supervisor uses the helper (no Docker socket) | C7-03c1 | `phase1/c7-03c3-supervisor-helper` | none | M |
| 5 | C7-03b5 supervisor process entry and image | C7-03a, C7-03b3 | `phase1/c7-03b5-supervisor-entry` | none | M |
| 5 | C7-03c2 helper install script and runbook (geldar-93 node steps; PASSWORD_ROLES) | C7-03c1 | `phase1/c7-03c2-helper-install` | none | M |
| 5 | C7-03b2 compose service, deploy script, budget, runbook (un-shelved by decision 0260; supervisor container only, no socket; the owner decides whether human-registered agents get a managed Body) | C7-03c1, C7-03c2, C7-03c3, C7-03b5 | `phase1/c7-03b2-compose-deploy` | none | M |
| 5 | C7-03b4-live live check against the helper (geldar-93; orchestrator-run) | C7-03b2 | none | none | S |
| 1 | C7-14b owner admin verbs in the operator wrappers (`owner-admin` in admin.sh and colo-admin.sh; idempotent `owner-add`; deploy tests; packets/C7-14b.md; built and merged in #359, 2026-11-14 18:29Z) | C7-14, C7-12 | `phase1/c7-14b-owner-admin-verbs` | none | S |
| 1 | C7-03b4 Body container spec (c7e-packets.md; blocks enabling the supervisor service) | C7-03b3 | `phase1/c7-03b4-body-spec` | none | S |
| 1 | C7-04c body routes (start, stop, restart, status, log through the supervisor; built and merged in #346, window A; retire split to C7-04d, wiring to C7-04c2) | C7-04a, C7-03b1 | `phase1/c7-04c-body-routes` | none | M |
| 1 | C7-04d retire route, POST /agents/{playerId}/retire (split of C7-04c; built, review in progress) | C7-04c, C7-04c2 | `phase1/c7-04d-retire` | none | S |
| 3 | C7-04d-mount retire routes in the NATS wiring with retirePlayer and the shared slot (split of C7-04d; Ready, after C7-04d merges) | C7-04d, C7-04c2 | `phase1/c7-04d-mount` | none | S |
| 1 | C7-04c2 body routes production wiring: NATS connection, mounting, server.ts and main.ts (split of C7-04c; built and merged in #358, 2026-11-14 18:23Z; inert unless REGISTER_NATS_* is set, unconfigured gives 404) | C7-04c | `phase1/c7-04c2-wiring` | none | S |
| 1 | C7-04e PATCH /agents/{playerId} visibility flags (split of C7-04b; cookie only; built and merged in #346, window A) | C7-04b | `phase1/c7-04e-agent-patch` | none | S |
| 1 | C7-06 account page v2 (built partial, merged in #346) | C7-04b, C7-04e, C7-05 | `phase1/c7-06-account-page-v2` | none | M |
| 1 | C7-06b account page view links and HTML error pages (split of C7-06, built partial on the same branch, merged in #346) | C7-06 | `phase1/c7-06-account-page-v2` | none | built |
| 4 | C7-06c account page v2 items not delivered by C7-06 and C7-06b (built partial: status line; body buttons and toggles moved to C7-06d) | C7-06, C7-04c2, C7-04e | `phase1/c7-06c-account-items` | none | M |
| 4 | C7-06d account page body controls: same-origin script and CSP, body buttons, PATCH toggles, loader wiring (split of C7-06c; un-shelved: the page script and CSP can start now, the buttons need C7-03b2 deployed) | C7-06c, C7-04c2, C7-04e | `phase1/c7-06d-account-controls` | none | M |
| 1 | C7-13a skin upload API and held store | C7-04b, C7-12 | `phase1/c7-13a-skin-upload-api` | 0031 | L |
| 1 | C7-10 operator console, ban reasons (confirm the C7-04 part at dispatch) | C7-03a, C7-04a, C7-12 | `phase1/c7-10-operator-console` | 0030 | M |
| 2 | C7-07 agent rename (after C7-06 merges; it edits the account page rename form; the PATCH route, moved from C7-04b to C7-04e, stays rename-free) | C7-04b, C7-06 | `phase1/c7-07-agent-rename` | 0028 | S |

Live lane: the account page on the node (C7-06), looked at on a phone width.

### Wave 4: deletion, skin moderation, skin form, gate

| Order | Packet | Depends | Branch | Migration | Size |
|---|---|---|---|---|---|
| 1 | C7-13b skin moderation CLI, MineSkin, KV (non-register) | C7-13a | `phase1/c7-13b-skin-moderation` | none | M |
| 1 | C7-09 deletion and export (register lane). New dependency: the 0261 open question (does M1 wait for C7-09?) | C7-02b, C7-03b2, C7-13a | `phase1/c7-09-deletion-export` | 0029 | L |
| 1 | C7-13c skin form on the account page (pair with C7-09, disjoint files) | C7-06, C7-13a | `phase1/c7-13c-skin-form` | none | S |
| 2 | C7-11 sign-up gate (not a code packet beyond the config check). New dependency: the 0261 open question (does M1 wait for C7-11?) | C7-05, C7-06, C7-09, C7-13c, owner | `phase1/c7-11-signup-gate` | none | S |
| CF | CF-1 (CF-W4-1) split `body.test.ts` before more tests land in it (C7-04c2 is merged; C7-04d adds to it) | C7-04c | scheduled later | none | S |
| CF | CF-2 (CF-W4-2) PATCH write order for two turn-ons, thoughts first | C7-04e | scheduled later | none | S |
| CF | CF-3 (CF-W4-3) owner id returned by the owner-agent SQL functions; loader guard made real | C7-04b | scheduled later | needs a number via decision-number-registry | M |
| CF | CF-4 (CF-W4-4) fetch-metadata check on `GET /register/onboarding` (wave 1/2 code, C7-05) | C7-05 | scheduled later | none | S |
| CF | CF-5 (CF-W4-5) `__Host-` prefix for `gr_session` and `gr_state` (wave 1/2 code; Low to Medium, recommended before sign-up opens) | none | scheduled later; recommended before sign-up opens | none | M |

Wave 4 is three code packets plus the gate, because C7-09 and C7-13b are long. Live lane: one real MineSkin generation for an approved test upload (C7-13b, owner's key, one call) and the login that shows the skin; the deletion check (C7-09) on the node. The owner reviews the erasure rule (0171) and decides to open sign-up.

## Wave close (each wave, campaign-packet skill section 6)

1. After the last packet of the wave merges to the wave branch: the full `./geldar.ps1 check` (the integration case-count floor set at the wave's start), then ONE review, split by area (docs; code, CI and security), one packet-reviewer each, with a narrow brief, up to 5 rounds with a fix round (a fresh packet-coder, findings only) between them. Reviews and live runs happen once per wave, not per packet or batch. Wave 3 and 4 reviewers get the knowledge-boundary and cross-owner checks and the admin flag rules (0170) in their brief.
2. The wave's live run, recorded step by step in the worknote (the live lane items above), run by ops, one at a time, never with `adam up`.
3. A docs sweep by a fresh coder from the reviewer's list; the retro in `retro/` with numbered actions; any process change as its own packet.
4. Ledger and RESUME updated; packet worktrees removed after copying useful reports to `worknotes/`.

The security review of every public surface (conventions 4.3) covers the register API, the skin upload and the supervisor's NATS subjects, at the campaign boundary.

## M1 and M2 plan (decision 0261, 2026-11-14)

Written 2026-11-14 from the owner's ruling. Cards: [c7f-packets.md](c7f-packets.md) (owner-ruling cards, C7-03c1 with GLOBAL-CAP). Lanes: Register, SQL, Docs, Compose/node (geldar-93 node steps), Golem, Owner.

### Milestones

- **M1: sign-up works.** The owner signs up with Microsoft, accepts the legal text (v1), registers an agent, gets a player token and sees the account page. Sign-up is open (the kill switch is off by the runbook).
- **M2: Body controls.** The owner starts, stops and restarts that agent's Body from the account page, within the quotas of 0170 (1 running per agent, 3 starts per agent per hour, 10 per owner per day, admin exempt) and the global cap of 40 running Bodies (0261 item 3d).

### OPEN QUESTION for the owner (not decided here)

**Does M1 wait for C7-09 and C7-11, or does 0261 supersede that part of 0153?**

What 0153 requires before sign-up opens to anyone outside the project:

1. Terms of Use, a Privacy Notice and an Acceptable Use policy with a version string, shown at sign-up; a required consent checkbox whose record is written with the owner row; self-serve account deletion with the 0171 erasure rule; self-serve account data export (JSON of the owner's own rows); a published contact and abuse address. All live-checked. Deletion and export are C7-09. The texts are served by LEGAL-SERVE.
2. The gate C7-11 refuses to open while the terms version is not marked approved by the owner in a committed file.
3. Until the gate opens the kill switch stays off.

0261 opens sign-up for everyone, names neither C7-09 nor C7-11, and says it does not waive 0153. The M1 path below carries C7-09 and C7-11 as conditional steps until the owner answers.

### M1 path (ordered)

| Step | Card | Lane | Size | Depends on | Notes |
|---|---|---|---|---|---|
| 1 | CF-W4-5 `__Host-` prefix for `gr_session` and `gr_state` | Register | M | none | Queued (carry-forward); recommended before sign-up opens |
| 2 | LEGAL-SERVE | Register | S to M | C7-05, C7-06 (merged) | Serves the v1 texts at `/register/terms`, `/register/privacy`, `/register/acceptable-use`; register package, one at a time |
| 3 | SIGNUP-RUNBOOK | Docs | S | none | `docs/runbooks/open-signup.md` for geldar-93, no values |
| 4 | Entra sign-in app | Owner | none | none | Owner step; no card |
| 5 | `REGISTER_*` env and node steps | Compose/node (geldar-93) | none | steps 3 and 4 | Order in the SIGNUP-RUNBOOK card: secret files, env, register profile, migrations check, `GELDAR_REGISTER_UPSTREAM`, `colo-public.sh install glass`, one `board-proxy` restart, kill switch on |
| 6 | C7-09 deletion and export, then C7-11 gate | Register; Owner | L; S | C7-02b, C7-03b2, C7-13a; C7-05, C7-06, C7-09, C7-13c | Conditional: only if the owner answers yes. C7-09 needs C7-03b2, which is on the M2 path |
| 7 | Open: kill switch false | Compose/node (geldar-93) | none | steps 1 to 5 (and 6 if yes) | The owner decides; the SIGNUP-RUNBOOK step |

### M2 path (ordered)

| Step | Card | Lane | Size | Depends on | Notes |
|---|---|---|---|---|---|
| 1 | C7-04d-mount retire routes in the NATS wiring | Register | S | C7-04d (merged), C7-04c2 | Queued. Must land before any Body runs (audit gap G4) |
| 2 | C7-03c1 Body helper, with GLOBAL-CAP | Golem (helper) | M | C7-03a, C7-03b1, C7-03b3 | Fixed verbs (0260). Cap read from one place, default 40; refusal `global body cap reached`, audit outcome `capacity`; one alert line at 30 |
| 3 | C7-03c3 supervisor uses the helper | Golem | M | C7-03c1 | No Docker socket |
| 4 | C7-03b5 supervisor process entry | Golem | not sized in the plan | C7-03a, C7-03b3 | |
| 5 | C7-03c2 helper install script and runbook | Compose/node (geldar-93) | M | C7-03c1 | Dry-run default, `--apply`; `PASSWORD_ROLES`; node steps by geldar-93 |
| 6 | REG-NATS-COMPOSE, folded into C7-03b2 with the C7-03b2 compose service | Compose/node (geldar-93) | S (REG-NATS-COMPOSE); M (C7-03b2) | C7-03c1, C7-03c2, C7-03c3, C7-03b5; C7-04c2 (merged) | The only compose edit of the register service |
| 7 | ROSTER-AUTO | SQL and Register | M to L | C3-04s, C7-03b3, C7-04b | Additive migration; number at dispatch after the `sql/` check on main; register package, one at a time |
| 8 | BODY-HOST | Golem, admin and helper | L | C7-03c1, C7-03c3, C7-03b5, C7-03b4 (built), ROSTER-AUTO | Open sub-questions for geldar-93 before dispatch: RCON whitelist verb and life key. Supersedes the open part of C7-03b4 |
| 9 | C7-03b4-live live check | Compose/node (geldar-93; orchestrator-run) | S | C7-03b2 deployed | Live check of the Body spec against the helper |
| 10 | C7-06d account page body controls | Register | M | C7-06c, C7-04c2, C7-04e; buttons need C7-03b2 deployed | Script and CSP part can go first; buttons after step 6. Register package, one at a time |

M2 is reachable when steps 1 to 9 are merged and the node steps are done (0261, Consequences). Step 10 is the last card of M2.

### Order and parallel rules

- Register-package cards run one at a time: CF-W4-5, LEGAL-SERVE, C7-04d-mount, ROSTER-AUTO, C7-06d, C7-09 and C7-11 (config only).
- C7-09c operator erasure script (skins KV key and Velocity registry), S, after C7-09a.
- M1 Docs and node steps can run beside M2 Golem steps. M1 and M2 share no card except C7-09 (conditional) and C7-06d.
- geldar-93 owns the node steps and the sub-questions. The Entra app and the open step are the owner's.
