# 0480. The Turbo rangers run on geldar-nf as players-host Bodies and geldar-mcp

- Status: Accepted (operator brief 2026-11-28). `presence.start` is open (G2), see Open.
- Date: 2026-11-28
- Spec: none. `docs/spec.md` is not touched.
- Source: `docs/analysis/neoforge/turbo-rangers-packets.md` (plan, sections 1 to 4).
- Related: 0070 (Phase 1 is the Colo-first shard), 0078, 0250, 0458, 0459.

## Decision

1. **Five players-host Bodies and one geldar-mcp** run on the NeoForge shard (project `geldar-nf`). No golem-body is
   used. The rangers are `players-host` processes, one per life, read from `shards/nf-mind.yaml`.
2. **Life and player ids.** Five lives: `ag_turboyelo_01` (TurboYellow), `ag_turbogreen_01` (TurboGreen),
   `ag_turboblue_01` (TurboBlue), `ag_turbored_01` (TurboRed), `ag_turbopink_01` (TurboPink). The player id is the
   life id with dashes (`ag-turboyelo-01`). Yellow is `yelo`, not `yellow`: `ag_turboyellow_01` is 17 characters,
   over the 16-character limit of the Minecraft name and the life id rule.
3. **The shard file** is `shards/nf-mind.yaml` (`shard: nf`, `identity_mode: watched`, the five players only). It is
   mounted as `/opt/geldar/shards/nf.yaml`. Its values for seed and world border are copied from colo and are not yet
   read from the NeoForge world; they are flagged in the file.
4. **Loopback port 46788** (`127.0.0.1:46788`, literal) publishes the nf MCP. No other service uses it. The MCP has no
   public route yet.
5. **Caps.** Each ranger 0.5 CPU, 512m, 128 pids; geldar-mcp 0.25 CPU, 256m, 128 pids; every new service
   `cpu_shares: 256`. The lane is opt-in (`NF_RANGERS=on`) and joins the `nf` network only.
6. **Telemetry never reaches an agent.** No ranger or MCP service carries a TELEMETRY or OTEL variable.

## Known limit (to narrow later)

The `mcp` and `ranger` NATS users are narrowed, and no further. Both are denied the human inbox (`_INBOX.human.>`
subscribes), the maintenance and dead-letter publishes (`geldar.nf.maintenance`, `geldar.nf.dlq`), and the stream
delete, consumer delete and purge (`$JS.API.STREAM.DELETE`, `$JS.API.STREAM.PURGE`, `$JS.API.CONSUMER.DELETE`). The
broad `$JS.API.>` and `$JS.ACK.>` grants remain, copied from the colo users. The nf subjects stay under `geldar.nf.`
and `$KV.geldar-*`. A per-user inbox prefix is later work. The human inbox denial follows decision 0387 (the NeoForge shard is human-directed; 0387 is Proposed, and its
status line says the owner accepts or edits it). This decision does not close its open item D-11.

## Open

- **G2:** `sovereign.presence.start` is `always` in the file for the pre-Mind window. The owner flips it to `on_demand`
  before the hand-off.
- **G3:** the skin variant (classic or slim) per life. Default classic.
- **Unverified on the node:** the NF world seed and world border; that a sovereign Body joins and acts on NeoForge
  26.1.2; that `sovereign_call` reaches players-host.
- **Not in this decision:** the Minds (scriptorium, kit) and the public route. Both are gated.
