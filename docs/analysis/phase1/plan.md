# Phase 1 plan: the colo-first shard

Status as of 2026-11-10, branch `docs/phase1-colo-first`. This plan follows decision [0070](../../decisions/0070-phase1-is-the-colo-first-shard.md), which redefines Phase 1. It uses decisions [0071](../../decisions/0071-public-endpoints-and-ports.md) (endpoints and ports), [0072](../../decisions/0072-glass-and-bluemap-are-public.md) (Glass and BlueMap) and [0073](../../decisions/0073-spec-is-never-edited.md) (the spec is never edited). The spec is `docs/spec.md`. Its text is not changed here.

## (a) Where the spec expected us

**Phase 0, "Adam" (spec section 10, lines 1398 to 1411).** One box, `docker compose up`. Exit (system acceptance):
- an agent survives 5 consecutive in-game days (about 100 real minutes at 20 TPS) and also 24 real hours of continuous operation across restarts, with a bed, food and stone tools;
- at least three durable intents run to completion through chatter and interruptions with no model call;
- every action has a receipt;
- a Body restart mid-intent resumes from checkpoint;
- thought latency is under 15 s;
- the model floor and inference calls per useful autonomous minute are recorded.

**Phase 1, "Village (LAN only)" (lines 1412 to 1426).** Still no internet exposure. The Thinker pool is the owner's home GPUs and the `api-minds` Thinker, on the LAN or the admin VPN.
- Content: proximity chat, books and skills, sleep reflection, hibernation, credits (allowance only), 10 to 15 agents of mixed tiers, world border at 1,500, Historian v0, Thought Stream v1.
- Excluded by the spec: "no permadeath, no Shrine, no lineage, no governance, no sovereign players, no time dilation, no spectator proxy" (line 1414).
- Mechanism demo: one agent develops a procedure, a second acquires it only through a book, and logs show the procedure reducing inference for both.
- Exit (system acceptance, with test agents, line 1418): the mechanism demo passes; a `give` trade completes with receipts; a death and a birth with distinct life IDs; the shrine issues from a bounded pool and a duplicate `offer` is a no-op; ten agents within earshot produce fewer than one model wakeup per agent per real minute; hibernation holds for an hour with a Thinker offline and zero deaths; 7 real days of continuous operation.

**Phase 2, "Open the doors" (lines 1428 to 1441).** The security section gets built.
- Build: DMZ, Gateway (Envoy, mTLS, step-ca), Thinker enrollment, Observatory edge with Entra ID SSO, Velocity spectator proxy, host hardening (8.6), supply-chain pipeline (8.7).
- Move to the colo layout (6.1 internal zone, 6.2 DMZ zone).
- External review of the Gateway and Velocity surfaces (8.9).
- Eight gates before any outsider joins: skills in the process-isolated sandbox; the starter kit passes the malicious-book test; the bot ingress and one game account per life work; every action carries an operation ID and repeats are harmless; a coordinated checkpoint is restored on a scratch shard; bots pass the Body benchmark at 20 TPS at 100%; credits accrue per real hour with reserve-before-dispatch; sovereign players are confined to Watched shards by config.
- Also: an external port scan shows exactly the four ports of 8.9; a revoked Thinker is refused at Envoy; a ghost account is forced to spectator; the first outside Patron enrolls with a signed bundle; chaos day passes (8.9).
- Backups (6.8) are not named in the phase text but are part of the colo layout.

**The spec's own Phase 1 inconsistency.** Line 1414 excludes the Shrine and permadeath. The Phase 1 exit (line 1418) requires a shrine that issues from a bounded pool, and a death and a birth with distinct life IDs. Decision 0070 settles sequencing only: the Shrine and birth are built in wave C4, because the exit needs them. The wording of the spec is not changed.

## (b) Where we are

- **Phase 0 is closed as proof of life** (decision [0066](../../decisions/0066-phase0-closed-as-proof-of-life.md)). Its exit runs are deferred (decision [0064](../../decisions/0064-exit-run-lives.md) for the exit lives). The Phase 0 exit criteria above are therefore not met as written.
- **The fix round is merged** (PR #33).
- **The first sovereign ranger has played** over the MCP and gathered logs in a live run. This is the first real client use.
- **The gaps** are listed in [known-gaps.md](../phase0/known-gaps.md). The ones that matter most for Phase 1 are:
  - the NATS auth overlay has not been tested against a live `nats-server` (S, decision 0067);
  - the component credential reads are not done (M);
  - a crashed Body keeps its life name admissible for up to 60 s, and `players down` does not clear the registry or whitelist (S);
  - Body crash reconciliation is partial (L);
  - the `prepared` receipt is not implemented, so abandoned reflex actions get no aborted receipt (M);
  - the per-life `wait` cursor is still shard-wide (M);
  - the public MCP topology is an owner decision (M, decision 0053);
  - no clean 20-minute live smoke has passed (S);
  - timing-sensitive tests are flaky under load (M);
  - the `bodyConnected` abort and the TPS reader have never run live (M);
  - the spec still has the observers sentence (around line 1584), the owner cap of 3 (5.15.6), and about 30 lines with personal names (owner edits).

## (c) Divergences from the spec

Each row names the spec's position, what we do, and the decision that settles it.

| Topic | Spec says | We do | Settled by |
|---|---|---|---|
| Order of work | Living agent, then village, then doors (section 10 preamble) | Sovereign players are part of the first shard, and the public surfaces come before the village | [0052](../../decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md) to [0055](../../decisions/0055-phase0-sovereign-tool-subset-and-mappings.md) and [0070](../../decisions/0070-phase1-is-the-colo-first-shard.md) |
| Public MCP auth | OAuth 2.1 with an authorization server (6.2, 5.15.3) | Static hashed per-player bearer tokens behind Caddy | [0054](../../decisions/0054-static-hashed-per-player-bearer-tokens.md) and [0071](../../decisions/0071-public-endpoints-and-ports.md) |
| Owner cap | 3 per owner per shard (5.15.6) | 20 per owner, enforced in the database (`sql/0006_owner_cap_trigger.sql`) | [0052](../../decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md) |
| Where the Mind runs | On the Colo's Record/Mind host (6.1, 6.3) | Phase 0 runs the Mind on the owner's desktop. Phase 1 decides in wave C1 | [0050](../../decisions/0050-phase0-mind-processes-run-on-the-host.md) for Phase 0; wave C1 for Phase 1 |
| Edge and ingress | Cloudflare Tunnel and Access recommended (6.2, 8.4) | The shared Caddy on the node, reloaded and never restarted | [0071](../../decisions/0071-public-endpoints-and-ports.md) |
| Observatory SSO | Entra ID SSO for the Observatory (8.4) | Glass and BlueMap are public and read-only, with no login. Grafana and the Create player form stay private | [0072](../../decisions/0072-glass-and-bluemap-are-public.md) |
| Spectator port | TCP 25565 at `play.<domain>` (6.2, 6.4) | A new TCP port on the gateway, with an SRV record for `_minecraft._tcp` | [0071](../../decisions/0071-public-endpoints-and-ports.md) |
| Internet exposure | None until Phase 2 (line 1398) | Public, invite-only, not announced, in Phase 1 | [0070](../../decisions/0070-phase1-is-the-colo-first-shard.md) |
| Rangers | Sovereign players run from Claude Code on Haiku-low (Phase 3, 5.15.7) | The rangers are Claude Code sessions, played over the MCP | [0052](../../decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md) to [0055](../../decisions/0055-phase0-sovereign-tool-subset-and-mappings.md) |
| Skins | Not addressed as a Phase 1 item | Open. No decision in this branch settles skins | Open (owner) |
| Agents per player | Spec 5.15.6 and the player template | Owner cap 20 and an agents-per-player limit, to be measured under load | [0052](../../decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md) and [known-gaps.md](../phase0/known-gaps.md) (scale to 20 agents) |
| Shelter | A bed or a built shelter (spec survival criteria) | Any enclosed safe space counts as shelter | Decision 0074 (not in this branch; in review on another branch) |

## (d) Phase 1 redefined

Phase 1 is **the shard in its final Colo environment, reachable from the internet without a VPN, invite-only and not announced** (decision 0070).

Node constraints, written generically:
- one box with about 8 cores and 16 threads, about 125 GiB RAM, about 1.4 TB NVMe, and no GPU;
- the box is shared with a production game server and with CI runners;
- the standard Minecraft port is taken by another service on the node;
- port 25566 is also taken by another Minecraft service on the node;
- the shared Caddy may be used, and it is reloaded, never restarted (decision 0071).

Consequences of the constraints:
- the shard cannot use the standard port and must use the new TCP port (0071);
- the shard must limit its resources in compose so it does not starve the production game server or the CI runners;
- Thinkers with GPUs stay off the node and join from outside (wave C4).

## (e) Waves

Dependencies: C2b follows C2 (the Glass and BlueMap hardening and the gate check), and C3 follows C2b. Decision 0075 is the record for C2b.

| Wave | Built | Demonstrable at end | Exit check | Owner | Agents | Risks |
|---|---|---|---|---|---|---|
| C0 Decisions | Decisions 0070 to 0073 and this plan | The plan and the decisions are in the index | The decisions are indexed and `check` passes | Owner | Writing | None open |
| C1 Shard on the Colo, internal | The shard on the node, on its own compose network, with limits. Body-host image. Non-PowerShell deploy tooling. Secrets as root-only env files. Backups deferred (0130). Metrics into the node's SigNoz (0130). BlueMap installed. First ranger connects over loopback or a tunnel | A shard runs on the node and a ranger plays it | The first ranger completes a session; no other node service degrades. The restore test and the 20-minute smoke move to campaign end (0130) | Owner: node access through a runner or SSH (no new deploy account, 0130). Backup destination deferred (0130) | Build, test, deploy tooling | Resource contention with the production server; the Mind location decision |
| C2 Doors | Public MCP through Caddy with trusted proxies. NATS accounts overlay live-tested (0067). Velocity on the new TCP port, SRV record, whitelist. Glass and BlueMap public with the hardening of 0072. External port scan. Targeted security review of public surfaces | The four public surfaces answer, the scan shows only the intended ports, and the review has no open high findings | The gate check (below); invitations wait for these gates | Owner: UniFi forward, DNS records, tokens policy | Build and test | Public exposure bugs; tokens policy for outsiders |
| C2b Lakitu | An invisible, read-only world data feed from the plugin; a web renderer with a collision-bound follow camera; owner and admin targeting; multi-pane views; an audit log (0075) | An owner opens the Glass, picks an agent of theirs, orbits the camera with collision, opens a second pane on another agent; an admin sees all; nothing is visible in game or in agent-visible text | The leak test (tab list, entity list, agent snapshots with a camera up) is automated and revert-checked; the collision test passes; the per-session cap holds | Owner: auth choice (interim tokens or a small login), texture licence, anonymous versus login cameras (0075) | Build and test | Renderer scope; data-feed load on a shared node; texture licensing; public versus login cameras (the 0072 tension) |
| C3 Population and operability | Roster and cap in the database. N-bot Paper benchmark on the node. Runbooks. Chaos day and 7-day soak tooling (both run once at campaign end, 0130). Intent persistence for sovereign players. Honest sleep mark. Shelter intent and `build`, callable by agents | Tooling built and short tests pass; 10 to 15 agents soak for 7 days and a chaos day passes at campaign end (0130) | C3 exit: short tests pass. The soak meets the Phase 1 exit (7 real days, fewer than one wakeup per agent per real minute) at campaign end | Owner: runbook review; chaos day sign-off at campaign end | Build, soak tooling, runbooks | Benchmark results on shared hardware; sovereign persistence gaps |
| C4 Village features on the Colo | The spec's Phase 1 content: proximity chat, books and skills, sleep reflection, hibernation, credits (allowance only), shrine and birth. Thinker gateway so desktop-GPU agents can join | The mechanism demo passes on the node; the Phase 1 exit items pass | The spec Phase 1 exit (line 1418), with test agents | Owner: Thinker enrollment, GPU hosts | Build and test | The exit wording conflict; the Thinker gateway's security |

### C0 Decisions (done)

- **Built:** decisions 0070 to 0073, indexed. Decision 0070 redefines Phase 1 and moves the public endpoints and backups into Phase 1. Decision 0071 sets the TCP port, the SRV record and Caddy. Decision 0072 makes Glass and BlueMap public. Decision 0073 keeps the spec unedited.
- **Demonstrable at end:** the plan and decisions are indexed and reviewed.
- **Exit check:** `check` passes on this branch.
- **Owner vs agents:** owner decides; agents write.
- **Risks:** none open.

### C1 Shard on the Colo, internal

- **Built:**
  - the production Linux compose file on its own network, with CPU and memory limits;
  - a Body-host image that runs on the node;
  - deploy tooling written for Linux, not PowerShell;
  - secrets as root-only env files, with no secret in the repo;
  - deployment through the node's existing runner or the owner's SSH access, with no new deploy account (decision 0130);
  - backups deferred (decision 0130: scope B accepted; destination and build deferred); the append-only journals (C1-05a) stay in C1;
  - metrics into the node's SigNoz (decision 0130);
  - the BlueMap plugin, pinned and installed;
  - the first ranger connects over loopback or a tunnel.
- **Demonstrable at end:** a shard runs on the node, and a ranger plays it.
- **Exit check:** the first ranger finishes a session; the production game server and CI runners show no degradation. The backup restore test and the 20-minute Adam smoke move to the campaign end (decision 0130).
- **Owner vs agents:** the owner grants node access through a runner or SSH, with no new deploy account (decision 0130). The backup destination is deferred. The owner chooses the Mind location. Agents build and test.
- **Risks:** contention with the production server; the Mind location (spec 6.1 says the Colo, Phase 0 says the desktop).

### C2 Doors

- **Built:**
  - public MCP through Caddy, with Caddy as the only trusted proxy and the client-address header read only from Caddy (0071);
  - the NATS accounts overlay tested live against a real `nats-server` (0067, known-gaps row 1);
  - Velocity on the new TCP port, with the SRV record and a whitelist;
  - Glass and BlueMap public, with the hardening listed in 0072: rate limits, a request size cap, no secrets in responses, escaped agent text under a strict CSP, a delay option, and a kill switch;
  - an external port scan;
  - a targeted security review of the public surfaces, covering the DMZ hardening of 8.6, the supply chain of 8.7, and the external review of 8.9.
- **Demonstrable at end:** the public MCP, Velocity, Glass and BlueMap answer from outside, and the scan shows only the intended ports.
- **Exit check (the gates):** the external scan shows only the intended ports; the public surfaces pass the 0072 hardening tests; the NATS overlay passes its live test; the review has no open high findings. Invitations wait until these pass (0070, consequence 3).
- **Owner vs agents:** the owner creates the UniFi forward and the DNS records, and decides the tokens policy for outsiders. Agents build, test and scan.
- **Risks:** public exposure bugs; the tokens policy for outsiders; the privacy review of Glass text (0072, item 4).

### C2b Lakitu

- **Built:**
  - an invisible, read-only world data feed from a plugin in Geldar-Core: chunk sections around the targeted agents, block updates, and agent and entity positions, with the schema in `contract/` (0075, points 1, 2 and 7);
  - a web renderer in the Glass (WebGL), with a free-fly follow camera that is bound by collision against the same voxel data (0075, point 3);
  - owner and admin targeting: an owner picks among the agents of their players, an admin among all agents (0075, point 4);
  - several independent panes per Glass page, each with its own target and mode (follow, orbit or free), under a per-session cap (proposed 4) enforced by the feed (0075, point 5);
  - an audit log of who watched which agent, and when, with no secrets (0075, point 6).
- **Demonstrable at end:** an owner opens the Glass, picks an agent of theirs, orbits the camera around it with collision, and opens a second pane on another agent. An admin sees every agent. Nothing is visible in game or in agent-visible text.
- **Exit check:** the invisibility leak test (tab list, entity list, and agent snapshots with a camera up show no trace) is automated and revert-checked; the collision test passes; the per-session cap holds.
- **Owner vs agents:** the owner chooses the auth interim (static tokens or a small login), the texture licence, and whether anonymous visitors get cameras (0075, owner items). Agents build, test and check the leak test.
- **Risks:** renderer scope; data-feed load on a shared node; texture licensing (no Mojang assets in the repo); public versus login cameras, which is a tension with 0072 that stays open until the owner decides.

### C3 Population and operability

- **Built:**
  - the roster and the cap in the database;
  - the N-bot Paper benchmark tooling (the long run is at campaign end);
  - runbooks, including the Glass and BlueMap kill switch and the privacy review checklist;
  - the chaos day tooling (the chaos day runs at campaign end);
  - the 7-day soak tooling for 10 to 15 agents (one soak, run at campaign end; the 72 h gate is withdrawn);
  - intent persistence for sovereign players (known-gaps: sovereign intents write no rows today);
  - an honest sleep mark;
  - the shelter intent and `build`, callable by agents (decision 0074).
- **Demonstrable at end:** the tooling is built and the short tests pass. The 7-day soak, the chaos day and the N-bot long benchmark run once at the campaign end (decision 0130).
- **Exit check (C3):** the short tests pass. The soak meets the Phase 1 exit targets (7 real days, fewer than one model wakeup per agent per real minute while intents run) when it runs at campaign end. The chaos day has a written result at campaign end.
- **Owner vs agents:** the owner signs off the runbooks, and the chaos day at campaign end. Agents build the benchmark, the chaos tooling and the soak.
- **Risks:** benchmark results on shared hardware; the missing intent rows for sovereign players, which make attempts hard to reconstruct.

### C4 Village features on the Colo

- **Built:** the spec's Phase 1 content: proximity chat, books and skills, sleep reflection, hibernation, credits (allowance only), the Shrine and birth (because the exit needs them, decision 0070), and a Thinker gateway so that desktop-GPU agents can join from outside the node.
- **Demonstrable at end:** the mechanism demo passes on the node, and the Phase 1 exit items pass.
- **Exit check:** the spec's Phase 1 exit (line 1418), run with test agents.
- **Owner vs agents:** the owner enrolls the Thinkers and the GPU hosts. Agents build and test.
- **Risks:** the Thinker gateway's security; the exit wording conflict (see (a)).

## (f) Open owner items

1. A UniFi TCP forward for the new Minecraft port (0071).
2. The backup destination (6.8). Deferred by decision 0130 (scope B accepted; destination and build deferred).
3. A deploy account with Docker access on the node. Answered by decision 0130: deploy through the node's runner or the owner's SSH access, with no new deploy account.
4. Go-ahead to create DNS records. Proposed names under the project subdomain: `glass`, `map`, `mcp`, and `play` with an SRV record for `_minecraft._tcp`. DNS lives in Azure DNS (0071).
5. The tokens policy for outsiders (0054, 0070).
6. The naming question for the rangers, which touches a third-party trademark. This is not settled in any decision.
7. Identifiers in the public repo history. The spec carries personal names in about 30 lines (known-gaps). Whether any identifiers in the history need removal is not yet checked.
8. Confirm the reading of decision 0070 that invitations wait for the gates (0070, consequence 3).
9. The spec amendments listed in [docs/decisions/0073](../../decisions/0073-spec-is-never-edited.md): the observers sentence, the owner cap of 3, the terms "player" and "agent", and the personal names.
10. Anonymous or login cameras (0075, the open fork). Decision 0072 makes the Glass public with no login. The recommendation is that anonymous visitors get the thought stream and the map only, and Lakitu cameras need an owner or admin login. The owner confirms this, which moves 0075 from Proposed to Accepted, or chooses otherwise.

## (g) Lessons from the first ranger run

These shape waves C1 to C3.
- **Client tools with a top-level `oneOf`, `anyOf` or `allOf` are silently dropped** by Claude Code. The `act` and `write_book` tools were missing from `tools/list`. The guard test is `contract/test/mcp-toplevel.test.ts`. Every wave needs a real-client check.
- **Empty perception when standing on a canopy** was fixed for near range (`standing_on`, `block_above_feet`, and counts within radius 8). The prompt does not render these fields yet, which needs a prompt v5 decision in Phase 1.
- **A no-plan wake was misrendered as a failed intent**, now fixed by 0069.
- **MCP container recreation replays the last 60 minutes of Body events**, deduplicated by `seq`. This needs a bound in C1 and a test in C3.
- **Mocks pass where real clients fail.** A real-client live test is part of every wave's exit check.
- **Sovereign intents leave no rows** in `intents`, `actions` or `receipts`. Only events are kept, so attempts cannot be rebuilt from the database. C3 fixes this.
