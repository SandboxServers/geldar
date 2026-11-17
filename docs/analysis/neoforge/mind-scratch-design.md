# Mind test on the scratch stack: design note (Option A')

Status: design note, 2026-11-17. Nothing here was run; no container, no server, no node contact. Input: [mind-route.md](mind-route.md) section 4 (Option A') and section 6. Facts are from the repo at `origin/main` (commit 491b2326) unless marked UNVERIFIED. This note is STEP 1 of the packet. No file under golem/, eventsink/, tools/admin/, contract/, sql/, threshold/ or tools/mcp-tokens/ needs a change for Option A' (section 9).

## 1. What the scratch stack has today

- Base: `compose/phase0.yml` plus `compose/opt-in/scratch.yml` (loopback-only ports on high defaults, caps, label `geldar.scratch=true`, `restart: "no"`). Services: postgres, nats, paper, velocity, identity-seed (one-shot), eventsink. Project name `scratch-<suffix>`, state in `$SCRATCH_STATE_ROOT/scratch-<suffix>` (secrets dir, 0700; files 0600).
- Secrets written by `up` (`fill_secrets`, scratch.sh): `postgres.txt`, `rcon.txt`, `velocity-forwarding.txt`. NATS auth comes from a user-supplied `SCRATCH_NATS_AUTH_DIR` (five files: `nats-auth.conf`, `nats-paper.txt`, `nats-velocity.txt`, `nats-eventsink.txt`, `nats-seed.txt`; the probe also needs `nats-body.txt`).
- `up` refuses when the project already has containers or the secrets dir exists. `down` runs `compose down -v --rmi local --remove-orphans`, then `rm -rf` on the secrets dir only if `secrets_removable` (a real directory under `$STATE_ROOT/scratch-*`, owned by the caller), then lists leftover volumes and exits 1 if any remain.
- Verbs today: `up`, `status`, `down`, `probe` (`scratch.sh`, usage line 3).
- Schema: `compose/phase0.yml` mounts `../sql` at `/docker-entrypoint-initdb.d` (line 25). Files there run in name order on a fresh Postgres volume only. So scratch Postgres gets its schema from `sql/0001_init.sql` and `sql/0002_sovereign_mcp.sql` on first start. No eventsink or migrate step is needed for tables.
- `0002_sovereign_mcp.sql` creates `mcp_tokens` (line 33, with a revoke trigger) and `geldar_mcp` as NOLOGIN (line 80). The login is granted only by `migrate --set-role-password geldar_mcp`. Without that step geldar-mcp fails on database auth (same as the colo precheck in geldar.ps1, lines 544-546).

## 2. Services for the overlay (`compose/opt-in/scratch-mind.yml`, proposed)

Copies of the colo blocks (`compose/colo.yml` geldar-mcp line 326, players-host line 600) with scratch names, ports, secrets and caps. Profile: none for geldar-mcp (started by the mind verb only, see section 7); players-host under profile `mind`, so a plain `up` never starts it.

| Service | Image | Env (key values) | Secrets | NATS user | Caps (proposed) | Ports |
|---|---|---|---|---|---|---|
| geldar-mcp | `${GELDAR_MCP_IMAGE:-geldar-mcp:c1}` (threshold/mcp/Dockerfile exists) | `GELDAR_SHARD` (see UNVERIFIED), `POSTGRES_HOST=postgres`, `GELDAR_MCP_DB_PASSWORD_FILE`, `GELDAR_MCP_PEPPER_FILE`, `GELDAR_MCP_IN_CONTAINER=1`, `GELDAR_MCP_BIND=0.0.0.0`, `GELDAR_MCP_DEV_HOSTS=127.0.0.1,localhost`, `GELDAR_MCP_TRUSTED_PROXIES=127.0.0.1`, `GELDAR_ACT_BUDGET_ENFORCE=0`, `GELDAR_NATS_URL=nats://nats:4222`, `GELDAR_NATS_USER=mcp`, `GELDAR_TELEMETRY_URL` unset | postgres-mcp.txt, mcp-token-pepper.txt, nats-mcp.txt | mcp | 0.5 CPU, 512m, 128 pids, memswap = mem | `127.0.0.1:${SCRATCH_MCP_PORT:-18788}:8788` |
| players-host | `${GELDAR_BODY_IMAGE:-geldar-body:c1}` (golem/Dockerfile) | `GELDAR_SHARD`, `GELDAR_IN_NETWORK_HOSTS=1`, `GELDAR_MC_HOST=velocity`, `GELDAR_MC_PORT=25565`, `GELDAR_RCON_HOST=paper`, `GELDAR_RCON_PORT=25575`, `GELDAR_NATS_URL`, `GELDAR_NATS_USER=body`, `GELDAR_PLAYER_ID` (the one test player) | rcon, nats-body.txt | body | 1 CPU, 2g, 256 pids (colo players-host is 2048m) | none |

- No Caddy, no published Minecraft port, no published NATS or Postgres port beyond the existing loopback ones. The MCP port is the only new published port.
- Both services: `labels: geldar.scratch: "true"`, `restart: "no"`, `memswap_limit` equal to the memory cap, `pids_limit` set, `read_only: true` for geldar-mcp with `tmpfs /tmp` as colo does, `cap_drop: [ALL]`, `no-new-privileges`.
- Run as the account uid:gid (`user: "${SCRATCH_RUN_UID}:${SCRATCH_RUN_GID}"`), as identity-seed and eventsink do, so the 0600 secret files are readable.
- Secrets: the scratch secrets dir gets three new files at `mind-up` time: `postgres-mcp.txt`, `mcp-token-pepper.txt`, `nats-mcp.txt` (the NATS file comes from the auth dir, see section 5), plus `mind-token.txt` written by `mind-token` (section 4).

## 3. Postgres role

- The `geldar_mcp` role password is set once, after postgres is healthy, by a one-shot run of the migrate tool against the scratch Postgres (`tools/migrate`, through the admin image, or the same command `./geldar.ps1 db migrate --set-role-password geldar_mcp --password-file <file>` run inside the scratch network). Which image runs it is UNVERIFIED (the admin image entry in `compose/colo.yml` line 650 runs `tools/migrate` under profile `admin`).
- The mint and roster steps also write to `mcp_tokens` and the roster tables, so they need the same Postgres access. The `mcp_tokens` table exists from section 1.

## 4. Roster and token mint (operator steps, run on the node)

- Roster: `tools/mcp-tokens` verb `player <id> ...` (cli.ts line 512; `player flags` at line 510). It writes the test player record. Which table it writes is UNVERIFIED (the handler was not read in this note). One test player only; id rule from mind-route section 7: `^[a-z][a-z0-9-]{0,30}$` (UNVERIFIED that this is the exact rule in the code).
- Token: `tools/mcp-tokens` verb `token mint <player> --out <file>` (cli.ts line 89; handler line 431). It writes the token to the `--out` file with owner-only permissions (`mintTokenFile`), and its stdout line names the token id and the file, never the token value. Run it as a one-shot container in the scratch project, from the admin image (`tools/admin/Dockerfile`, the same image `identity-seed` uses), with the scratch secrets dir mounted read-write at `/out`, so the file lands in `$SECRETS/mind-token.txt`. `down` removes the secrets dir, so the token file goes with it.
- The script never echoes the file. The verb prints only the CLI's own `minted <id> for <player> to <path>` line.
- Pepper: `mcp-token-pepper.txt` is generated by `mind-up` (random hex, 0600), same as the other scratch secrets. The live pepper is never read.

## 5. NATS users and the auth dir

- `geldar.ps1` `Get-NatsUsers` (line 370) already has `mcp` (line 395: publish `sovereign_call`, `body.>`, KV `geldar-presence`) and `body` (line 383). So the table has the users; the scratch auth dir does not.
- `Assert-ColoNatsSecrets` (line 306) lists seven colo files, including `nats-mcp.txt` and `nats-body.txt`, and `shard nats-auth <shard>` writes them into `compose/secrets/` (the live directory). Scratch must not write there.
- Option: `mind-up` requires `SCRATCH_NATS_AUTH_DIR` to hold `nats-mcp.txt` and `nats-body.txt` (in addition to the five files), and the operator generates them with the same table into the scratch dir. Whether `shard nats-auth phase0` emits those two files and the `nats-auth.conf` lines for `mcp` and `body` is UNVERIFIED (scratch-stack.md line 283 says the seed user exists only in the phase0 table, so the table is shard-dependent).
- No change to `geldar.ps1` is needed if the phase0 table already emits `mcp` and `body`. If it does not, the change is a shard-conditional entry, and it would only alter colo output if the condition is missing. STOP and report before changing it (the brief's rule).

## 6. Body whitelisting

- The P0 probe joins through Velocity and the scratch RCON secret (`compose/opt-in/scratch-probe.yml`). Whether `golem/src/p0/probe.ts` whitelists the probe player through RCON is UNVERIFIED here (the file was not read in this note).
- The test player must be whitelisted on paper before the Body joins: `whitelist add <id>` over RCON to `paper:25575` from an operator one-shot or from the players-host start path. Whether players-host does this itself is UNVERIFIED.
- Only read-only RCON verbs (`data get`, `execute if`, `tick query`, `list`, `gamerule <name>`) for checks, as the brief says.

## 7. Verbs (proposed: the smallest set)

- `scratch.sh mind-up <suffix>`: requires the project to be running (`up` done, so containers exist and `$SECRETS` exists), platform `neoforge` or `paper`, `SCRATCH_NATS_AUTH_DIR` with the seven files, project name `scratch-<suffix>`. It writes the three missing mind secrets with `umask 077`, then runs `compose -p scratch-<suffix> -f compose/phase0.yml -f compose/nats-auth.yml -f compose/opt-in/scratch.yml -f compose/opt-in/scratch-mind.yml up -d --wait geldar-mcp`, then the role-password one-shot. players-host starts with `GELDAR_PLAYER_ID` set (profile `mind`).
- `scratch.sh mind-token <suffix> <player>`: runs the roster step and the mint one-shot (section 4); exit 2 on refusals (no player id, project not running, token file already exists).
- No `mind-down` verb: `down` already removes containers, volumes and the secrets dir (and so the mind token file). Adding a `mind-down` would be a second cleanup path to test.
- Refusals (both verbs): suffix must match the existing rule; project must be `scratch-<suffix>`; the overlay path must be the repo's own file; `SCRATCH_PLATFORM` must be `neoforge` or `paper`; `SCRATCH_NATS_AUTH_DIR` must hold non-empty files (exit 2 before compose runs, as `check_nats` does).

## 8. Ports and caps

- New loopback port: `SCRATCH_MCP_PORT`, default 18788 (free in the scratch defaults: 15432, 14222, 18222, 35565). The port check in `load_ports` (scratch.sh line 57) has to accept the new name; UNVERIFIED that it does not reject unknown names.
- Caps: geldar-mcp 0.5 CPU, 512m, 128 pids; players-host 1 CPU, 2g, 256 pids. Existing scratch total (postgres 0.5/768m, nats 0.25/256m, paper 1.5/3g, velocity 0.5/768m, identity-seed 0.25/256m, eventsink 0.25/384m) plus these is about 4.75 CPU and about 7.3 GiB. Host headroom beside the live shard is not measured.

## 9. Forbidden-path check

No change is needed in golem/, eventsink/, tools/admin/, contract/, sql/, threshold/ or tools/mcp-tokens/. The images and CLIs are used as they are: `geldar-mcp:c1` (threshold/mcp), `geldar-body:c1` (golem), `geldar-admin:c1` (tools/admin, for the mint, roster and identity-seed one-shots), and the schema from `sql/` through the existing initdb mount. The dev Host header needs no code change if the seam sends `127.0.0.1` or `localhost`, because `GELDAR_MCP_DEV_HOSTS` already exists (colo.yml line 354). If the seam sends another Host, the change would be in threshold/ and this packet would STOP.

## 10. `down` cleanup

- Existing `down` already removes the mind containers (same project), the mind volumes (`-v`), and the secrets dir including `mind-token.txt`, and it exits 1 if any volume is left. A test must show that the mind token file is gone after `down`. Mutation proof: drop the secrets removal and that test must fail.
- The world volume (`GELDAR_WORLD_VOLUME`) is named per project, so `down` removes only the scratch world.

## 11. Operator flow (for the runbook section, STEP 2)

1. `scratch.sh up <suffix>` with `SCRATCH_PLATFORM=neoforge` and `SCRATCH_NATS_AUTH_DIR`.
2. `scratch.sh mind-up <suffix>` (geldar-mcp up, Postgres role password set, players-host started for the test player).
3. `scratch.sh mind-token <suffix> <player>`: writes the token to the scratch secrets dir, prints the token id line only.
4. The owner copies the token to the Mind host with a command that writes a mode 600 file on the owner's machine and never prints it (the owner's `ssh <node> 'cat <secrets>/mind-token.txt' > <local mode 600 file>` pattern, placeholders only; the exact transfer method is UNVERIFIED in this repo).
5. The owner starts the ssh forward: `ssh -N -L <local port>:127.0.0.1:18788 <node-ssh-host>` (placeholders).
6. Checks from mind-route section 6: stack health, no token -> 401, wrong player -> 403, tool list, one look, one goto, plain-text grep, abort paths.
7. `scratch.sh down <suffix>`.

## 12. UNVERIFIED

- The scratch GELDAR_SHARD value and the shard file: geldar-mcp and players-host read `../shards/colo-mind.yaml` on colo. A scratch shard file (and the subject shard name for `geldar.<shard>.`) is not defined; the colo file is not to be mounted unchanged.
- That `shard nats-auth phase0` emits `nats-mcp.txt` and `nats-body.txt` for the scratch auth dir (section 5).
- The migrate command and image for the `geldar_mcp` password (section 3).
- The roster table and the `player` verb handler (section 4).
- Whether `golem/src/p0/probe.ts` or players-host whitelists the test player (section 6).
- Whether `load_ports` accepts the new port name (section 8).
- Whether geldar-mcp accepts the ssh-forward Host header (`127.0.0.1` or `localhost` both listed in colo's dev hosts; the seam's header is not read here).
- MCP over an ssh forward: long replies, keepalive, a dropped session during a call (mind-route section 4, UNVERIFIED).
- The transfer command for the token file (owner side).
- Host headroom on the node; Docker bridge reach from a Mind container to a loopback forward.
- Which Mind the live shard uses (mind-route section 7); not relevant to the scratch overlay.
