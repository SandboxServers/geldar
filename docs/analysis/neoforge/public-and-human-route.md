# Public NeoForge shard and the human route (design note)

- Status: design note, docs only. Written 2026-11-17 for the owner decision of the same date (via the lead): the live NeoForge shard is PUBLIC, uses the shared Caddy, and allows HUMAN connections. Updated 2026-11-17: D-1 is decided (humans are players on the NeoForge shard; [decision 0387](../../decisions/0387-neoforge-shard-is-human-directed.md)); the connection method is decided (SRV only, section 3). Nothing public happens until the owner approves the exact names, port and bind (section 8).
- Base: `origin/main` at dd7a65fe. Other branches are named as branches, not linked, because they are not on main.
- Placeholders only: `<play-name>`, `<map-name>`, `<node>`, `<port>`, `<domain>`, `<abuse contact>` (see section 5). No real IP, hostname, account name or secret appears here.
- UNVERIFIED means: not shown by a test or a read of the repo. Each one names the test that would settle it.

## 1. Goal and what stays unchanged

Goal: a human with a Microsoft account can reach the live NeoForge shard in a vanilla client, read its map and status on the web, and be known to the project as a human, through the same Colo node and the same shared Caddy that serve the other public sites.

| Stays unchanged | Why (cite) |
|---|---|
| The autonomous shard. No human acts inside it. Its Velocity stays offline-mode, unpublished, and reachable only on its own compose network. | Principle 1 in [spec section 2](../../spec.md) ("Humans never speak, build, give items, or intervene"); [0137](../../decisions/0137-public-spectator-proxy-is-separate-and-online.md) (bot ingress never published). |
| The bot ingress and the human lane are two listeners with two Velocity services. A human never reaches the bot listener. | 0137, "Two Velocity services". |
| Port 25565 and port 25566 are never published. | [deploy/README.md](../../../deploy/README.md) (`GELDAR_MC_PORT` rule, `colo-status.sh` check); [0082](../../decisions/0082-colo-compose-network-and-limits.md). |
| Agents are never told that humans watch or can join. | [0059](../../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md); [0068](../../decisions/0068-prompt-v4-and-agent-visible-text.md). |
| Humans earn nothing, hold no marks, cannot trade, post, accept or award. | [progression-defaults.md](progression-defaults.md) Q9 (B6). |
| The spec is not edited by agents. | [0073](../../decisions/0073-spec-is-never-edited.md). |

**Principle conflict (D-1, decided 2026-11-17; [decision 0387](../../decisions/0387-neoforge-shard-is-human-directed.md)).** The owner's answer: humans are PLAYERS on the NeoForge shard, the human-directed shard. The autonomous shard stays agents-only, and Principle 1 ("Humans never speak, build, give items, or intervene") holds there unchanged. Decision 0387 supersedes 0137's spectator-proxy rule for the NeoForge shard's human listener only. We do not edit `docs/spec.md`: Principle 1 and the role table (Ghost: "A human spectator account. Invisible, silent, cannot interact.") still say humans never act. The owner must either edit the spec to carve out the human-directed shard or accept 0387. Until one of those happens, the spec and 0387 disagree for the NeoForge shard. Sections 4 to 6 assume players for the NeoForge human listener.

## 2. The web side through the shared Caddy

Facts from the repo:
- The shared Caddy (`board-proxy`) has its admin API OFF (owner ruling R39). A change to a live file is one operator `docker restart board-proxy`. `caddy reload` does not work there ([deploy/caddy/README.md](../../../deploy/caddy/README.md), "Reload procedure").
- Sites are installed by `deploy/colo-public.sh install <site>`. The script keeps a list in `SITES="map glass mcp"` (line 17). Each site has a live file `deploy/caddy/<site>.caddy` and a kill switch `deploy/caddy/<site>-off.caddy`. Names are rendered from a root-only env file (`GELDAR_PUBLIC_ENV`), never from the repo. Install mode `restart` validates and then asks for one `docker restart`.
- Read-only sites keep the same rules: only GET and HEAD, a 1 KiB body cap, the address headers stripped, `header -Server`, and `x-geldar-client-ip` set from `{remote_host}` ([map.caddy](../../../deploy/caddy/map.caddy) is the pattern; `mcp.caddy` is the POST site).

| Item | Proposal | Status |
|---|---|---|
| Served content | A status page and, if a map is served, the map. BlueMap is planned P5, so the map is optional for the first install. | Owner picks. |
| Site file | `deploy/caddy/nf-<site>.caddy` and `nf-<site>-off.caddy`, copied from `map.caddy` with the upstream `GELDAR_NF_<SITE>_UPSTREAM`. Add `nf-<site>` to `SITES` in `deploy/colo-public.sh`, and a line in the public-sites section of `deploy/README.md`. | Proposed. The `-off` file must exist before the live one. |
| DNS names | One name per role: the play name (`<play-name>.<domain>`) and the map name (`<map-name>.<domain>`). A game name needs no web site, but its address must match the public port (section 3). | Owner names them. Ops creates the records later. No real name is written here. |
| Restart and outage | One `docker restart board-proxy` for the first install and for every later change of a live file. It drops connections on EVERY site behind the shared Caddy (Geldar and non-Geldar), and the `mcp.caddy` SSE streams reconnect. | Estimate 5 to 15 seconds plus certificate load (deploy/caddy/README.md). UNVERIFIED on the node: measure at the first window and write it back. |
| Window | Batch the NF site with any other live change. The install needs the lead's window and the owner's OK. | Lead approval, owner OK. |
| Registration page | `glass.<domain>` already proxies `/register*` and `/roster*` when `GELDAR_REGISTER_UPSTREAM` is set. `register.caddy` is not loaded by `colo-public.sh`. | Existing; see section 4. |

Pre-validation before the restart is the baseline comparison in deploy/caddy/README.md steps 3 and 6: one request per site, status for status, before and after. The NF site joins that baseline.

## 3. The game port: Caddy is HTTP only

Caddy proxies HTTP. A Minecraft client speaks TCP and the Minecraft protocol, so Caddy cannot carry the game. The repo already has one public game publish: `compose/colo-public.yml` adds one line to `velocity`, `"${GELDAR_MC_BIND:?}:${GELDAR_MC_PORT:?}:25565"`. The bind is one IPv4 literal and the port is 1 to 65535, never 25565 or 25566. The loopback-ports check allows exactly that entry and nothing else ([deploy/README.md](../../../deploy/README.md), section on public Minecraft; `tools/repo-checks`).

| Option | How it works | Pros | Cons |
|---|---|---|---|
| (a) Direct publish on the non-standard port named by the SRV record: the NF human Velocity, bound to one public IPv4 literal on the node. **Chosen route.** | One overlay like `colo-public.yml`, for the NF project, with its own env names. Players connect by the play name; the SRV record (c) supplies the port. | Smallest. Same pattern the repo already checks. No new software. | The port is open on the node's public interface, so an operator firewall rule is still needed. Other tenants share the node (below). |
| (b) A TCP proxy in front. (b1) Caddy layer4 plugin: not in the standard image (UNVERIFIED, check the image digest). (b2) A small separate proxy container in the NF project. | The proxy listens on the public port and forwards TCP to the human Velocity. | Can add connection caps and logging in one place. Keeps the Velocity unpublished. | A new service to build, pin and check. The proxy itself is then the public surface. Needs its own review. |
| (c) SRV record `_minecraft._tcp.<play-name>.<domain>` to the non-standard port, so players type the play name only. **Chosen as the name-resolution method** (owner, 2026-11-17). | DNS points the game name at the (a) or (b) port. | Players type one name, with no port. | An SRV record points at a TCP port. It hides the port number from players only; it does not open the port. The public non-standard port still has to be opened by an operator firewall rule. Still needs (a) or (b) for the port. The SRV record is an ops DNS change, created later. Clients that ignore SRV need the port. |

**Decision (owner, 2026-11-17).** The game port is by SRV only: option (c) is the name-resolution method, and the route is (a), direct publish on the non-standard port named by the SRV record. Option (b), a TCP proxy, remains as a fallback if the owner wants connection caps at the edge (b2). Plainly: an SRV record still points at a TCP port, so the public non-standard port still has to be opened by an operator firewall rule. The SRV record only hides the port number from players. The exact port, the bind literal and the DNS names still need the owner's explicit approval before anything is opened; the lead brings them as one batch. Never 25565 or 25566 (the rule in `compose/colo-public.yml` and [deploy/README.md](../../../deploy/README.md)).

**Other tenants on the node.** The node also runs a production game server (per the comment at the top of `compose/colo.yml`, which never publishes 25565 or 25566), CI runners, the Colo stack and the autonomous shard. A new public port adds: a DDoS and scan surface on the same address; connection-flood load on a shared host; CPU and memory cost on a host with fixed Velocity caps (`GELDAR_COLO_VELOCITY_CPUS` 0.5, `GELDAR_COLO_VELOCITY_MEM` 1024m in `compose/colo.yml`; the NF caps must be set the same way). Per-source connection rate and login throttle must be set on the human Velocity (0137 lists "login rate limit on" and "max 5 players" for the public proxy; the Velocity `login-ratelimit` key is UNVERIFIED for version 3.5.1 in `compose/velocity/velocity.toml`).

**Firewall and host exposure.** The node firewall must open the one port on the one bind address only. Who does it: operator or ops, on the owner's exact port and bind. Owner approval item O-3.

## 4. Human authentication and identity

**Current state (VERIFIED by repo read).**
- The bot ingress `compose/velocity/velocity.toml` has `online-mode = false` (line 9), `player-info-forwarding-mode = "modern"` with a forwarding secret file (lines 12 and 13), and `try = ["paper"]`.
- The identity gate ([plugin/velocity-identity](../../../plugin/velocity-identity)) admits a connection only when its lowercase username is in the NATS KV bucket `geldar-life-registry` (`LifeRegistry`: username to `{life_id, registered_at}`), through `LoginGate.admit(uuid, name)`. Login reads the local copy and never NATS. A denial goes through `DenialLimiter`. Skins are looked up only for registered lives.
- A human is not in the life registry. So a human is refused by the gate today, by design.
- Offline-mode UUIDs: [p0-findings.md](p0-findings.md) row 3 (PASS, with a limit) says the server's UUID equals the standard offline-mode UUID (UUIDv3 of MD5 of "OfflinePlayer:" plus the name). It was recomputed, not compared with a Paper run. Criterion 4 (a human vanilla client) is NOT RUN.
- Velocity's modern forwarding carries the name and UUID that Velocity has for the player. Online-mode UUID under forwarding to a Proxy Compatible Forge (PCF) server: UNVERIFIED. The P0 probe covered offline mode only.

| Lane | Listener | Auth | UUID | Name | Admit rule |
|---|---|---|---|---|---|
| Agent (Body) | Bot ingress, offline-mode, unpublished | none (offline) | offline UUID, derived from the name | agent life name from the life registry | name in `geldar-life-registry` |
| Human | Human Velocity, online-mode, published on `<port>` | Microsoft account (Mojang session) | the account's UUID (UNVERIFIED shape) | the account's name | UUID in a human registry (proposed), not in the life registry |

**Test of online mode (UNVERIFIED, needs an owner-started tunnel).** Run a real Microsoft account against the scratch Velocity on a loopback port reached by an owner-started SSH tunnel. Record the UUID and name the scratch Paper or mod sees, and whether they equal the account's UUID. This is lane (A) in section 7.

**Whitelist or registration.** The register service (`threshold/register`, served under `glass.<domain>/register`) does Microsoft sign-in only, with a kill switch that is on by default ([deploy/README.md](../../../deploy/README.md), register row; [open-signup runbook](../../runbooks/open-signup.md)). It owns sign-in, the account page and the player token. The register service does not know NeoForge. What to hand to it (the human lane):
1. A human record keyed by the Microsoft account UUID (not the name): `human_id`, `status` (active, revoked), `registered_at`, the owner's acceptance of the terms version.
2. The NF public proxy checks that record at login. Whitelist by UUID, per spec 8.4 and 0137, is the first step; self-registration is the second and needs the owner gate.
3. Deletion and export of the human record follow [0153](../../decisions/0153-terms-consent-and-deletion-before-sign-up.md) and the legal texts; they are not in this note.

Conflict to decide (D-4): [0135](../../decisions/0135-self-registration-with-github-and-discord.md) says self-registration with GitHub and Discord. The deployed register is Microsoft only. The owner must say which route humans use.

**Keeping humans and agents apart (the smallest design).**
- Names: agent usernames are the life names in the registry (the brief's `ag_xxx` shape is UNVERIFIED for NF; check the life-id generator before relying on it). A human name is any Microsoft display name, so a human could pick a name that looks like an agent's. Rule R-1: the human proxy refuses any name that is in the life registry, and any name that matches the agent life-id pattern. The registry check runs on every login, not only at registration.
- UUIDs: the gate keys humans on the online UUID and agents on the name. An online UUID is random (version 4 shape, UNVERIFIED in the repo) and an agent UUID is UUIDv3 of "OfflinePlayer:"+name. Rule R-2 (as 0387 item 5 (c)): the human listener refuses any session whose UUID equals the offline-mode UUID of the claimed name, so no agent UUID can come through the human route. The check is a unit test on the gate (A3). Whether an online session can ever produce that UUID is UNVERIFIED (A2).
- Network: the bot ingress is not published and only the human proxy is. A human cannot reach the bot listener from outside.
- Paper: keeps its own whitelist by UUID and fails closed (0137, "Paper fails closed").

**Smallest human lane in the gate (for the NF plugin, not built here).** A mode flag on the NF identity plugin (the public mode 0137 describes). In public mode: `admit` looks up the online UUID in a human registry bucket (proposed name `<human-bucket>`, a separate KV bucket, not `geldar-life-registry`), refuses names in the life registry (R-1) and offline UUIDs (R-2), applies the cap (max 5, 0137) and the denial limiter, and never writes to the life registry. A human record can never create or change a life. Tests with a fake registry (section 7, lane A4).

**No human acts in the autonomous shard.** The autonomous shard has no human lane. Its Velocity stays offline and unpublished. Per-shard storage (D1 and D5 in `phase1/nf-per-shard-storage-design`, `docs/analysis/neoforge/per-shard-storage-design.md` on that branch) keeps the NF NATS and database separate from colo's.

## 5. Rules and safety

**Abuse and rate limits.**

| Control | Where | State |
|---|---|---|
| Connection rate per source address | Velocity `login-ratelimit` or the (b2) proxy | UNVERIFIED for 3.5.1 in this repo |
| Login throttle and denial limit | `DenialLimiter` in the identity plugin | Exists (bot lane); the human lane must reuse it |
| Concurrent human cap | Public proxy, max 5 (spec 8.4, 0137) | Owner may change (D-9) |
| Ban list | Velocity ban or the human registry `status` | Proposed: `status = revoked` in the human bucket; no ban file |
| Caddy site limits | `deploy/caddy/README.md` "Rate limits" and the body cap | Exists for the web side |
| Kill switch, human lane | Stop the human Velocity, or set the human registry to refuse all | Proposed; the kill switch is a restart (the Caddy kill is the `-off` file plus a restart) |

**What a human can see or do on the NF shard.** Decided (D-1, 0387): (ii), a player who acts in the world. Option (i), spectator or ghost (spec role table, Ghost; 0137 ghost rule), remains the rule for the autonomous shard, where no human acts. The public web side is the Glass and the map. They are read-only and do not show prompts ([0072](../../decisions/0072-glass-and-bluemap-are-public.md), [0093](../../decisions/0093-glass-hardening.md)), and the player decision does not change them.

**What a human earns.** Nothing: no marks, no stipend, no trade, no post, no accept or award ([progression-defaults.md](progression-defaults.md) Q5 and Q9). Only UUIDs that resolve to a registered agent life have records.

**Legal and registration text for public players (audience: players).** Files, with what must be reviewed or handed to registration:

| File | State | Review needed for human players on NF |
|---|---|---|
| `docs/legal/terms.md` | Version 1, effective 2026-11-11, approved by the owner ([0155](../../decisions/0155-legal-text-v1-approved-and-contact-published.md)) | Does it cover a human who plays on a Minecraft server, not only a sovereign agent's account? Owner review: a version bump. |
| `docs/legal/privacy.md` | Same | What is kept about a human's in-game actions (telemetry, chat, position); section on retention (D-F, section 6). |
| `docs/legal/acceptable-use.md` | Same | Game rules for humans (no harassment, no griefing, no cheats), and what a human may not do to the agents. |
| Consent at sign-up | register service | A human must accept the version before the human record is created (handover to registration). |

**Abuse contact.** The contact address is published in `docs/legal/` (decision 0155 says the abuse address is published there). This note cites the files, not the address: the address is written there only. In this note it is `<abuse contact>`.

## 6. Telemetry

- Nothing about observing or joining humans may reach an agent. This is the identity_mode rule ([0059](../../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md)); the agent-visible wording lint lists "human" and "watch" in `contract/src/agent-text.ts` (MARKER_WORD, [progression-defaults.md](progression-defaults.md) Q2). The human route adds no agent-facing tool or prompt text.
- Human telemetry follows the owner's defaults, which are "keep as built" ([neoforge-telemetry.md](../telemetry/neoforge-telemetry.md), the closing paragraph at line 228, D-A to D-J as built; nothing exports until an enablement window). For humans: D-A (human actors with no id but with position and time), D-B, D-C, D-D as built.
- OPEN: D-F, "human chat, sign and book verbatim with no speaker id" ([RESUME.md](../telemetry/RESUME.md) line 34). Verbatim text with no speaker id is a privacy question for the owner (D-5, section 8). Until it is answered, nothing human-written is exported.
- Human events go to a human-scoped subject or are dropped before any agent-facing store. The subject naming is UNVERIFIED for NF (the per-shard design, on branch `phase1/nf-per-shard-storage-design`, records that the `events` table has no shard column).

## 7. Order of work

**(A) Built and tested on the SCRATCH stack first.** Scratch is `compose/opt-in/scratch-neoforge.yml` (on branch `phase1/nf-live-compose`, not main). No public port, no Caddy, no DNS.

| Packet | What | Test | Approval |
|---|---|---|---|
| A1 | A human vanilla client through an owner-started SSH tunnel to the scratch Velocity's loopback port. | Join, see the world, leave. Record the client version and the server reply (capture before writing a parser). | Owner starts the tunnel and provides the account. No secret in the repo. |
| A2 | Online-mode UUID and name under PCF and modern forwarding. | The scratch Paper or mod sees the account's UUID and name. Compare with the Microsoft account's UUID. Closes the UNVERIFIED in section 4. | Owner account, owner-started tunnel. |
| A3 | Human lane in the gate, with a fake registry. | Unit tests: name-only match refused; agent name refused (R-1); offline UUID refused (R-2); unknown UUID refused; revoked refused; cap of 5 respected; limiter denies after the threshold; the bot lane unchanged. Revert-check: the R-1 and R-2 checks must fail without them. | None (no live use). |
| A4 | Human-listener config on scratch only (0387). | `velocity.toml` for online mode and the cap; the loopback-ports check still passes. | None. |

**(B) Waits for the live project and the owner's exact names and ports.** Each packet below lists its paths, the colo-images trigger and its approvals. The colo-images trigger is the path filter in `.github/workflows/colo-images.yml`. `plugin/velocity-identity` is NOT on that filter; `plugin-jars.yml` builds the jars on any push to main that changes `plugin/` (confirmed by reading both filters).

| Packet | Paths | colo-images trigger | Size | Tests | Approvals |
|---|---|---|---|---|---|
| B1 DNS records | none in the repo (ops) | no | S | a resolve check after the owner names | Owner names; ops creates |
| B2 Caddy site | `deploy/caddy/nf-<site>.caddy`, `deploy/caddy/nf-<site>-off.caddy`, `deploy/colo-public.sh` (SITES), `deploy/README.md` | no (`deploy/**` is not on the filter) | S | `caddy validate` in a throwaway container; baseline comparison (deploy/caddy/README.md step 6) | Lead window (one `board-proxy` restart, every site down for 5 to 15 s, estimate); owner OK |
| B3 Public port overlay | `compose/nf-public.yml` (pattern of `compose/colo-public.yml`), loopback-ports check in `tools/repo-checks` | no (`compose/**` and `tools/repo-checks` are not on the filter) | S | `docker compose config --quiet` with the overlay; the check rejects any other publish | Owner: port and bind literal; operator opens the firewall |
| B4 Human lane in the gate | `plugin/velocity-identity` (public mode, human bucket) | no (plugin-jars.yml builds jars instead) | M | section 4 tests (A3), plus a live-shaped check on scratch (A1 and A2) | Owner OK for the bucket name; lead window for the NF deploy |
| B5 Human record and registration hand-off | `threshold/register/**`, `glass/**`, `sql/**` (new table or role), `tools/migrate/**` | yes for each path listed | L | register tests; migration on scratch Postgres; sign-in check with a real account | Owner (sign-in, terms version); geldar-registration owns the code; open-signup runbook gate |
| B6 Telemetry for humans | `golem/**`, `eventsink/**` (human subject, no agent-facing read) | yes for each path listed | M | eventsink validate tests; a test that no agent tool reads a human event | Owner answers D-F first |
| B7 Legal text version bump | `docs/legal/terms.md`, `privacy.md`, `acceptable-use.md` | no | S | `legal-drafts.test.ts` (version line, contact present, no DRAFT) | Owner approval of the new version |
| B8 Spec decision | `docs/spec.md` (owner edit only; agents never edit it) | no | S | none | Owner (D-1) |

Order (updated 2026-11-17): A1 to A4 first (A3 is the human lane in the identity gate with a fake registry; A4 is the human-listener config on scratch). Do NOT start B5 and B6: their paths are on the colo-images filter, and they wait for the owner's answers (B5 also for the registration route, D-4). B2, B3 and B4 wait for the owner's names and the live project; then B2 and B4 together in one lead window, and B3 with them. B1 is ops DNS, after the owner names. B7 is owner text work. B8 (the spec) is the owner's to edit or to accept 0387; agents never edit `docs/spec.md`. D-F (telemetry, D-5) stays open. The public game port is the last public step, after B2 passes its baseline.

## 8. Owner decision list and open questions

| # | Decision | Default in this note |
|---|---|---|
| D-1 | **DECIDED 2026-11-17 (0387):** humans are players on the NeoForge shard; the autonomous shard stays agents-only. The spec (Principle 1, role table) is the owner's to edit or to accept 0387. | Decided. |
| D-2 | Public names: the play name and the map name (`<play-name>`, `<map-name>`), and the DNS names. | None chosen. |
| D-3 | **Connection method DECIDED 2026-11-17: SRV only (c) for the name, with route (a), direct publish on the non-standard port the SRV record names; (b) TCP proxy is the fallback.** Still OPEN: the port number and the bind literal (the owner names them; an operator opens the firewall rule). Never 25565 or 25566. | Method decided; port and bind owner-named, then approved in the lead's batch. |
| D-4 | Registration route for humans: Microsoft only (deployed) or GitHub and Discord too (0135). | Microsoft only. |
| D-5 | Human chat, sign and book verbatim with no speaker id (telemetry D-F). OPEN. | Not exported until answered. |
| D-6 | Online mode for the human lane (proposed: online, as 0137 requires for the public proxy). | Online. |
| D-7 | Retention for human chat and human events. | None chosen. |
| D-8 | Abuse contact: confirm `docs/legal/` as the source and the address to publish. | `<abuse contact>` in this note. |
| D-9 | Human caps: concurrent players (spec 8.4 says 5), per-owner cap, and the CPU and memory caps for the NF human proxy. | 5 concurrent. |
| D-10 | Caddy window (one `board-proxy` restart, all sites down 5 to 15 s, estimate) and the firewall window for the port. | Lead to schedule. |
| D-11 | Which `identity_mode` the NF shard file carries. `watched` (0059) means humans may observe and never tell the agents; it does not mean humans may act. | Owner to decide with D-1. |

Open questions for the record: (1) the life-id name shape for NF agents (UNVERIFIED); (2) online-mode UUID under PCF (UNVERIFIED, A2); (3) Velocity `login-ratelimit` in 3.5.1 (UNVERIFIED); (4) the real outage of one Caddy restart on the node (estimate only); (5) whether the Caddy layer4 plugin is in any pinned image (UNVERIFIED; not needed for the recommendation); (6) whether the NF project is `geldar-nf` as the per-shard design names it (its D8, on branch `phase1/nf-per-shard-storage-design`).
