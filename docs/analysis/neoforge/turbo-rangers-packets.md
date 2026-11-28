# Turbo rangers on the live NeoForge shard: packets and node steps

Status: plan, 2026-11-28. Nothing here was run or changed; the only node reads were `docker stats`, `docker ps`, `free -m`, `ss -ltn`, `nproc`, and three `psql` selects. UNVERIFIED marks a claim the repo does not prove. Minds (scriptorium, kit) are out of scope and gated; section 7 is the held hand-off only.

Five lives: `ag_turboyelo_01`, `ag_turbogreen_01`, `ag_turboblue_01`, `ag_turbored_01`, `ag_turbopink_01`; names TurboYellow, TurboGreen, TurboBlue, TurboRed, TurboPink; player ids `ag-turbo<color>-01`.

## 0. Blockers found (read first)

1. **RESOLVED: yellow life id.** `ag_turboyellow_01` is 17 characters, over the 16-character Minecraft name limit (the Body logs in with the life id, golem/src/adam/main.ts:251; identity plugin `{1,16}`, LifeRegistry.java:42 and :45; `skin set` roster.ts:16). The owner chose `ag_turboyelo_01` (15 characters, player id `ag-turboyelo-01`, display name TurboYellow). P3's test still pins every life id at 16 characters or fewer.
2. **Golem refuses RCON host `neoforge`.** golem/src/config.ts:18 `IN_NETWORK_HOSTS = nats, postgres, paper, velocity`; :98-106 throws for any other RCON host. players-host admits each life over RCON before connecting (golem/src/players/main.ts:144, whitelist.ts). On geldar-nf the RCON host is `neoforge` (compose/nf-live.yml:250). Packet P1 fixes it; it is the only packet in the colo-images filter.
3. **NATS users.** The live nf NATS has no `mcp` user and its `body` user may touch one registry key only (deploy/nats-auth-nf.ps1, the `body` entry; probe `ag_nfprobe_01`). A real Body needs the colo `body` set (geldar.ps1:391-420, `body` and `mcp`). The nf generator never rewrites an existing conf (nats-auth-nf.ps1: "never overwritten"), so a node step is needed (N1).
4. **Skin upload approval.** Decision 0140 approved MineSkin uploads for the six original rangers only; docs/runbooks/skins.md says any further upload "needs the owner's explicit approval, recorded before the upload runs". Five new uploads needed that record: the owner approved them explicitly in the 2026-11-28 session (MineSkin upload, unlisted, vault key); gate G1 is met. Decision 0250: visibility stays `unlisted`.
5. **Port 46222 (NATS) is never published**, so the skins step cannot tunnel to a host port. It tunnels to the NATS container address on the nf bridge (section 6).

## 1. What each Body host is

- **golem-body = Adam**, the single house Body: `entrypoint node src/adam/main.ts`, profile `adam`, one life (compose/colo.yml:244-287, entrypoint :260, profile :284). Not used for rangers.
- **players-host = sovereign player Body**, one process per life: `entrypoint node src/players/main.ts`, `command --player <player-id>`, profile `sovereign` (compose/colo.yml:564-616; entry :581; profile :565). It reads `shards/<GELDAR_SHARD>.yaml`'s `sovereign.players` (golem/src/players/main.ts:76), whitelists its life over RCON (:144), registers in the life registry, and comes up on the life's `geldar-presence` record (main.ts:70-95) or at start if `sovereign.presence.start: always` (main.ts:175). It answers the MCP's requests through `natsRequestServer` (main.ts:102).
- **geldar-mcp** (threshold/mcp, compose/colo.yml:289-357) is the door a Mind calls. It publishes `sovereign_call` events and presence and talks to the Body over NATS (docs/analysis/neoforge/mind-route.md section 2 hops 3 to 5). The repo does not state in one line that sovereign_call ends in players-host rather than golem-body; the code reads say players-host (presence plus `--player`). UNVERIFIED end to end on NeoForge.
- So the rangers need **players-host x5 plus geldar-mcp**, and no golem-body.

How colo.yml wires them (use as the template):

| Item | geldar-mcp (colo.yml) | players-host (colo.yml) |
|---|---|---|
| env | GELDAR_SHARD, POSTGRES_HOST/PORT, GELDAR_MCP_DB_PASSWORD_FILE, GELDAR_MCP_PEPPER_FILE, GELDAR_MCP_IN_CONTAINER=1, GELDAR_MCP_BIND=0.0.0.0, GELDAR_MCP_DEV_HOSTS, GELDAR_MCP_TRUSTED_PROXIES, GELDAR_ACT_BUDGET_ENFORCE, NATS URL/user/password file (:306-336) | GELDAR_SHARD, GELDAR_IN_NETWORK_HOSTS=1, MC host velocity:25565, RCON host/port/password file, NATS URL/user/password file (:585-600) |
| secrets | postgres-mcp.txt, mcp-token-pepper.txt, nats-mcp | rcon, nats-body |
| shard file | `../shards/colo-mind.yaml` to `/opt/geldar/shards/colo.yaml` ro | the same file |
| ports | `127.0.0.1:${GELDAR_PORT_MCP:-8788}:8788` (:333-335) | none |
| hardening | read_only, tmpfs /tmp, cap_drop ALL, no-new-privileges, healthcheck TCP 8788 | none set; user uid:uid |
| caps | 0.5 CPU, 512m, 128 pids | 1 CPU, 2048m, 256 pids |
| image | geldar-mcp:c1 built from threshold/mcp/Dockerfile | geldar-body:c1 built from golem/Dockerfile |

The overlay pattern to copy: compose/nf-live-probe.yml (opt-in, `name: geldar-nf`, `image: geldar-body:geldar-nf` built from `golem/Dockerfile`, `user` from NF_SERVICE_UID, network `nf` only, own secret declarations with `file: ${NF_SECRETS_DIR:-./secrets-nf}/...`, `cpu_shares: 256`, `cap_drop`, `read_only`, logging 10m x3, labels `geldar.project: geldar-nf`, `watchtower.enable: "false"`, no depends_on so it renders alone) and compose/nf-live-human.yml (published port exception; second network). The deploy side: deploy/nf-deploy.sh adds the human file when `NF_HUMAN=on` through deploy/nf-human-lib.sh (flag check, file checks, port gate, an `up -d --wait` step, a `human-down` verb). Copy that structure as `NF_RANGERS=on` and `deploy/nf-rangers-lib.sh`.

**Do not join a second network.** nf-live-human.yml adds `nats` and `neoforge` to `nf-human`, so its first `up` recreates nats, eventsink and neoforge (nf-deploy.sh:460). The rangers overlay must join `nf` only and must not redeclare any base service, so adding it never recreates a live service (checked by P4's test).

## 2. What geldar-mcp needs in geldar-nf

| Need | Plan | Source |
|---|---|---|
| Database | `geldar_nf` already exists (nf-live.yml postgres POSTGRES_DB). Applied migrations: 45, max 0066 (fresh read). Repo has 0067, 0068 pending: run `migrate` once (N2). Roles `geldar_mcp`, `geldar_body_host` exist, NOLOGIN. | sql/, tools/migrate/src/migrate.ts:138 |
| Role password | `migrate --set-role-password geldar_mcp --password-file <file>` via the admin image; MCP reads it from `GELDAR_MCP_DB_PASSWORD_FILE`; `POSTGRES_DB=geldar_nf` must be set (config.ts:219 defaults to `geldar`) and admin needs `PGDATABASE=geldar_nf` (tools/admin/admin.sh default is `geldar`) | threshold/mcp/src/config.ts, admin.sh |
| Pepper | file `mcp-token-pepper.txt` (min length enforced, tools/mcp-tokens/src/secret-files.ts:19). P2 makes the nf generator write it (64 symbols) and `postgres-mcp.txt` (32) | secret-files.ts |
| NATS | new users `mcp` (colo set: Pub `geldar.nf.sovereign_call`, `geldar.nf.body.>`, `$KV.geldar-presence.>`, `$JS.API.>`, `$JS.ACK.>`, `_INBOX.>`; deny `geldar.nf.body.*.hearing`) and `ranger` (the colo `body` set with s=nf, same PubDeny). Keep existing `body` for the probe. | geldar.ps1:391-420 |
| Shard file | `shards/nf-mind.yaml`, `shard: nf` (must equal GELDAR_SHARD, config.ts:194), mounted at `/opt/geldar/shards/nf.yaml`; carries `sovereign` with only the five players; `identity_mode: watched` (checkSovereignIdentity, tools/repo-checks/src/identity-mode.ts). Base on shards/colo-mind.yaml (258 lines) | colo-mind.yaml |
| Token | `mcp-tokens token mint <player-id> --out <file>`; file must be outside the repo and under a 0700 host dir mounted at `/run/tokens` (colo-admin.sh:40-77 shows the rules). nf has no colo-admin.sh equivalent: the overlay needs an `admin` profile service and a small wrapper (P4) | tools/mcp-tokens/src/tokens.ts checkOutPath |
| Port | loopback `127.0.0.1:46788:8788`, literal (loopback-ports.ts rejects interpolation). Used nowhere else in compose/ or deploy/ (grep for 467xx and 468xx: none). Not 25565 or 25566. Add a row to the port table at nf-live.yml:8-13 (comment only) | compose/nf-live.yml |
| Registration | operator order: `owner add` (one owner), `roster add <name> --owner` for each name, `player add <id> --owner --life --name --harness`, then `token mint`. Which string the roster matches (display name or life id) is UNVERIFIED: read docs/runbooks/mcp-tokens.md "Put the name on the roster first" and sql/0002 before writing the step. The life registry bucket `geldar-life-registry` is written by each Body at join (golem/src/registry.ts); the operator never writes it. The "shard roster" is `sovereign.players` in nf-mind.yaml; players-host refuses an unlisted id. | docs/runbooks/mcp-tokens.md |
| Presence | choose `sovereign.presence.start`: `on_demand` (Body joins only when a Mind calls; skins cannot be seen before Minds exist) or `always` (Body joins at host start). Owner decision G2; plan assumes `always` for the pre-Mind window, flipped to `on_demand` before the hand-off. | main.ts:175, config.ts:251 |

Postgres reads: `select count(*), max(version) from schema_migrations` returned 45 | 0066. `mcp_owners` and `mcp_roster` are empty.

## 3. Caps against a fresh node read

Read 2026-11-28 16:51 UTC (source: `ssh` to the Colo node, `nproc`, `free -m`, `docker stats --no-stream`, `uptime`):
16 CPUs; 128406 MiB total, 89056 MiB available, 14034 free; load average 1.75 1.31 1.22. Containers: 73 running (24 colo players-host Bodies at about 135 to 185 MiB each and 1.7 to 3.6 percent CPU, one burst at 15.7 percent). geldar-colo-paper-1: 9.87 GiB of a 15 GiB cap, 25.6 percent CPU. geldar-nf: neoforge 6.2 GiB of 12 GiB, velocity 285 MiB, velocity-human 319 MiB, nats 23 MiB, eventsink 42 MiB, postgres 43 MiB, all healthy 10 days. The 8-CPU Paper figure from geldar-69 is not visible in `docker stats`; UNVERIFIED (compose/colo.yml:98-99 defaults 3 CPUs and 8192m, overridden on the node).

| New service | CPUs | Memory (no swap) | pids | Basis |
|---|---|---|---|---|
| ranger x5 (each) | 0.5 | 512m | 128 | measured 135 to 185 MiB RSS on colo, about 3x headroom; colo cap is 1 CPU, 2048m |
| geldar-mcp | 0.25 | 256m | 128 | colo geldar-mcp uses 118 MiB of 512 with a much larger roster |
| rangers-admin (one-shot, profile `admin`) | 0.5 | 512m | 128 | colo admin budget |
| Always-on sum | 2.75 | 2816m (2.75 GiB) | | 5 x 0.5 + 0.25 CPU; 5 x 512 + 256 MiB |
| With the admin one-shot running | 3.25 | 3328m | | |

Every new service carries `cpu_shares: 256` so it yields to geldar-colo under contention (as nf-live-cpu-shares.test.ts requires of the base file). Memory: nf-deploy.sh:47 `MEM_CAPS_MIB=16640` plus the new 2816 is 19456; plus the 8192 margin is 27648 MiB, far under 89056 available. CPU caps are a ceiling, not a reservation: actual load is about 1.75 of 16. The new services are far below Paper's 15 GiB cap; shares plus caps keep geldar-colo's Paper from starving. If geldar-69 wants a lower figure, drop each ranger to 0.35 CPU, 384m before P4 (a one-line change).

## 4. Packets (dependency order)

Bundle P2 to P5 on one branch `phase1/nf-rangers` (owner rule: bundle branches); P1 goes separately because it is the only colo-images path. All branches start from origin/main. Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. CI is the full check, so coders do not run `./geldar.ps1 check` locally: they run only the named test files with `./geldar.ps1 pnpm test <name>`.

### P1 `phase1/nf-rangers-golem-host` (colo-images: YES; own PR; coordinate with geldar-69 and geldar-93 before merge, merging golem/** restarts live colo services)
- Files: golem/src/config.ts, its test (golem/test/config.test.ts, name UNVERIFIED: `grep -l hostAllowed golem/test golem/src`).
- Change: add `'neoforge'` to `IN_NETWORK_HOSTS` (:18); update the :104 message. Nothing else; the opt-in `GELDAR_IN_NETWORK_HOSTS=1` still gates it.
- Tests that fail when reverted: `hostAllowed('neoforge', {GELDAR_IN_NETWORK_HOSTS:'1'})` true; false without the opt-in; `parseRconHost('neoforge', optIn)` returns it; `paper` and `velocity` unchanged; a name outside the set still throws.
- Check: `./geldar.ps1 pnpm --filter @geldar/golem test config`, then revert the one line and see the new case fail.
- Commit: `golem: accept the neoforge service name as an in-network RCON host`.
- Node step: none by itself; the node builds the Body image in N3.

### P2 `phase1/nf-rangers` commit 1: NATS users and secret files (colo-images: no; deploy/ and tools/repo-checks only)
- Files: deploy/nats-auth-nf.ps1 (add `mcp`, `ranger` users to `Get-NfNatsUsers`; add `mcp-token-pepper` and `postgres-mcp` to the file list at the `$names` line, the pepper at 64 symbols), deploy/nf-deploy.sh (`SECRET_FILES` only), tools/repo-checks/src/nats-auth-nf.test.ts, nats-auth-nf-upgrade.test.ts (user and file counts), new tools/repo-checks/src/nats-rangers-grants-nf.test.ts (model on nats-human-grants-nf.test.ts).
- Subjects use `geldar.nf.` only; denies copied from geldar.ps1:391-420 with s=nf (`geldar.nf.kino.>`, `blockowner.changed`, `ctl.body.>`, `helper.body.>`, `state.*.level`, `body.*.hearing`, `provenance.>`, `life.>`); `mcp` denies `geldar.nf.body.*.hearing`. `ranger` keeps `$KV.geldar-skins.>` (needed by `skin set`).
- Tests that fail when reverted: users present; no subject outside `geldar.nf.`, `$JS.`, `$KV.geldar-*`, `_INBOX.>`; no `>` alone; each deny present; `body` still limited to the probe key; upgrade path: removing only nats-auth.conf keeps old passwords and creates the new ones.
- Commit: `deploy: nf NATS users ranger and mcp, and the mcp pepper and database password files`.
- Node step: N1.

### P3 commit 2: the nf shard file and decision (colo-images: no; `shards/phase0.yaml` is the only shard path in the filter)
- Files: shards/nf-mind.yaml (new, under 300 lines), docs/decisions/<next number>-nf-rangers.md (the coordinator assigns the number; records: players-host plus geldar-mcp on geldar-nf, the id rule, `presence.start`, port 46788), new tools/repo-checks/src/nf-mind-shard.test.ts.
- Change: copy shards/colo-mind.yaml; `shard: nf`; `mind.agent.username` a non-colliding value (UNVERIFIED which key the MCP cross-checks, config.ts sovereignConfig(block, agentUsername)); `sovereign.players` = the five lives only; world_border_radius and seed from the real NF world (UNVERIFIED: read the neoforge world settings, do not guess); `identity_mode: watched`; `presence.start` per G2.
- Tests that fail when reverted: file parses with `parseMcpConfig` (threshold/mcp) and `parsePlayerConfig` (golem) for each of the five ids; every `life_id` matches the contract regex AND is 16 characters or fewer; every `name` is 1 to 16 of `[A-Za-z0-9_]`; `shard === 'nf'`; no colo life appears; `identity_mode: watched`.
- Commit: `shards: nf-mind.yaml for the five Turbo rangers (decision NNNN)`.
- Node step: none (the file is bind-mounted from the checkout; N3 pulls it).

### P4 commit 3: the opt-in overlay and deploy lane (colo-images: no; compose/ is never copied by CD)
- Files: compose/nf-live-rangers.yml (new, about 250 lines, anchors for the shared ranger block), deploy/nf-rangers-lib.sh (new, modelled on nf-human-lib.sh), deploy/nf-deploy.sh (source the lib; add the `-f` and the up step; the script is 658 lines against a 700 hard cap, so the edit must stay under 40 lines and move any larger logic into the lib), compose/nf-live.yml (port table comment only), tools/repo-checks/src/nf-live-rangers.test.ts (new; skipIf no docker, as nf-live-probe.test.ts), tools/repo-checks/src/loopback-ports.test.ts (add the 46788 case if the allow-list tests enumerate files).
- Overlay content: `name: geldar-nf`; services `geldar-mcp` (image `${NF_MCP_IMAGE:-geldar-mcp:nf-live}`, build threshold/mcp/Dockerfile, env from section 2, port `127.0.0.1:46788:8788`), `ranger-yellow|green|blue|red|pink` (image `${NF_BODY_IMAGE:-geldar-body:nf-live}`, build golem/Dockerfile, `entrypoint [node, src/players/main.ts]`, `command [--player, ag-turbo<color>-01]`, env GELDAR_SHARD nf, GELDAR_IN_NETWORK_HOSTS 1, MC host `velocity` port 25565, RCON host `neoforge` port 25575, RCON password file, NATS user `ranger`, no telemetry variable, `restart: unless-stopped`, read_only, cap_drop ALL, no-new-privileges, tmpfs /tmp), `rangers-admin` (profile `admin`, restart no, image `${NF_ADMIN_IMAGE:-geldar-admin:nf-live}`, `PGDATABASE: geldar_nf`, `PGHOST: postgres`, `GELDAR_SHARD_FILE`). Networks `nf: {}` only. Own `secrets:` declarations (nats-ranger.txt, nats-mcp.txt, postgres-mcp.txt, mcp-token-pepper.txt; the base declares `rcon` and `postgres` and the file renders alone as the probe's does, so re-declare `rcon` and `postgres` too). Caps per section 3.
- Lib: `NF_RANGERS` off by default, any other value refuses; checks the shard file, the four secret files (mode 0600), that the NATS conf names `ranger` and `mcp` (as `check_human_conf` does for human), the port 46788 free, memory; step `up -d --wait geldar-mcp ranger-*` with `--no-deps`; `rangers-down` stops and removes only those six; an off-run refuses while they exist.
- Tests that fail when reverted: the overlay alone and with the base render; services only these seven; no `ports` except `127.0.0.1:46788:8788`; networks only `nf`; no base service name is a key (so no recreate); every service has `cpu_shares: 256`, `cap_drop: [ALL]`, the section 3 caps and `memswap_limit` equal to memory; no env key containing TELEMETRY or OTEL (rule: telemetry never reaches an agent); no `paper` host; the commands carry exactly the five player ids; `nf-deploy.sh plan` with NF_RANGERS unset prints no ranger step and the default render is byte-identical to before.
- Commit: `compose: opt-in rangers overlay (geldar-mcp and five players-host Bodies) for geldar-nf`.
- Node step: N3 to N6.

### P5 commit 4: runbook text (colo-images: no)
- Files: docs/runbooks/nf-live-project.md (new section "Rangers lane": N1 to N8 below, verbatim), docs/runbooks/skins.md (a short "NeoForge shard" subsection pointing at it, plus the 17-character rule). No code; no behaviour test needed. Check: `./geldar.ps1 pnpm test repo` markdown/link checks if any.
- Commit: `docs: runbook for the Turbo rangers lane on geldar-nf`.

## 5. Node steps for ops (every one needs an owner "go" recorded first; rollback after each)

Common: ops account is uid 1001; export `NF_SERVICE_UID=1001`, `NF_SECRETS_DIR=<the node's secrets-nf dir>`; commands run from the node checkout; `DEPLOY_DRY_RUN=1` first where the script supports it. Never print secret files. Never run `docker compose down`, `--volumes`, or anything naming `neoforge`, `postgres`, `nats` for recreate. Do not use pattern kills.

**N0 preflight (read only).** `docker ps --filter label=com.docker.compose.project=geldar-nf --format '{{.Names}} {{.Status}}'` expects the six services healthy (velocity-human too). `free -m` available above 30000. `ss -ltn | grep 46788` prints nothing. Rollback: none.

**N1 NATS users (no restart).** On the trusted machine, in a clean `git archive` export of the merged commit, copy only `nats-auth.conf`'s missing pieces: with the live secrets dir copied in (owner-approved, outside the repo), delete only `nats-auth.conf` from the copy, run `./geldar.ps1 shard nats-auth nf --live`; expected `created compose/secrets-nf/nats-ranger.txt`, `nats-mcp.txt`, `postgres-mcp.txt`, `mcp-token-pepper.txt`, `created compose/secrets-nf/nats-auth.conf`, and existing files untouched (pinned by nats-auth-nf-upgrade.test.ts). Copy the four new password files and the new conf to the node (mode 0600). Apply the conf in place, never `mv`: follow docs/runbooks/nats-auth-inplace.md against the nf container (`cat new > live`, then `docker exec <nf nats container> nats-server --signal reload` or the runbook's SIGHUP form). Expected: the container log shows a config reload with no error, `docker ps` still shows nats healthy, and `velocity`, `neoforge`, `eventsink` stay connected (no restart). The `http:` line must be identical old to new (runbook fact). UNVERIFIED on nf: the runbook is written for the colo container name and mounts; nf mounts the conf as a compose secret file. Fallback if reload fails: `nf-deploy.sh refresh-secrets` (recreates nats, velocity, eventsink, identity-seed AND neoforge: a world restart, needs a notice and an owner go). Rollback: write the saved old conf back with `cat old > live` and reload; the extra users are harmless unused.

**N2 database (additive).** Build the admin image (N3 first). Dry run: `docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml --profile admin run --rm --no-deps rangers-admin migrate --dry-run` expects exactly `0067` and `0068` pending. Apply without `--dry-run`. Then `... run --rm --no-deps rangers-admin migrate --set-role-password geldar_mcp --password-file /run/secrets/postgres-mcp.txt`; expected: a one-line OK, no password printed. Verify read-only: `docker exec <nf postgres container> psql -U geldar -d geldar_nf -Atc "select max(version) from schema_migrations; select rolcanlogin from pg_roles where rolname='geldar_mcp'"` expects `0068` and `t`. Rollback: migrations are forward only; the two migrations add structure and no existing row changes. Role: `ALTER ROLE geldar_mcp NOLOGIN` restores the prior state. Take `pg_dump` of `geldar_nf` first (owner-approved path) as the real rollback.

**N3 build and render.** `git -C <checkout> fetch` and fast-forward to the merged commit (P1 included). `docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml config --quiet` expects no output. `... build geldar-mcp ranger-yellow rangers-admin` expects three images (`geldar-mcp:nf-live`, `geldar-body:nf-live`, `geldar-admin:nf-live`); the other four ranger services share the body image. `docker images` confirms. Rollback: `docker rmi` the new tags only.

**N4 bring up.** `NF_RANGERS=on DEPLOY_DRY_RUN=1 deploy/nf-deploy.sh plan` lists the rangers step and no recreate of nats, neoforge, velocity, eventsink, postgres. Then `NF_RANGERS=on deploy/nf-deploy.sh up` (or the lib's own verb). Expected: `geldar-mcp` healthy (`127.0.0.1:46788` listening), five ranger containers Up; `docker logs` of one ranger shows one JSON line per event with `life_id`. Check the six base services still show their original uptime (not recreated). With `presence.start: always` each Body logs a join through `velocity`; `docker logs <nf velocity container> | grep 'Admitted'` shows five agent names. Whether the Body completes a join on NeoForge 26.1.2 is UNVERIFIED for the sovereign host (the P0 probe is the evidence; docs/analysis/neoforge/p0-findings.md). Rollback: `NF_RANGERS=on deploy/nf-deploy.sh rangers-down` (stops and removes the six only); base services unaffected.

**N5 registration.** All through `rangers-admin` (`run --rm --no-deps`): `owner-add <owner id> --cap 5`; `roster add <name> --owner <owner id>` for each; `player-add <player-id> --owner <owner id> --life <life> --name <Name> --harness claude`; then `players-status`. Expected: five players listed, no token values. Owner id and harness are owner inputs (UNVERIFIED which harness fits). Rollback: `token-revoke`, then `player-flags`/retire per docs/runbooks/retire-an-agent.md; no world effect.

**N6 skins.** See section 6.

**N7 show them.** Reconnect each Body: `docker restart <ranger container>` one at a time (a restart keeps the checkpoint, main.ts handles SIGTERM). Then `docker logs <nf velocity container> | grep skin:` expects `skin: applied for <life> (variant classic|slim)` five times and `skin: bucket geldar-skins synced, 5 keys cached, 0 rejected` (docs/runbooks/skins.md "Verify a skin was applied"). A `skin: lookup skipped` means the name is not in the registry. Then join with the human client and look. Rollback: `skin` records can be deleted by the same NATS user (`nats kv del`); a restart reverts to the default look.

**N8 whole-lane rollback.** `rangers-down`; remove `NF_RANGERS` from the environment; the four new secret files and the two conf users may stay. State left behind: Postgres rows (owners, players, roster), the skins bucket keys, the registry keys (expire by TTL), the images.

## 6. Skins step (desktop plus tunnel), approved (G1)

Rules checked in code: `skin set <player-id> <png>` takes the **player id** (`ag-turbogreen-01`), looked up in the shard file `sovereign.players` (tools/players-cli/src/cli.ts:161, roster.ts:findPlayer), then writes the key = `life_id` in `geldar-skins`. The PNG must be 8-bit RGB or RGBA, 64x64 or 64x32, only IHDR/IDAT/IEND chunks, at most 24 KiB (skins.md; png.ts); a PNG with extra chunks (text metadata) is refused, so run `--check-only` first. A skin file inside the repo must be under `skins/`; outside the repo it is fine (roster.ts checkSkinPath), so read the PNGs from the Downloads folder in place. The CLI needs the MineSkin key in `compose/secrets/mineskin.txt` (git-ignored, cli.ts:31). Visibility defaults to `unlisted` (decision 0250); do not pass `--visibility`.

1. G1 satisfied: the owner gave explicit approval in the 2026-11-28 session for the five MineSkin uploads, visibility unlisted, using the vault key (decision 0140 covered six only; record it in the P3 decision). Gate G3: the owner says classic or slim per skin (default classic; UNVERIFIED which the five need).
2. Key: `az keyvault secret show --vault-name kv-geldar-secrets --name geldar-mineskin-api-key --query value -o tsv` written straight into `compose/secrets/mineskin.txt` of the desktop checkout (no echo, no variable printed; set owner-only mode). Expected: file non-empty. Remove it with `Remove-Item` after step 6, and confirm `git status` stays clean.
3. Shard file for the CLI: `$env:GELDAR_SHARD_FILE = '<checkout>/shards/nf-mind.yaml'` (needs P3 merged).
4. Check only, per life: `./geldar.ps1 pnpm --filter @geldar/players-cli exec node src/cli.ts skin set ag-turbogreen-01 <Downloads>/2013_11_21_skin_20131121020941114375.png --check-only` expects `ok: 64x64 skin for ag-turbogreen-01 (life ag_turbogreen_01); not uploaded`. Files: yellow `..._20131121021046148805`, green `..._20131121020941114375`, blue `..._20131121020553151881`, red `..._2013112102045098535`, pink `..._201311210211535277` (each `2013_11_21_skin_<id>.png`). Yellow uses `ag-turboyelo-01` (life `ag_turboyelo_01`).
5. Tunnel: read the NATS container's bridge address (read-only `docker inspect`), then `ssh -N -L 14222:<that address>:4222 <node>` in a second terminal; set `GELDAR_NATS_URL=nats://127.0.0.1:14222`, `GELDAR_NATS_USER=ranger`, and the password-file variable the CLI reads (UNVERIFIED name: read `connectNats` in contract/ before this step; tools/players-cli/src/skin-store.ts:1 calls it) pointing at the owner-approved credential file, which must hold `$KV.geldar-skins.>` publish (N1). Never put the password on a command line.
6. Upload: `... skin set ag-turbogreen-01 <png> --model classic` (repeat for the five). Expected `stored the classic skin for ag-turbogreen-01 (life ag_turbogreen_01) in geldar-skins`. MineSkin rate limits apply (skins.md); wait between uploads if refused. The 64x32 case does not apply (all five are 64x64).
7. Verify: `skin show ag-turbogreen-01` prints variant, texture host `textures.minecraft.net`, signature length. Close the tunnel; delete `compose/secrets/mineskin.txt`; clear `GELDAR_*` variables.
8. Reconnect and look: N7.
Fallback without a tunnel (skins.md "Sign a skin"): `skin set ... --no-store --export-json <path outside repo>`, copy the JSON to the node, import in the node's admin container with `skin-import`. Needs the overlay's admin service to mount a 0700 directory read-only at `/run/skins`.

## 7. Held last step (do not run; Minds are gated)

Hand-off package: the five life ids and player ids; the MCP URL (loopback `127.0.0.1:46788`, path `/p/<player-id>`; the public route and the Host allow-list `GELDAR_MCP_DEV_HOSTS` for nf are NOT set up; the colo Caddy upstream points at colo's 8788 and UNVERIFIED how scriptorium would reach nf); five bearer tokens minted by `token-mint` into a 0700 directory, delivered by the owner's channel, never into the repo or a log. Before the hand-off flip `presence.start` to `on_demand` if G2 chose `always`.

## 8. Rules that apply

- Agents are never told they are watched; no packet adds a prompt, persona or log line that tells them. `identity_mode: watched` is a shard-file value (spec 5.15.8), not agent-visible text. Telemetry never reaches an agent: no TELEMETRY or OTEL variable on any ranger or MCP service, and P4 tests it. The NF_TELEMETRY overlay must not touch them.
- Pin versions: no new third-party image or package is introduced; the overlay reuses the digest-pinned bases through the existing Dockerfiles. Any new dependency would need an exact version at least two weeks old.
- Files: soft cap 500 lines. nf-deploy.sh is already 658 (hard cap 700): keep its edit small and put logic in nf-rangers-lib.sh. nf-mind.yaml and the overlay each stay under 300.
- A behaviour change needs a test that fails when reverted: P1 to P4 each name one; confirm by reverting before reporting done.
- No secrets, IPs (other than `127.0.0.1`) or account names in any committed file; the tunnel address and owner ids are runtime values.
- Colo-images: only P1. Merging it restarts live colo services (memory: colo-images paths); tell geldar-93 first, no force-push.
- Changing a repo file does not change the node: compose/**, deploy/** and shards/** reach the node only by a manual checkout update (N3).

## 9. Not verified

- That a sovereign players-host Body joins and acts on NeoForge 26.1.2 (only the P0 probe ran there).
- That the MCP's `sovereign_call` reaches players-host rather than golem-body (read from code, not run).
- The golem test file name for P1, the decision number, the harness and owner id, the roster-name rule, the CLI's NATS password variable name, the nf world seed and border values.
- In-place NATS reload on the nf container (runbook is colo-specific); that 0067 and 0068 apply cleanly to the nf database.
- That `whitelist add` over RCON succeeds with the NF whitelist off (nf-live.yml sets ENABLE_WHITELIST FALSE).
- Whether the node's Paper cap is really 8 CPUs (not visible in `docker stats`).
- That 46788 stays free at deploy time (free on 2026-11-28 by `ss`).
- The five PNGs themselves (not opened); whether MineSkin accepts them; slim versus classic.
- The CD copy rule for deploy/** (read from colo-cd.sh headers only).
