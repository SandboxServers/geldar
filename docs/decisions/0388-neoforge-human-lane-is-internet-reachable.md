# 0388. The NeoForge human lane is internet-reachable

- Status: Proposed. The owner accepts or edits this record. Nothing here is in force, built on a node or opened. See the status line below.
- Date: 2026-11-18
- Spec: section 2 (Principle 1), section 8.4 (spectator proxy). Builds on 0387 (items 3, 4 and 5), 0137 (item 1: the cap of 5 and the login rate limit, with the cap amended for the NeoForge shard below; item 3: least privilege), 0375 (chat export off), 0386 (the compose project). Its operator steps are in [docs/runbooks/nf-live-project.md](../runbooks/nf-live-project.md), section 10. The owner chose identity option (a) on 2026-11-18 (section "Owner question").

**Status line (explicit).** This record is PROPOSED. The lane must NOT go public until (1) the merged #726 plugin (the concurrent-human cap of 5 as merged, and the fail-closed registry gate) is DEPLOYED on the human proxy (the jar the human proxy mounts on the node is the one built from main with #726), (2) the H6 PR (the lane's own NATS inbox prefix) is merged and deployed AND the node's `nats-auth.conf` has been regenerated so the `human` user holds `_INBOX.human.>` only (the NF_HUMAN gate will refuse a conf that still has the broad grant; that refusal is required in the H6 PR and is NOT yet in the code, see residual risk 9), (3) S1 (runbook section 10) has passed on the LAN, (4) the owner has accepted this record and approved each step, and (5) the H1c2 PR (the human lane refuses `ag-` as well as `ag_`, owner decision 2026-11-18) is merged and deployed on the human proxy. Until all five hold, the human port is closed to the internet.

## Decision

1. **Humans are players on the NeoForge shard (0387).** The NeoForge human lane is reachable from the internet. Anyone with a Microsoft (Mojang) account who passes the lane's refusals may join. The shard has no server whitelist (owner, 2026-11-17, 0387).
2. **The public name is an SRV record only.** Players type the hostname and no port. The SRV record names the human port. The game port is TCP, so Caddy is not involved (Caddy serves HTTP and HTTPS). The gateway that forwards the port is owner-owned, and the owner removes it to roll back.
3. **The agent lane stays loopback-only.** The agent Velocity stays on `127.0.0.1:46565`, unchanged. Nothing on the human side reaches it: the human network carries only the human proxy, NATS and the NeoForge server.

## What is built

On the human-lane stack (branch `phase1/nf-human-inbox`, H6, tip 46cdf15a, which contains the H5 tip 9aa37c1f; the repo tests pin each item):

- **Human overlay** `compose/nf-live-human.yml`: one service, `velocity-human`, on its own network `nf-human` only. `nats` and `neoforge` join `nf-human` as well, so the forced backend and the NATS URL resolve there. Nothing else joins it. The one published port is `${NF_HUMAN_BIND:-127.0.0.1}:${NF_HUMAN_PORT:-46566}` to container port 25565. The service is `read_only`, `cap_drop: ALL`, has `no-new-privileges`, runs as the service uid, and mounts the identity jar read-only with `create_host_path: false`. Its restart policy is `"no"` (`compose/nf-live-human.yml:108`): nothing restarts the proxy after a failed start or a host reboot.
- **Inbox prefix (H6)**: the human proxy has its own NATS inbox prefix, `GELDAR_NATS_INBOX_PREFIX: "_INBOX.human."` (`compose/nf-live-human.yml:54`, set on `velocity-human` only). The NATS user `human` is limited to `_INBOX.human.>` (`deploy/nats-auth-nf.ps1:27` and `:64`; `tools/repo-checks/src/nats-human-grants-nf.test.ts:14`). On main today the `human` user still holds the H5 grant `_INBOX.>` (#729) until the H6 PR is merged and the conf regenerated. This narrows the shared-inbox exposure, but it is account-level isolation only: the human user shares one NATS account with the others. A separate NATS account is NOT built and NOT in scope.
- **Healthcheck**: the proxy is healthy when the identity plugin's ready marker `/tmp/geldar-identity.ready` names a live process (its pid and start time, matched against `/proc`) and port 25565 accepts a connection. Interval 5 s, timeout 3 s, 3 retries, start period 20 s (`compose/nf-live-human.yml:84-93`). A plugin that never writes the marker makes `up --wait` fail after 35 s, not after 110 s. What the check proves: the plugin loaded and the port is open. The reference doc says the plugin writes the marker only while the life registry is synced (`docs/reference/velocity-identity-plugin.md:98`); that is not proven on a live NATS (UNVERIFIED until S1).
- **Velocity config** `compose/velocity/velocity-nf-human.toml`: `online-mode = true`, modern forwarding, `try = ["neoforge"]` only, a reserved forced host, ping passthrough off, `enable-player-address-logging = true`. `login-ratelimit` is Velocity's default.
- **Secrets**: `velocity-human` mounts the forwarding secret and its own NATS password (`nats-human.txt`). It does not mount the RCON password.
- **NATS user `human`**: read-only on the two identity buckets (`geldar-life-registry` and `geldar-skins`), with its flow-control subjects. It publishes no `$KV` write and no event subject (`deploy/nats-auth-nf.ps1`, the comment at line 57 and the `human` entry of the user table). It is a separate user from `velocity`.
- **Deploy gates** `deploy/nf-human-lib.sh` and `deploy/nf-deploy.sh`: `NF_HUMAN` is `on` or `off`; `NF_HUMAN_BIND` is one IPv4 address and never a wildcard; `NF_HUMAN_PORT` is a number from 1024 to 65535 and never 25565, 25566 or the live velocity port; `nats-human.txt` must exist and be non-empty before `on` is accepted, and with `on` the deployed `nats-auth.conf` must name a `human` user (`deploy/nf-human-lib.sh`, the `nats-auth.conf` check). `human-down` stops and removes `velocity-human` only. The orphan guard (`deploy/nf-human-lib.sh`, the velocity-human check): with `NF_HUMAN` unset or `off`, `plan`, `up`, `refresh-secrets` and `probe` REFUSE while a `velocity-human` container exists in the project, and name `human-down` and `NF_HUMAN=on` as the two ways out. `status`, `logs`, `down` and `human-down` stay allowed. The first `NF_HUMAN=on` `plan` says that it recreates `nats`, `eventsink` and `neoforge`, because their network set changes (`deploy/nf-deploy.sh`, the plan text). The validated `NF_HUMAN_BIND` and `NF_HUMAN_PORT` are exported (`deploy/nf-human-lib.sh`, the export line), so the shell value takes precedence over `compose/.env`. A failed `velocity-human` start stops only that service.

Built on the cap branch and merged to main as #726 (the lane must not open until #726 is deployed on the human proxy):

- **The concurrent-human cap of 5** (`HumanSlots.CAP`, commit 7b646be1, refined in 851c2c8e). This is the code as merged. By owner decision the cap of 5 is dropped for the NeoForge shard; see "Amends 0137 for the NeoForge shard" below. A human reserves a slot at the login decision and gives it back on its own disconnect or on a refused login after the reservation. The sixth human gets the same fixed denial as every other refusal, until the H1c PR changes the limit. A UUID that logs in again while it holds a slot is refused; a denied duplicate frees nothing (per the sibling reference doc, `docs/reference/velocity-identity-plugin.md`).
- **The fail-closed registry gate** (commit 44352b8a). The human lane denies every login while the life registry is unsynced, including when `GELDAR_NATS_URL` is unset. The registry marker is removed when the sync is lost.

The human lane's refusals, as built (the reference doc's lane table): an agent-shaped name (`ag_`, any case; `ag-` as well only once the H1c2 PR is deployed), a name in the life registry, a connection whose UUID is the offline-mode UUID of its name, and every login while the registry is unsynced.

## Amends 0137 for the NeoForge shard

0137 (and spec section 8.4) set the spectator proxy's "max 5 concurrent". That figure was for ghost spectators on the autonomous shard. On the NeoForge shard humans are players (0387, decision item 1). **BY OWNER DECISION (relayed by the lead, 2026-11-18) the cap of 5 is dropped for the NeoForge shard. Humans and agents share one limit: MAX_PLAYERS = 100. There is no separate human cap.**

0137 and spec section 8.4 are NOT edited. The autonomous shard's spectator proxy keeps its own rules.

What changes in code (a separate PR, H1c, NOT built here):

- The human slot capacity becomes the shared limit of 100. On main it is `HumanSlots.CAP = 5` (`plugin/velocity-identity/src/main/java/dev/geldar/identity/HumanSlots.java:18`).
- The backend's MAX_PLAYERS is the real enforcement of the shared total. It is `MAX_PLAYERS: "10"` in `compose/nf-live.yml:279` today.
- The slot mechanism stays: the slot belongs to the connection object, the human gives it back on its own disconnect or on a refused login after the reservation, and the fail-closed registry gate (commit 44352b8a) stays.

This amendment is PROPOSED, like the rest of this record. It takes effect only if the owner accepts 0388. The status line's gate names #726 and is not changed here. Whether H1c must also be deployed before the lane opens is an owner decision, UNDECIDED.

What this amendment does NOT establish, stated plainly:

- (a) **The shard has NOT been sized for 100 players.** The neoforge container has 3 CPU and 12 GiB, JVM heap 9G, view distance 8 and simulation distance 6 (runbook section 3b). The figures for 100 players are unmeasured. The 3b chunk estimate is for 10 players and is itself unmeasured.
- (b) **With no whitelist and no human cap, a per-IP limit and a login rate limit matter MORE.** Held packet H1b (a per-IP limit, login rate limiting beyond Velocity's default, and an idle kick) is NOT built. It is an OPEN OWNER ITEM.
- (c) **The `ag-` versus `ag_` question is DECIDED (owner, 2026-11-18).** The human lane refuses both prefixes, case-insensitive, through the H1c2 PR. The H1c2 PR is NOT merged and has no number yet, so until it is merged and deployed on the human proxy the lane refuses only `ag_` (see the lane refusals above). The go-public gate (status line, item 5) requires it.
- (d) **Until the live geldar-nf's MAX_PLAYERS is changed by an owner-approved node step, the running shard still enforces 10** (`compose/nf-live.yml:279`). This record does not change the node.

## Residual risks

These are stated plainly. The owner accepts or rejects each one with this record.

1. **One forwarding secret is shared by three proxies.** The agent proxy, the human proxy and the NeoForge server all use the same Proxy Compatible Forge forwarding secret (`compose/velocity/velocity-nf-human.toml` line 6 says so; the agent velocity reads the same file). Whether Proxy Compatible Forge accepts a second secret was NOT verified: no artefact was available to check it. Consequence: a compromised public proxy could forge any identity, including an agent name, to the NeoForge server. Mitigations in place: Velocity is the only path to NeoForge; NeoForge publishes nothing; `nf-human` holds only `velocity-human`, `nats` and `neoforge`, so the human proxy cannot reach postgres or the event sink by name; the human proxy has no shell, runs with `cap_drop: ALL`, `read_only`, `no-new-privileges` and the service uid, and holds only a read-only NATS credential. The lane identity is not carried in modern forwarding data, so the separation between the lanes rests on the human proxy's `LoginGate` refusals alone (the review of H2, finding F6, recorded this as an accepted risk).
2. **RCON reachability.** The NeoForge RCON port is reachable by name from `nf-human`, because `neoforge` is on that network. The RCON password is never mounted into `velocity-human`, so a compromised proxy holds no RCON password. Whether RCON binds only to loopback inside the NeoForge container was NOT verified.
3. **Cap abuse.** With no whitelist, anyone with a Microsoft account may join. Under the cap of 5 as merged on main, five throwaway Microsoft accounts can hold all five slots, and a sixth human is refused for as long as they stay. Under the shared limit of 100 (section "Amends 0137 for the NeoForge shard"), the abuse becomes filling the shared limit: enough throwaway accounts to fill the 100 shared slots would also lock out every agent trying to join, because agents share that limit. There is no idle kick and no per-IP limit (held packet H1b, an open owner item). The owner chooses how to accept this (section "Owner question").
4. **Slot release depends on Velocity event order.** The cap assumes that Velocity hands the same `Player` object to `LoginEvent` and to `DisconnectEvent`, and that `DisconnectEvent` fires for every connection that ends after a login. Neither is verified on a live proxy. The first real join settles it (runbook section 10, S1).
5. **Login rate limit is Velocity's default.** `login-ratelimit` is not set (3000 ms per source address). If the public connections reach the proxy through a Docker userland proxy, every client may appear as the bridge gateway, and one client connecting every few seconds could lock out the others. Not verified on a node.
6. **Player addresses are logged.** `enable-player-address-logging = true` writes public players' addresses to the container's JSON log (three files of 10 MB).
7. **The human registry is not built.** 0387 item 5(d) requires that a registered human is refused and a revoked human record is refused. The lane's refusal list above does not include a human registry check. A human record cannot be revoked by the lane today. The owner chose identity option (a) on 2026-11-18 (section "Owner question"). Whether that drops 0387 item 5(d) is a question for the owner, not decided here.
8. **Nothing has had a real human join.** The first join is the owner's S1 test. Every claim about the human lane above is from renders, tests and reading, not from a running server.
9. **The inbox prefix is UNVERIFIED on a live NATS (H6).** Not yet shown on a server: the KV watch under the custom prefix `_INBOX.human.`, the exact permission set a push watch needs, that the server enforces `_INBOX.human.>` as written, and whether the client ever publishes to an inbox. Under the stack, the healthcheck proves plugin load and an open port. Registry sync is proven only once the merged #726 gate is deployed on the human proxy and S1 has passed. Until then the lane must NOT go public.
10. **OWNER DECISION: NATS cannot constrain a consumer's delivery subject (review H6, finding 4; pre-existing, NOT introduced by H6).** NATS permissions are subject-based only. They cannot constrain a consumer's `deliver_subject`, name, config or count. A compromised public proxy that holds `CONSUMER.CREATE` on the two identity KV streams could aim server-delivered registry and skin entries at any subject it can name, and could create consumers without bound. The `velocity` user holds the same grant, so this is not new, and H6 does not remove it. What H6 blocks, by reading the grant (NOT a live check): the human proxy cannot read other users' inbox traffic (its subscribe is `_INBOX.human.>` only), cannot publish into other users' inboxes, and cannot enumerate consumer names (no `CONSUMER.LIST`, `CONSUMER.NAMES` or `$JS.EVENT`). Forging flow control into the agent proxy's consumers should also be blocked, but that rests on a reading of the grant, not on a live check. The only remedy is a separate NATS account with an export and import of the KV read. That is NOT built and NOT in scope; the owner may ask for it. Accepting this residual is the owner's decision. The owner asked how players could reach NATS: an answer is pending; no change is made.
11. **The human user's `_INBOX.human.>` publish grant is kept** until S1 shows that the client never publishes to an inbox. Removing it is a follow-up (review H6, finding 5).

## Owner question

**Owner question (0135): what is the identity route for a human on the NeoForge shard?**

What 0135 requires, read from `docs/decisions/0135-self-registration-with-github-and-discord.md`:

- Line 1, Amendment 2026-11-11, R40: "sign-in is Microsoft only (personal accounts, the Microsoft `consumers` authority, authorization code with PKCE S256, scope `openid`). The identity is the id token's `sub`, never the email." 0135 line 1 is the one physical line that holds both the decision and the amendment.
- Line 1, Amendment 2026-11-11, R41: "there is no daily cap on new owners"; rate limits per IP and per owner; the per-owner caps of 3 live and 10 for life, and the operator ban (0136), stay.
- Line 1, the section "What a registrant gets": a registrant "picks a player id (the 0054 pattern `ag-...`) and a display name" and gets a bearer token, shown once. That is the MCP and agent route: it creates an agent player and its life. It is not a human route.
- Lines 3 to 8, Amendment (orchestrator, 2026-11-11, review C2-R5): writes go through owner-checked functions; a ban revokes every live token; an owner can create at most 10 players.
- Line 1, decision item 5: "Registration stays **off** until the C2 gates pass."
- 0387 (the Not settled section) cites 0135 as the registration route for humans and leaves "Microsoft only or GitHub and Discord too" open.

What is deployed, as read in this tree: Microsoft online-mode login through Mojang (`online-mode = true`); any valid username of 1 to 16 characters except a name starting `ag_` (and `ag-` once the H1c2 PR is deployed); names in the life registry refused; offline-mode UUIDs refused. There is no registration step, no owner or token record and no human record for a human on the NeoForge shard.

The gap: 0135 creates agent players and tokens; it does not define a human registration. 0387 cites it for humans. The deployed human route follows neither 0135's registration nor 0387 item 5(d) (the human registry).

Options:

- **(a) CHOSEN: online login IS the identity, with no registration step.** The owner chose (a) on 2026-11-18: online login IS the identity; no registration step and no 0135 route for human players. The status line stays PROPOSED until the owner accepts the whole record. The lead understands (a) to mean that 0387 item 5(d) (a human registry check) is NOT required for the NeoForge human lane, because the identity is the Microsoft login. QUESTION for the owner: confirm that 5(d) is not built. This record does not decide it.
- **(b) NOT CHOSEN: the 0135 route is required.** A human registers, gets a record, and the lane checks that record on every login (0387 item 5(d)). This is not built.

## Recommendation and acceptance asked

The owner is asked to:

1. Accept, edit or reject this record (0388).
2. Confirm the Owner question above: the owner chose (a) on 2026-11-18. Confirm whether 0387 item 5(d) is therefore not built (see that section).
3. Choose the cap-abuse posture (residual risk 3): (i) run with the shared limit of 100 (MAX_PLAYERS, the cap of 5 dropped) and no per-IP limit, and accept the abuse, (ii) hold the lane until H1b (per-IP limit and idle kick) is built, or (iii) keep the lane closed. The owner chooses. This packet recommends neither.
4. Note the hardening already done: the human lane has its own NATS user (read-only) and its own network `nf-human` (review H2 finding F6 and H5 items a, e and f). The shared forwarding secret (residual risk 1) is NOT removed by that hardening.

## Not built

- **Per-IP limits, login rate limiting beyond Velocity's default, and an idle kick** (held packet H1b).
- **A human registry and a revocation path** (0387 item 5(d)).
- **Chat export and the name mask: off.** Per 0375, human chat is not exported, because `collector.chat.enabled=false` keeps the ledger's NameMask off (taken from 0375 as stated; not re-verified here).
- **The spec.** `docs/spec.md` is not edited (0073). Principle 1 still reads as written for the whole project; 0387 is the exception.

## Consequences

- The NeoForge human lane can be opened only after the owner accepts this record, #726 is deployed on the human proxy, the H6 PR is merged and deployed with a regenerated conf, the H1c2 PR is merged and deployed, the S1 checks pass on the LAN, and the owner adds the gateway rule and the SRV record (runbook section 10).
- No code or config changes in this record. The repo is unchanged by it.
- (b) is NOT chosen, so this record plans no human registry. If the owner later chooses (b), a new decision will record the human registry and its revocation path.
