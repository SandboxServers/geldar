# Orchestrator log, night of 2026-11-11

The owner asked for autonomous overnight work toward the Phase 1 goal, with decisions logged for later review and no spec edits (deviations go through decision 0073 amendments). The machine restarted for updates during the night, which stopped the previous session after PR #78 was opened. This log starts from there.

Each ruling below is the orchestrator's, not the owner's. Each one says what to check and how to reverse it.

## State at the start

- `origin/main` at `5c129ed` (PR #77). PR #78 (`fix/colo-core-start`, decision 0134) open, CI green, from the stopped session.
- C1 code: C1-00 to C1-09 merged (PRs #49 to #62), followed by the Colo fix PRs #63 to #78 (FX-* worknotes, C1-11a and C1-11b, decisions 0131 to 0134). C1-05b is deferred (0130). C1-10 (node deploy, first ranger, no degradation) is the owner's step on the node.
- C1-01 is partial: three flaky tests still need clock seams (`golem/src/test-control.test.ts`, `golem/test/live/adam-stack.test.ts`, `tools/repo-checks/src/cli.test.ts`), and `lantern-local/src/thinker.ts` (592) and `threshold/mcp-mock/src/server.ts` (565) are over the soft cap.
- `RESUME.md` and `ledger.md` were stale (they still said C1-00 was next). This branch updates them.
- Two empty untracked files, `present.ts` and `wait.ts`, sit in the main checkout's root (dated 2026-11-09). They are not touched; the owner can delete them.

## Rulings

| # | Ruling | Why | To reverse |
|---|---|---|---|
| R1 | Merged PR #78 with no separate review. | CI was green and mergeable. The owner's rule is one review per wave, at the wave end, not per PR. It joins the C1 wave review. | Revert merge `51dc45a`. |
| R2 | Start wave C2 (Doors) now. C1's exit check (first ranger on the node) is the owner's step and does not block desktop work. | plan.md orders C2 after C1. Only the C1 node step is outstanding, and C2's desktop packets don't depend on it. | Stop C2 PRs from merging. |
| R3 | C2 packets merge to `main` one PR per packet, as C1 did (PRs #49 to #62), not through a wave integration branch. | This matches the C1 practice, and the C2 packets touch separate files once C2-00 has merged. | Not applicable. |
| R4 | C2-00 error shapes: 401 for every unauthenticated case with one body; 429 with integer `retryAfter` seconds; 503 for the kill switch. Record 0090 is "Proposed (orchestrator)". | These are the card's own defaults, made concrete so the fan-out packets agree. | Owner edits 0090. |
| R5 | The owner-gated defaults stay as the cards set them. C2-01 invitee issuing ships behind a flag that defaults off, since 0077 is still Proposed. C2-03 ships with the Glass delay at 0, the sovereign filter on, and no agent-board text. C2-04 ships with no Caddy rate-limit module (no new supply-chain dependency), and the gap is recorded in 0094. | These are the safest defaults. Each one waits for an owner question in c2-packets.md section 5.4. | Owner answers 5.4 items 3, 5, 6, 7, 8 and 9. |
| R6 | Owner question 5.4 item 10 (Caddy sites for `glass` and `mcp`) goes to C2-04, which grows from S to M. It writes the `map`, `glass` and `mcp` snippets under `deploy/caddy/`, each with its own kill-switch file. | C2-04 already owns `deploy/caddy/`. Without the two extra sites the public MCP and Glass have no way in. These are template snippets only, with the domain as a placeholder; nothing is reloaded. | Drop the two snippets. |
| R7 | C2-01 splits `threshold/mcp/src/config.ts` (558 lines) in its own first commit before it adds the `public` block. | packet-conventions section 1: a packet that needs a file over 500 lines splits it first. | Not applicable. |
| R8 | C2-02, C2-04, C2-05 and C2-06 start before C2-00 merges. C2-01 and C2-03 wait for it. | The first four read nothing from `contract/`. The header name they share (`x-geldar-client-ip`) is fixed in R4. C2-01 and C2-03 read the C2-00 config keys and error shapes. This keeps at most six agents running at once. | Not applicable. |
| R9 | C2-06 may update `pnpm-lock.yaml` for its new `tools/portscan` importer only, with no new external dependency. | `pnpm-workspace.yaml` already globs `tools/*`, and CI installs with a frozen lockfile, so the importer has to be in the lockfile. The card's "C2-07 adds it" would leave C2-06's PR red. | Not applicable. |
| R10 | C2-01 builds against 0090 while it is still Proposed. 0090 itself says the owner confirms before C2-01 relies on the header rule. | The default is safe: `public.trustedProxies` starts empty, so the header is ignored. Nothing goes public before C2-07, which needs the owner anyway. | Owner changes 0090; C2-01 follows. |
| R11 | Process: a coder that adds a decision record ends with `check:repo` red, because the index row is the ops step's (conventions 7). From now on the ops step adds the row and runs `check` before the PR. Retro item for C2: let the coder add its own row, since one PR per packet makes index conflicts rare. | Seen on C2-00. | Not applicable. |

## Follow-ups queued

- Dependabot alert 1 (medium): `uuid` below 11.1.1, a missing buffer bounds check in v3/v5/v6 when the caller passes a buffer. It comes in transitively through `@azure/msal-node` (uuid 8.3.2) and `yggdrasil` (uuid 10.0.0), the Minecraft auth libraries under mineflayer. Neither passes a buffer, so the risk is low. The fix is a `pnpm-workspace.yaml` override to 11.1.1, if that release is past the two-week floor, plus a full `check`. It is queued as a small packet once a slot is free.

## Owner answers received during the night

- **0077 Accepted (owner, 2026-11-11):** option A. Anonymous visitors get the thought stream and the map, and cameras need an owner or admin login. The interim login is two static hashed role tokens until Entra SSO in Phase 2. Invitee MCP tokens stay as in 0054. Effects: C2-01's invitee-issuing flag can default on once the C2-01 PR lands (a small follow-up, since C2-01 was briefed before the answer); C2-07 and the C2b login packets are no longer blocked by 0077. 0075 point 5 (anonymous or login cameras) is answered by this choice, but 0075's own status is left for the owner, because its other points were "for review".

## More rulings

| # | Ruling | Why | To reverse |
|---|---|---|---|
| R12 | C2-05 is accepted as tests and a record only. The image slimming in the card can't be done, because the MCP runtime imports `@geldar/animus/src/*`, `@geldar/mcp-mock` and `@geldar/repo-checks/src/identity-mode.ts`. Follow-up: move those shared modules into `contract` or a small shared package, then slim the image. | Removing them would break the runtime. The move is a refactor outside C2. | Not applicable. |
| R13 | C2-02 ghost spectator: Velocity can only admit a ghost and block its commands; forcing spectator game mode needs Paper (`plugin/core`), and the Golem registry writer must write `live`. Queued as follow-up packet C2-02b. | Velocity has no game-mode API. | Not applicable. |
| R14 | Shard YAML key names for 0090 are snake_case, in a top-level `public:` block (`trusted_proxies`, `client_ip_header`, `rate_limit.per_minute` and `rate_limit.burst`, `kill_switch`), mapped one to one to 0090's names. Precedence: env, then `public.*`, then the existing `sovereign.mcp` keys as a fallback. | The shard file is snake_case everywhere. Keeping the old keys as a fallback keeps current shard files working. | Rename in 0091. |
| R15 | Public surfaces are rate-limited by default: 60 per minute, burst 20, with a bounded per-client table. This departs from 0090 ("no default"), and 0091 and 0093 record it. | A public endpoint left unlimited because a value was never set is the worse failure. | Owner sets values; owner can lift the defaults. |
| R16 | C2-01 and C2-03 each ran out of context with half their items left. Following the campaign rule (re-slice, don't chain finishers), C2-01 is split into C2-01b (config, kill switch, rate limit) and then C2-01c (negative cache, invitee issuing, 0091). C2-03 is split into C2-03b (size cap, delay, sovereign filter, kill switch, 0093) and C2-03c, which adds test files only and runs in parallel. The Glass sovereign filter also hides receipts, not just thoughts. | Each split is under about 40k tokens. Receipts of a living sovereign agent show what it is doing, just as its thoughts do. | Not applicable. |

## Owner answers to the C2 questions (c2-packets.md section 5.4), 2026-11-11

| # | Question | Owner answer | What was done |
|---|---|---|---|
| 1 | UniFi forward | Orchestrator makes it, persisting in the UniFi app, without the UniFi API | Done. One TCP forward, `<shard TCP port>` to the Colo node. It was written into the Network app's own database, so it shows in the app and persists, and then provisioned. The steps, backup and undo are kept outside the repo (`~/.config/geldar/colo-edge.md` on the owner's machine). |
| 2 | DNS | Orchestrator runs it with `az` | Done. `glass`, `map`, `mcp` and `play` under the project subdomain are CNAMEs to the project A record. `_minecraft._tcp.play` is an SRV record pointing at `<shard TCP port>`. Before creating them, the existing project A record was checked to equal the gateway's WAN address. Nothing listens on the names until C2-07. |
| 3 | Tokens policy | People register themselves through a verification mechanism | GitHub and Discord sign-in; an IdP-verified account is admitted with no manual approval. Decision 0135 and the cards in `packets/c2-register-packets.md` (C2-08a to C2-08d). |
| 4 | Invitations wait for the gates | Yes | Registration ships with its kill switch on, and stays off until the C2 gates pass. |
| 5 | 0077 | Accepted | See above. |
| 6 | Glass delay | 60 s | The C2-03 default is 60 (PR #86). |
| 7 | Living sovereign agents on Glass | Recommendation accepted (hidden) | C2-03 hides their thoughts and receipts by default. |
| 8 | Agent-board text | None, unless agents make it in-game | C2-03 pins "no board routes". If an in-game board ever appears, it needs a new decision. |
| 9 | BlueMap rate limit | No Caddy module (recommendation) | As built in C2-04. |
| 10 | Caddy sites for glass and mcp | Confirmed | C2-04 (PR #81). |
| 11 | NATS default-on (0080) | Yes | Already accepted. C2-07 flips the default. |
| 12 | UDP scan | Out of scope | C2-06 scans TCP only. |

C1-10 correction: the owner asked whether the first ranger is Jason. It is: Jason is the Red Ranger (`ag-jason-01`), a sovereign player agent, not a person. The orchestrator first read "first ranger" as a human client. C1-10's exit is Jason finishing a session on the Colo stack, with no degradation of the node's other services.

## More rulings

| # | Ruling | Why | To reverse |
|---|---|---|---|
| R15b | MCP rate-limit defaults are 120 per minute with a burst of 40, applied when the `public:` block is present (the CLI path always passes it). Glass stays at 60 and 20. | A burst of 20 sat below the MCP's existing failed-auth budget (30 per minute) and could throttle a busy harness. | Change `PUBLIC_DEFAULTS`. |
| R17 | Registration details (0135): a 30-day account-age floor, 10 new owners a day, 3 players per registered owner, the identity stored only as an HMAC, a separate `threshold/register` service, and the kill switch defaulting to on. Turning registration on waits for the per-player Body lifecycle (C2-08d). | Without the age floor, throwaway accounts pass "verified". Without the Body lifecycle, a registered player has a token and no Body. | Owner edits 0135. |
| R18 | The shard's public Minecraft port was chosen to be free both among the gateway's existing forwards and among the Colo node's listening ports. The real number lives only in the local edge notes. | Decision 0071 requires a new TCP port. The repo carries no real ports or addresses. | Change the forward and the SRV record. |
| R19 | C2-07 is retargeted from `compose/phase0.yml` and `geldar.ps1` to the Colo stack: `compose/colo.yml`, `shards/colo*.yaml` and the Linux `deploy/` scripts. It is split in two. C2-07a covers compose and config: Glass is added to the Colo stack with a loopback publish; BlueMap's web port gets a loopback publish; the public Minecraft publish lives in its own overlay, `compose/colo-public.yml`, with the port and bind address from env, and the loopback repo check allows exactly that one exception; and the `public:` block goes in the shard file. C2-07b covers `deploy/colo-public.sh`: it installs the Caddy site files into the shared Caddy's mounted config directory, adds one `import` line, validates, and runs `caddy reload` via `docker exec`, never a restart or recreate. It also handles the kill switches, rollback and the runbook. | The card predates the Colo stack (C1). The node's shared Caddy is a host-network container with a single Caddyfile and a bind-mounted config directory, so files and an `import` plus a reload need no restart (0071 item 6). TLS for our names uses plain ACME over 80 and 443, which already reach the node. | Not applicable. |
| R20 | NATS default-on (card step 5): the Colo stack already runs the NATS auth overlay (C1-06c, 0080), so C2-07 does not change `compose/phase0.yml`. | 0080 is accepted and in force on Colo. | Not applicable. |

## Flakes and review items logged during the night

- **Flake (2026-11-11, C2-07b):** one full `./geldar.ps1 check` run on branch `phase1/c2-07b-public-deploy` failed in the vitest step, and the coder did not capture which test. The next two full runs passed. Action: the next coder to see a vitest failure in `check` records the test name. Until then the source is unknown (the known flakes are `golem/src/test-control.test.ts`, now fixed by C1-01c, and `lantern-local/test/thinker.test.ts`).
- **For C2-R2 (Velocity):** the ghost default-mode window from C2-02b (#90). A ghost is in the backend's default game mode for a few ticks before `geldar:ghost` arrives. Required fix before any ghost account exists: join every player as spectator until Paper is told the player is live (fail closed).
- **For C2-R4 (node and Caddy):** two gaps in `deploy/colo-public.sh` (#91). A failed re-install removes the previous site files instead of restoring them, so the next unrelated Caddy reload would silently drop the Geldar sites. And the env file named by `GELDAR_PUBLIC_ENV` is not checked to be root-only.

## Rulings during the wave review

| # | Ruling | Why | To reverse |
|---|---|---|---|
| R21 | Glass does not return `model_input` or `raw_output` to public visitors (C2-R3 finding R3-02). The thought detail keeps the thought text the agent wrote, and drops the full prompt. | The prompt carries exact coordinates, inventory and nearby people's speech. Decision 0072 item 4 requires an owner-signed privacy review before anything like that is exposed, and none exists. The review called it an owner choice; hiding is the safe side, and it can be undone. | The owner signs a privacy review, recorded in 0093, and a scrub for the position, inventory and notable-block lines is added. |
| R22 | The Glass Caddy site rewrites `Host` to `localhost` for Glass (R3-03), and the site files stay at `deploy/caddy/<site>.caddy`. The card's `deploy/caddy/sites/` is superseded. | Glass accepts only loopback Host names, and `colo-public.sh` already uses the flat layout. | Not applicable. |
- **Flakes under load (2026-11-11):** `tools/repo-checks/src/colo-config.test.ts` (12 s, C2-07a1's run) and `threshold/mcp-mock/src/cli.test.ts` ("applies the timing overrides…", 18 s, C2-08a's run). Each passed alone and on a rerun. The common cause is likely process-spawning tests running while several agents run the full `check` at the same time. Fix item FX-SPAWN: give each such test an in-process seam and keep one spawn case, as C1-01c did. `tools/repo-checks/src/cli.test.ts` is already on the list from C1-01c. Never fix these by raising a timeout.
| R23 | MCP per-client rate limit (R1-01): it applies only when the shard has a `public:` block. With the block, the default is 600 a minute with a burst of 120, one owner's pool, replacing R15b's 120 and 40. | The reviewer showed that 120 and 40 apply even without the block, and sit below the shard's own per-owner budget, so the live shard would throttle itself. | Change the values in the shard file. |
| R24 | The global failed-auth bucket no longer gates requests (R1-02). Postgres is protected by a cap of 16 concurrent uncached token lookups, answered with the 0090 503 body, and by a `gmcp-` token-shape prefilter. | The global bucket gave an attacker a cheap lever on every valid user. | Not applicable. |
| R25 | Implement the 0090 refusal bodies in the MCP (R1-03), rather than amending 0090 to match the empty bodies. | Fixed bodies are the contract, and one shape per status stops a probe telling which internal gate refused it. | Not applicable. |
| R26 | The MCP kill switch takes effect on restart (R1-04). The immediate cut is `mcp-off.caddy` plus `caddy reload`, with `stream_close_delay` on the proxy so open streams close. The docs say so; no runtime flag. Glass works the same way (R3-14). | A runtime flag adds a signal path for little gain; the Caddy swap is per site and immediate. | Add a runtime flag later. |
| R27 | BlueMap's map files are served by a small static file server in Geldar's own Colo stack: the pinned Caddy image with `file_server`, mounting Paper's BlueMap webroot read-only and publishing on a literal loopback port. The shared Caddy doesn't read the Paper volume. BlueMap's integrated web server stays off, so live player markers are not served. | C2-07a2 found the integrated web server is off and 5.29 has no bind key. Mounting the volume into the shared Caddy would mean recreating it (0071 item 6). With the integrated server off, live markers can't leak sovereign positions (C2-R3 finding R3-11). | Turn the integrated server on with a loopback publish, and turn live markers off in its config. |
| R28 | `bluemap-web` mounts only BlueMap's webroot, as a read-only volume `subpath`, not the whole Paper volume with a narrowed served root. | The Paper volume holds `server.properties` (the RCON password), world data and plugin configs. With the whole volume mounted, one file-server path bug would expose them. | Not applicable. |
- **Flake (C2-R1 fix slice M2's run):** `threshold/mcp/src/http/front-rate-limit.test.ts` ("does not limit a door whose public block has no rate limit") timed out once in a wide vitest run under load. It passed alone and in the full `check`. Add it to FX-SPAWN's follow-ups if it recurs.
| R29 | C2-R2 (verdict: decision) is ruled by decision 0137. The public Minecraft port is a separate online-mode spectator proxy, as spec 8.4 already describes: a UUID whitelist (empty by default), at most 5 players, rate limited, no ping passthrough. The offline bot ingress is never published. Paper fails closed: a player is live only with a signed `geldar_live` profile property, and is a spectator from the first join. Both Velocity services are read-only on NATS. | The reviewer showed that publishing the offline bot ingress lets anyone claim a live agent's name. Spec 8.4 already settles the design, so this follows the spec and needs no amendment. | The owner amends 0137. |

## Later rulings (C2 review round 2)

- **R30.** The public MCP and Glass rate limits are separate settings. MCP: 600/min, burst 120. Glass: 60/min, burst 20. Applies to R1-2-01.
- **R31.** Glass keeps grouping viewers by /64 when rate-limiting (R3-2-07 is accepted). Rotating through a wider block is a known limit and goes to the owner for review.
- **R32.** Glass and the MCP trust the Docker bridge gateway as their proxy (R4-03), because Caddy runs on the host network and reaches them through it. Trusting the gateway also trusts every process on the node, so those processes could skip the rate limits; tokens are still required, and the node is the owner's own. Required with it:
  - pin the colo bridge subnet in compose;
  - persist both trusted-proxy variables in the node state env so colo-up keeps them;
  - colo-public.sh install refuses unless both are set;
  - colo-status prints both.
- **R33.** R4-09 (the register role can insert a token for any player): C2-08b must restrict inserts to the role's own players, through a SECURITY DEFINER function or a check against `owner_id`. Nothing changes before the service is deployed.
- **Deploy.** Colo stack internal deploy dispatched at ee87caa, with images from colo-images run 43017919759 (baffba9).

## Colo internal deploy (2026-11-11)

**Result.** Deployed main 66f23c5 with images from colo-images run 43026058155 (ceefe49). Production unchanged; no public overlay; the MC port is unset.

**Checks:**
- MCP: 401 with the 0090 body.
- Glass: 200.
- bluemap-web: 404, expected because nothing is rendered yet.
- Paper and Velocity: plugins loaded; the registry watch is running; no permission violations.

**What it took.** Six attempts, fixed by PRs #110, #112, #113 and #114 (C2-07f to C2-07i):
- secret path order;
- the bind-mount parse;
- a duplicate NATS store_dir;
- containers left on a removed network;
- velocity's uid;
- caddy's NET_BIND_SERVICE capability.

NATS auth was regenerated on the desktop and the old files kept in `secrets.bak-nats-*`.

**Settings on the node.** Subnet 172.23.0.0/16; gateway trusted per R32, persisted in `state/node.env`.

**Open, now with C2-07j:**
- the geldar-skins bucket is absent and velocity can no longer create it;
- animus exits (no Ollama; the Mind is off per 0134);
- the src-swap hazard.

**Update 13:57.** Redeployed main 67ad3e7, with images from colo-images run 43033025219.
- C2-07j (#115): the skins bucket is now created at deploy.
- C2-07k (#116): the house Body is whitelisted over RCON by the admin one-shot.
- ag_colo_01 joined the world, and the Body went to idle.
- Production is unchanged, and Animus stays off.
- Nit for C2-07e: `state/release.commit` is stale.

## Register review R5 (pass 1): decision rulings

- **R34 (F2).** Register writes (create, retire, mint) go only through SECURITY DEFINER functions with an owner match. Direct DML is revoked, and every definer function pins search_path with pg_temp last (fixes F1, a temp-table shadow mint).
- **R35 (F4).** A ban revokes all of the owner's live tokens at ban time. The MCP lookup also refuses tokens whose owner is banned. An admin ban/unban subcommand is added.
- **R36.** Lifetime cap of 10 player creations per owner.
- **F3.** Registered players start with the same credits as players made with the CLI (240).
- **R37 (R5 pass 3, F19).** The register service holds the pepper, so a compromised register can act as any registered owner. Accepted as a known limit and recorded in a 0135 amendment. The direct SELECT on identity hashes is revoked anyway, as defence in depth.
- **Owner ruling (2026-11-11), R38.** The public BlueMap shows every agent player's position live. That includes living sovereign players. It replaces the "no live data" part of R27 and decision 0094. Glass keeps its 60 s delay and the R21 hiding. The map shows positions only and never thoughts. The work goes to packet C2-07m.
