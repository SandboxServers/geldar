# threshold/mcp (`@geldar/mcp`)

The real MCP server for sovereign players. It serves the same 14 tools as the mock
(`threshold/mcp-mock`, `@geldar/mcp-mock`) from `@geldar/contract`, but each call reaches a real
ranger's Body over NATS, with per-player bearer tokens, a Postgres budget and a durable event log.
The wave plan is `docs/analysis/phase0/waveM-packets.md`; the spec is section 5.15.

Status: code complete (WM-01 to WM-12). The HTTP front door, stores, tools, Body gateway and CLI
exist and have tests. Review fixes are in progress (the Wave M fix packets). The live runs against
a real shard and a real Body are owed to ops; nothing here has been run live yet.

## Layout

```
threshold/mcp/
  package.json        @geldar/mcp: runtime dependencies pinned below
  tsconfig.json
  README.md           this file
  src/
    config.ts         reads sovereign/chat/tick_rate config and the GELDAR_* environment; fails fast
    config.test.ts
    ports.ts          the interfaces every store, gateway and clock sits behind
    play-view.ts      toPlayView: the look snapshot with world text moved to untrusted_world_text
    play-view.test.ts
    imports.test.ts   the animus deep paths and @geldar/mcp-mock resolve
    fakes/
      stores.fakes.ts  in-memory versions of the stores and ports
      world.fakes.ts   FakeBody: scripted events, snapshots, plans and books
```

The tree above is the WM-01 skeleton. The later packets added `src/store/**` (WM-02), `src/http/**`
(WM-03), `src/events/**` and `src/tools/wait.ts` (WM-04), `src/budget/**` and `src/record/**` (WM-05),
the read tools and `src/resources.ts` (WM-06), `src/body-gateway.ts`, `presence.ts`, `world.ts`,
`main.ts`, `cli.ts` and `index.ts` (WM-11). The `Dockerfile` and its dockerignore are WM-10.

Tools that read or write outside this package: `tools/migrate` (WM-02), `tools/mcp-tokens`
(WM-09), `tools/players-cli` (WM-12). `golem/src/books/**` (WM-07) and `golem/src/players/**`
(WM-08) are the Body side.

## Ownership

One owner per shared file. Fan-out packets do not edit WM-01's files; they file an interface
request, which WM-11 applies.

| Owner | Files |
|---|---|
| WM-01 | New `contract/schemas/{sovereign-call-event,book-request,book-reply,presence-record,day-night-event}.schema.json`; `contract/src/subjects.ts` (additions only); the `// --- WM-01 sovereign ---` block in `contract/src/index.ts`; the `sovereign:` block of `shards/phase0.yaml`; `pnpm-workspace.yaml`; `pnpm-lock.yaml` (the only lockfile edit in the wave); `threshold/mcp/{package.json,tsconfig.json,README.md}`; `threshold/mcp/src/{config,ports,play-view}.ts`; `threshold/mcp/src/fakes/*`; `tools/{mcp-tokens,migrate,players-cli}/{package.json,tsconfig.json}` |
| WM-02 | `sql/0002_sovereign_mcp.sql`, `sql/README.md` (runner section), `sql/test/check-schema.sql`, `tools/migrate/src/**`, `threshold/mcp/src/store/**` |
| WM-03 | `threshold/mcp-mock/src/server.ts` and `index.ts` (an additive auth/limits hook; mock behaviour unchanged), `threshold/mcp/src/http/**` |
| WM-04 | `threshold/mcp/src/events/**`, `threshold/mcp/src/tools/wait.ts` |
| WM-05 | `threshold/mcp/src/tools/{act,say}.ts`, `threshold/mcp/src/budget/**`, `threshold/mcp/src/record/**` |
| WM-06 | `threshold/mcp/src/tools/{look,status,sleep,journal,read-book,unavailable}.ts`, `threshold/mcp/src/resources.ts` |
| WM-07 | `golem/src/books/**` |
| WM-08 | `golem/src/players/**` |
| WM-09 | `tools/mcp-tokens/src/**` |
| WM-10 | `threshold/mcp/Dockerfile` (+ dockerignore), `compose/mcp.yml`, `compose/cloudflared/config.example.yml`, the `nats` service block in `compose/phase0.yml` (only if Q6 = yes), `docs/threat-model.md` rows, the hosting section of `threshold/mcp/README.md`, the token pattern in `tools/repo-checks` |
| WM-11 | Interface requests against WM-01 files; `threshold/mcp/src/{body-gateway,presence,world,main,cli,index}.ts`; the e2e tests |
| WM-12 | `geldar.ps1` (`players`, `mcp`, `mcp-tokens`, `db` commands, one block), `tools/players-cli/src/**`, `.env.example` keys, the run sections of the READMEs, the live and IT cases |

## Differences from the mock

The mock is the contract's reference. The real server keeps its tool names, schemas and
vocabulary, and changes what sits behind them. The right-hand column is the target design; the
packets in the ownership table deliver it.

| Area | Mock (`threshold/mcp-mock`) | Real (`threshold/mcp`) |
|---|---|---|
| Tool surface | 14 tools, all answered by the simulator | 14 tools; six (`use_skill`, `offer`, `vote`, `propose`, `define_skill`, `write_book`) return `not_available` until the world has them (WM-06) |
| Identity | One unauthenticated session | One HTTP session per player at `/p/<player_id>`, bearer token per player, HMAC-hashed in Postgres (`token_hash = HMAC-SHA256(pepper, token)`) |
| Budget | Simulated, generous | Real numbers from `sovereign.budget`: 30 credits per real hour, cap 240; `act`, `say`, intents cost 1 each; `look`, `wait`, `status`, `read_book` are free |
| Agent approach | Simulated | `agent_approached` reaches the player only through an intent's `wake_on`, never as a free event |
| World and books | Scenarios and a corpus of books | No scenarios and no corpus, except the test life's books (WM-07) |
| `look` | Snapshot with heard lines and sign text inline | Heard lines go to `untrusted_world_text.speech` (newest 40), sign text to `signs`, events come from the event log; never cached |
| `wait` | Simulated wake | Durable per-player cursor on the Mind event stream; keepalive notifications while waiting; `max_seconds` capped at 240 |
| Return time | Simulated clock, no real Body | A hard return near 245 s (a snapshot fetched with a 3 s timeout at the deadline), inside the client's 300 s |
| Audit | No `sovereign_call` event | `sovereign_call` event per call, with no token or session field |

## Configuration

`src/config.ts` reads the shard file and the environment and fails fast on anything missing or
invalid. Environment: `GELDAR_SHARD`, `GELDAR_NATS_URL`, `POSTGRES_HOST`, `POSTGRES_PORT`,
`GELDAR_MCP_DB_PASSWORD_FILE`, `GELDAR_MCP_PEPPER_FILE`, `GELDAR_MCP_PUBLIC_HOST` (a DNS name
only; no IP literal, `localhost`, `*.local`, `*.internal` or userinfo; may be unset in local mode
with `GELDAR_MCP_DEV_HOSTS`), `GELDAR_MCP_BIND` (default `127.0.0.1`; `0.0.0.0` only with
`GELDAR_MCP_IN_CONTAINER=1`). `GELDAR_MCP_TRUSTED_PROXIES` (comma-separated IPs or ranges) replaces
`sovereign.mcp.trusted_proxies`, and `GELDAR_MCP_CLIENT_IP_HEADER` replaces
`sovereign.mcp.client_ip_header`. The Caddy deployment sets the header to `x-geldar-client-ip`
and names Caddy's container address as the trusted proxy; without a trusted proxy the header is
never read. The default header is `x-geldar-client-ip` (decision 0090); `cf-connecting-ip` is not used.

The shard's `sovereign.mcp` limits are: `wait_cap_seconds` (wait's clamp), `max_body_bytes`
(request body), `max_result_bytes` (tool result after trimming), and `presence.lease_seconds` and
`presence.hibernate_after_seconds`. `shard/rules` reports their effective values from the loaded
shard, not the defaults. When `max_connections` or `max_connections_per_address` is left out, both
are derived from `owner_cap_owner`: per address 4 times the owner cap (80 at 20), and the listener
total 4 owners' worth of that (320 at 20).

## Hosting

Status: built, and its entry point (`src/cli.ts`) exists. The image builds from the repo root
(`threshold/mcp/Dockerfile`), and `compose/mcp.yml` overlays it on the stack. It has not been run
against a live shard yet; that run is owed to ops. Nothing here is secret: every value below is a placeholder.

### Local use (loopback)

```
docker compose -f compose/phase0.yml -f compose/mcp.yml up -d geldar-mcp
```

The overlay publishes `127.0.0.1:8788` and nothing else. A client on the host calls
`http://127.0.0.1:8788/p/<player_id>`. A container on the same PC (Docker Desktop) calls
`http://host.docker.internal:8788/p/<player_id>`, which reaches the host's loopback; the Host header
it sends must be in `GELDAR_MCP_DEV_HOSTS`, which the overlay sets to
`host.docker.internal,127.0.0.1,localhost`.

Each request sends `Authorization: Bearer <token>`. The token is the player's value from the
`mcp-tokens` file, which lives outside the repo (`<tokens-file>`). Never paste a token into a README,
a commit, a log or a chat. The DB password and the pepper are Docker secret files in
`compose/secrets/` (gitignored); the container reads them from `/run/secrets/`.

### Run (commands)

Each step is a `./geldar.ps1` command, in this order. The shard (`./geldar.ps1 shard up phase0`) must
be up first.

```
./geldar.ps1 mcp-tokens init               # 1. the pepper and the MCP's own Postgres password (never overwritten)
./geldar.ps1 db migrate --dry-run          # 2. then without --dry-run; back up the live volume first
./geldar.ps1 db migrate --set-role-password geldar_mcp --password-file compose/secrets/postgres-mcp.txt
                                           # 3. the geldar_mcp role is NOLOGIN until this runs; mcp up fails on database auth before it
./geldar.ps1 mcp up                        # 4. init, build and start the container on 127.0.0.1:8788
./geldar.ps1 mcp-tokens owner add <owner> [--cap N]  # 5. the cap defaults to sovereign.owner_cap_default in shards/phase0.yaml (3)
./geldar.ps1 mcp-tokens owner set-cap <owner> <N>     # raise or lower a cap later (0 to 50)
                                           # then: player add, and token mint --out <file outside the repo>
./geldar.ps1 mcp status                    # prints "down" when it is not running
./geldar.ps1 mcp logs
./geldar.ps1 mcp smoke                     # the stub client case against /p/ag-test-01 (needs GELDAR_MCP_TEST_TOKEN_FILE)
./geldar.ps1 mcp down                      # stops the container; volumes and the shard are kept
```

A player's persona (`--identity-file`, `--goals-file`) is refused when it tells the character that
humans or observers watch it, that it is an AI, a model or a simulation, or it names the harness,
shard, colo or credits (decision 0068). Minecraft-the-game words are not refused: the Observer block,
the Echo Shard, the end credits and spectator mode pass. Use `player add ... --allow-meta` only when
the persona must keep such a line; the CLI prints a warning that it kept one.

### Exporting a ranger's persona

`mcp-tokens persona export <character> --out <dir>` reads the approved draft
(`docs/analysis/phase0/worknotes/ranger-personas-draft.md`) and writes `<dir>/memory/identity.md` and
`<dir>/memory/goals.md` for the owner's launcher. The directory must not exist yet, and it must lie
outside this repo and every git work tree, so no persona text reaches git. The same lint as `player add`
runs on both files: a hit refuses the export and prints only the offending lines (file, line, and the
matched marker). `--dry-run` prints the byte sizes and the lint result and writes nothing;
`--allow-meta` keeps a persona that has a hit, with a warning. Both files are owner-only and LF only.

`mcp-tokens` and `db` are passthroughs to `tools/mcp-tokens` and `tools/migrate`; their usage lines
print with no arguments. `mcp-tokens init` writes `compose/secrets/postgres-mcp.txt` (the MCP's Postgres
password) and `compose/secrets/mcp-token-pepper.txt` (the token pepper); `compose/mcp.yml` mounts them under
the same names in `/run/secrets/`. The repo-checks test in `tools/repo-checks/src/mcp-overlay.test.ts` fails
if the two drift apart.

The owner cap counts an owner's players that are not retired, in this shard's database (one database
per shard). Migration 0006 enforces it in the database, so direct SQL cannot pass it: a new or
re-activated player over the cap is refused. Lowering a cap does not retire anyone; an owner who is
over a lowered cap has every token refused at auth (reason `owner_over_cap`, never cached) until the cap is raised or a player is retired. The
owner_cap_owner value (20, decision 0052) is not read by `owner add`: give that owner `--cap 20`.

### Later: the public tunnel (not run)

The public name is owner decision 0053, reserved and not taken. When it is taken, these are the steps:

1. Pick the hostname (placeholder `mcp.<your-domain>`) and set `GELDAR_MCP_PUBLIC_HOST` to it.
   It must be a DNS name, not an IP literal.
2. Copy `compose/cloudflared/config.example.yml` to `compose/cloudflared/config.yml` (gitignored),
   and replace the hostname placeholder and `<tunnel-id>`.
3. Uncomment the `cloudflared` block in `compose/mcp.yml`. It runs only under the `public` profile,
   with the image pinned by tag and digest.
4. In Cloudflare, for that hostname: turn Bot Fight Mode and challenges off (they break Bearer
   clients), add a WAF rule and a rate limit for `/p/*`, and let no other path reach the tunnel.
5. Prove the keepalive: a 240 s `wait` must receive its 25 s keepalives before Cloudflare's 100 s
   proxied-response timeout.
6. Re-review `docs/threat-model.md` sections 2, 3 and 7 before the first request from off-host.

Alternative: Tailscale Funnel needs no domain, but it has no edge limits, so the MCP's own limits
carry all of the load. A port-forward on the home router is rejected: it exposes the home network.

## Dependency pins

Every pin is exact. Ages are days between the registry's publish time and 2026-11-09, read from
`pnpm view <pkg>@<version> time`. Floor: two weeks (decision 0005).

| Package | Version | Published | Age (days) | Used by |
|---|---|---|---|---|
| `@modelcontextprotocol/sdk` | 1.32.2 | 2026-10-23 | 17 | the HTTP server (WM-03) |
| `zod` | 4.6.7 | 2026-10-12 | 28 | tool input validation |
| `@nats-io/transport-node` | 3.4.0 | 2026-05-08 | 185 | the Body link and event stream |
| `@nats-io/jetstream` | 3.4.0 | 2026-05-08 | 185 | the ordered event consumer (WM-04) |
| `@nats-io/kv` | 3.4.0 | 2026-05-08 | 185 | presence (WM-04) |
| `pg` | 8.23.1 | 2026-09-30 | 40 | the Postgres stores (WM-02) |
| `@types/pg` (dev) | 8.23.1 | 2026-08-17 | 84 | types for `pg` |
| `yaml` | 2.9.1 | 2026-09-11 | 59 | shard config |

Workspace dependencies: `@geldar/contract`, `@geldar/mcp-mock`, `@geldar/animus`.
`tools/{mcp-tokens,migrate,players-cli}` pin their own dependencies in the same lockfile; their
ages are recorded in their package manifests.
