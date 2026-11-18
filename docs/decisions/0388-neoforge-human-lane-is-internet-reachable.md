# 0388. The NeoForge human lane is internet-reachable

- Status: Proposed. The owner accepts or edits this record. Nothing here is in force, built on a node or opened. See the status line below.
- Date: 2026-11-18
- Spec: section 2 (Principle 1), section 8.4 (spectator proxy). Builds on 0387 (items 3, 4 and 5), 0137 (item 1: the cap of 5 and the login rate limit; item 3: least privilege), 0375 (chat export off), 0386 (the compose project). Its operator steps are in [docs/runbooks/nf-live-project.md](../runbooks/nf-live-project.md), section 10. Admission on the registration route is a question for the owner (section "Owner question").

**Status line (explicit).** This record is PROPOSED. The lane must not be opened to the internet until (a) the owner accepts this record, (b) the concurrent-human cap and the fail-closed registry gate are merged and shipped to the node (branch `phase1/nf-human-cap`, commits 7b646be1, 44352b8a and 851c2c8e), and (c) the first human join (S1, runbook section 10) has passed on the LAN. Until all three hold, the human port is closed to the internet.

## Decision

1. **Humans are players on the NeoForge shard (0387).** The NeoForge human lane is reachable from the internet. Anyone with a Microsoft (Mojang) account who passes the lane's refusals may join. The shard has no server whitelist (owner, 2026-11-17, 0387).
2. **The public name is an SRV record only.** Players type the hostname and no port. The SRV record names the human port. The game port is TCP, so Caddy is not involved (Caddy serves HTTP and HTTPS). The gateway that forwards the port is owner-owned, and the owner removes it to roll back.
3. **The agent lane stays loopback-only.** The agent Velocity stays on `127.0.0.1:46565`, unchanged. Nothing on the human side reaches it: the human network carries only the human proxy, NATS and the NeoForge server.

## What is built

On the human-lane branch (`phase1/nf-human-isolation`, tip 7cd3ed7d; the repo tests pin each item):

- **Human overlay** `compose/nf-live-human.yml`: one service, `velocity-human`, on its own network `nf-human` only. `nats` and `neoforge` join `nf-human` as well, so the forced backend and the NATS URL resolve there. Nothing else joins it. The one published port is `${NF_HUMAN_BIND:-127.0.0.1}:${NF_HUMAN_PORT:-46566}` to container port 25565. The service is `read_only`, `cap_drop: ALL`, has `no-new-privileges`, runs as the service uid, and mounts the identity jar read-only with `create_host_path: false`.
- **Velocity config** `compose/velocity/velocity-nf-human.toml`: `online-mode = true`, modern forwarding, `try = ["neoforge"]` only, a reserved forced host, ping passthrough off, `enable-player-address-logging = true`. `login-ratelimit` is Velocity's default.
- **Secrets**: `velocity-human` mounts the forwarding secret and its own NATS password (`nats-human.txt`). It does not mount the RCON password.
- **NATS user `human`**: read-only on the two identity buckets (`geldar-life-registry` and `geldar-skins`), with its flow-control subjects. It publishes no `$KV` write and no event subject (`deploy/nats-auth-nf.ps1`, the comment at line 57 and the `human` entry of the user table). It is a separate user from `velocity`.
- **Deploy gates** `deploy/nf-human-lib.sh` and `deploy/nf-deploy.sh`: `NF_HUMAN` is `on` or `off`; `NF_HUMAN_BIND` is one IPv4 address and never a wildcard; `NF_HUMAN_PORT` is a number from 1024 to 65535 and never 25565, 25566 or the live velocity port; `nats-human.txt` must exist and be non-empty before `on` is accepted. `human-down` stops and removes `velocity-human` only.

Built on the sibling branch and NOT in this tree (the cap PR, which must merge before the lane opens):

- **The concurrent-human cap of 5** (`HumanSlots.CAP`, commit 7b646be1, refined in 851c2c8e). A human reserves a slot at the login decision and gives it back on its own disconnect or on a refused login after the reservation. The sixth human gets the same fixed denial as every other refusal. A UUID that logs in again while it holds a slot is refused; a denied duplicate frees nothing (per the sibling reference doc, `docs/reference/velocity-identity-plugin.md`).
- **The fail-closed registry gate** (commit 44352b8a). The human lane denies every login while the life registry is unsynced, including when `GELDAR_NATS_URL` is unset. The registry marker is removed when the sync is lost.

The human lane's refusals, as built (the reference doc's lane table): an agent-shaped name (`ag_`, any case), a name in the life registry, a connection whose UUID is the offline-mode UUID of its name, and every login while the registry is unsynced.

## Residual risks

These are stated plainly. The owner accepts or rejects each one with this record.

1. **One forwarding secret is shared by three proxies.** The agent proxy, the human proxy and the NeoForge server all use the same Proxy Compatible Forge forwarding secret (`compose/velocity/velocity-nf-human.toml` line 6 says so; the agent velocity reads the same file). Whether Proxy Compatible Forge accepts a second secret was NOT verified: no artefact was available to check it. Consequence: a compromised public proxy could forge any identity, including an agent name, to the NeoForge server. Mitigations in place: Velocity is the only path to NeoForge; NeoForge publishes nothing; `nf-human` holds only `velocity-human`, `nats` and `neoforge`, so the human proxy cannot reach postgres or the event sink by name; the human proxy has no shell, runs with `cap_drop: ALL`, `read_only`, `no-new-privileges` and the service uid, and holds only a read-only NATS credential. The lane identity is not carried in modern forwarding data, so the separation between the lanes rests on the human proxy's `LoginGate` refusals alone (the review of H2, finding F6, recorded this as an accepted risk).
2. **RCON reachability.** The NeoForge RCON port is reachable by name from `nf-human`, because `neoforge` is on that network. The RCON password is never mounted into `velocity-human`, so a compromised proxy holds no RCON password. Whether RCON binds only to loopback inside the NeoForge container was NOT verified.
3. **Cap abuse.** With no whitelist, five throwaway Microsoft accounts can hold all five slots, and a sixth human is refused for as long as they stay. There is no idle kick and no per-IP limit (held packet H1b). The owner chooses how to accept this (section "Owner question").
4. **Slot release depends on Velocity event order.** The cap assumes that Velocity hands the same `Player` object to `LoginEvent` and to `DisconnectEvent`, and that `DisconnectEvent` fires for every connection that ends after a login. Neither is verified on a live proxy. The first real join settles it (runbook section 10, S1).
5. **Login rate limit is Velocity's default.** `login-ratelimit` is not set (3000 ms per source address). If the public connections reach the proxy through a Docker userland proxy, every client may appear as the bridge gateway, and one client connecting every few seconds could lock out the others. Not verified on a node.
6. **Player addresses are logged.** `enable-player-address-logging = true` writes public players' addresses to the container's JSON log (three files of 10 MB).
7. **The human registry is not built.** 0387 item 5(d) requires that a registered human is refused and a revoked human record is refused. The lane's refusal list above does not include a human registry check. A human record cannot be revoked by the lane today.
8. **Nothing has had a real human join.** The first join is the owner's S1 test. Every claim about the human lane above is from renders, tests and reading, not from a running server.

## Owner question

**Owner question (0135): what is the identity route for a human on the NeoForge shard?**

What 0135 requires, read from `docs/decisions/0135-self-registration-with-github-and-discord.md`:

- Line 1, Amendment 2026-11-11, R40: "sign-in is Microsoft only (personal accounts, the Microsoft `consumers` authority, authorization code with PKCE S256, scope `openid`). The identity is the id token's `sub`, never the email." 0135 line 1 is the one physical line that holds both the decision and the amendment.
- Line 1, Amendment 2026-11-11, R41: "there is no daily cap on new owners"; rate limits per IP and per owner; the per-owner caps of 3 live and 10 for life, and the operator ban (0136), stay.
- Line 1, the section "What a registrant gets": a registrant "picks a player id (the 0054 pattern `ag-...`) and a display name" and gets a bearer token, shown once. That is the MCP and agent route: it creates an agent player and its life. It is not a human route.
- Lines 3 to 8, Amendment (orchestrator, 2026-11-11, review C2-R5): writes go through owner-checked functions; a ban revokes every live token; an owner can create at most 10 players.
- Line 1, decision item 5: "Registration stays **off** until the C2 gates pass."
- 0387 (the Not settled section) cites 0135 as the registration route for humans and leaves "Microsoft only or GitHub and Discord too" open.

What is deployed, as read in this tree: Microsoft online-mode login through Mojang (`online-mode = true`); any valid username of 1 to 16 characters except a name starting `ag_`; names in the life registry refused; offline-mode UUIDs refused. There is no registration step, no owner or token record and no human record for a human on the NeoForge shard.

The gap: 0135 creates agent players and tokens; it does not define a human registration. 0387 cites it for humans. The deployed human route follows neither 0135's registration nor 0387 item 5(d) (the human registry).

Options:

- **(a) Online login IS the identity, with no registration step.** Our recommendation. It is NOT a decision: the owner decides, and it changes 0387 item 5(d) (no human registry) and the citation of 0135.
- **(b) The 0135 route is required.** A human registers, gets a record, and the lane checks that record on every login (0387 item 5(d)). This is not built.

## Recommendation and acceptance asked

The owner is asked to:

1. Accept, edit or reject this record (0388).
2. Answer the Owner question above (a or b).
3. Choose the cap-abuse posture (residual risk 3): (i) run with the cap of 5 and no per-IP limit and accept the abuse, (ii) hold the lane until H1b (per-IP limit and idle kick) is built, or (iii) keep the lane closed. The owner chooses. This packet recommends neither.
4. Note the hardening already done: the human lane has its own NATS user (read-only) and its own network `nf-human` (review H2 finding F6 and H5 items a, e and f). The shared forwarding secret (residual risk 1) is NOT removed by that hardening.

## Not built

- **Per-IP limits, login rate limiting beyond Velocity's default, and an idle kick** (held packet H1b).
- **A human registry and a revocation path** (0387 item 5(d)).
- **Chat export and the name mask: off.** Per 0375, human chat is not exported, because `collector.chat.enabled=false` keeps the ledger's NameMask off (taken from 0375 as stated; not re-verified here).
- **The spec.** `docs/spec.md` is not edited (0073). Principle 1 still reads as written for the whole project; 0387 is the exception.

## Consequences

- The NeoForge human lane can be opened only after the owner accepts this record, the cap PR is merged and shipped, the S1 checks pass on the LAN, and the owner adds the gateway rule and the SRV record (runbook section 10).
- No code or config changes in this record. The repo is unchanged by it.
- If the owner chooses 0135 (b), a new decision will record the human registry and its revocation path.
