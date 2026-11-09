# P0-06 coder report (continuation 2)

Status: done. Branch phase0/p0-06-compose, worktree p0-06.

## Files changed
- shards/phase0.yaml (new)
- geldar.ps1 (`shard secrets <name>`; `shard up` runs it first)
- .github/workflows/ci.yml (compose job: `shard secrets phase0` step before `docker compose config`)
- .github/dependabot.yml (security-only docker entry for /compose)
- compose/phase0.yml, compose/.env.example, compose/paper/paper-entrypoint.sh, compose/velocity/velocity.toml (kept from the previous coder; entrypoint fixed)
- .claude/skills/run-shard/SKILL.md (paper port row)

## Fixes made while testing
- paper-entrypoint.sh: /data/config was created as root, so Paper (uid 1000) could not write its config. It now chowns /data/config like /data.
- Run 2 hit a half-built world left by run 1. Removed the geldar-phase0_paper-data volume only, then rebuilt.

## Check results
- `./geldar.ps1 check`: status exit 0 (both before and after the entrypoint fix); "All checks passed."
- `./geldar.ps1 shard up phase0`: final run exit 0. Health: postgres, nats, paper, velocity all healthy.
- Health table (run-shard SKILL.md): postgres pg_isready ok; pgvector 0.8.6; 18 public tables (sql/0001_init.sql defines 18 CREATE TABLE); NATS `{"status":"ok"}`; paper healthy; velocity healthy; Ollama lists qwen3:32b and qwen3:8b.
- Velocity 3.5.1 build 615 boots (log). A login handshake at protocol 775 to velocity:25565 got Velocity's Set Compression and Velocity logged "probe-via has connected", so 775 is forwarded.
- paper-global.yml survives the image's startup: `proxies.velocity.enabled: true`, velocity `online-mode: false`, secret written from the secret file (value not printed).
- Negative 1 (direct to paper:25565 from a throwaway node:24-alpine container on geldar-phase0_default): Paper replied with a login plugin request (`velocity:player_info`) that the probe cannot answer; Paper logged `probe-direct ... lost connection: Disconnected`. No login was granted. Note: Paper sends no disconnect reason here, so "refused" is the dropped login, not a message.
- Negative 2: `docker compose -f compose/phase0.yml -p geldar-phase0 port paper 25565` prints an error, not nothing: `no port 25565/tcp for container geldar-phase0-paper-1: 25575/tcp`, exit 1. The published-port list shows only 25575 for paper. `Test-NetConnection 127.0.0.1 -Port 25565` reaches Velocity (TcpTestSucceeded True).
- `shard down phase0`: exit 0, no containers left (volumes kept).

## Deviations
- Negative 2 wording: the port command fails (exit 1) rather than printing nothing; the health table row now says so.
- The probe script was a scratchpad file, not committed.
- Commit trailer: the brief names Claude Sonnet 5.5; the launch notice names Claude Haiku 5.5. The brief's two lines were used as instructed.

## Open risks from the previous coder
- paper-global.yml surviving the image: resolved (see above).
- Trimmed velocity.toml: Velocity parses it and runs (healthy).
- Velocicron plugin startup: no plugin is in this packet; nothing to test.
