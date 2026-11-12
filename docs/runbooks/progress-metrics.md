# Progress metrics (operator only)

`tools/progress-metrics` turns logs and samples that already exist into per-agent, per-window numbers, so a harness or
model change can be judged on data. It only reads files. It does not write to the world, does not call the agents' MCP
and publishes nothing; keep its output off anything agents or Glass can read.

## Inputs

| Flag | Source | Gives |
| --- | --- | --- |
| `--paper <file or ->` | Paper console log, or `docker logs --timestamps <paper>` on stdin | deaths with cause, joins, leaves, chat counts |
| `--body <file or glob>` (repeatable; `--agent <id>` forces the agent) | player-host Body JSON lines (`docker logs --timestamps`) | `stall_diag` and the escape-ladder rung that worked, escape episodes, `body_watchdog`, `eat`, `body_restart`, short sessions (`player_down` with `uptime_ms` under 60 s) |
| `--outcomes <file or glob>` (repeatable) | NATS `action_outcome` events, or a Prometheus text scrape | action outcomes by reason, no_effect share |
| `--positions <file>` | `sample.sh pos` | distance, distinct 16x16 chunks, longest time in one 3x3 area, time to leave it |
| `--inventory <file>` | `sample.sh inventory` | distinct item types, first-seen time of wooden/stone pickaxe, crafting table, furnace, bed, torch; time to first pickaxe |
| `--thoughts <file>` | Glass `/api/thoughts` JSON export | journal entries, near-duplicate share (normalised equality or Jaccard >= 0.9 against the previous 20), `asleep` entries |

Without a docker timestamp prefix, Paper lines carry only a clock time: pass `--date YYYY-MM-DD` (UTC). Chat lines
may carry Paper's `[Not Secure] ` prefix. `--window-minutes N` cuts the data into windows; the default is one window
over everything. A tail shorter than a quarter window joins the last window, and the last window ends at the last
data point (deaths per hour uses its real length).

Agent keys: Paper, the Body and positions use the life id (`ag_zack_01`); the thought export is keyed by its
`life_id` too (its `name`, a first name, is only a fallback). The Body's player-host log has an agent field only on
`presence` and `player_up` lines, so a `--body` file's agent is the single `life_id` found in it, else the id in its
name (`players-host-ag-zack-01.log` and `ag_zack_01.log` both work), else `(unknown)`. A merged log with several life
ids gives `(unknown)` to unlabelled lines; give one file per agent.

## Action outcomes

The player-host log never carries action outcomes. The Body publishes one `action_outcome` event per finished action
to NATS (`geldar.<shard>.action_outcome`, with `agent_id` = life id, `at` and `payload.{verb,ok,reason}`), and counts
them in `geldar_action_outcomes_total{status,reason}`. The metric is pushed (OTLP) only: the Body serves no scrape
endpoint, so a Prometheus text file exists only if your telemetry collector exposes one. Capture either:

```bash
# JSON lines, one event per line (only reads; run for the length of the experiment)
docker exec <nats container> nats sub --raw 'geldar.*.action_outcome' > outcomes.jsonl
# or, if the collector exposes Prometheus text:
curl -s http://<collector>:<port>/metrics | grep '^geldar_action_outcomes_total' > outcomes.prom
```

`nats sub` needs the NATS CLI and credentials with subscribe on the subject; JetStream replay of the stream works
too if you can export the messages as JSON lines. The Prometheus form has no agent and no time: its counts go to the
`(unknown)` row in the first window (a `life_id` or `agent` label is used when your scraper adds one), so use the
JSON lines for per-agent numbers. No outcome input means the no_effect column stays empty.
## Sampling positions and inventory

Run on the node, as the operator, one per kind (read-only `data get`). The inventory sampler asks per slot

```bash
RCON_CMD="docker exec <paper container> rcon-cli" \
  tools/progress-metrics/sample.sh pos 10 /var/tmp/pos.tsv ag_zack_01 ag_amy_02 &
RCON_CMD="docker exec <paper container> rcon-cli" \
  tools/progress-metrics/sample.sh inventory 60 /var/tmp/inv.tsv ag_zack_01 ag_amy_02 &
```

(`Inventory[0]` .. `Inventory[40]`, stopping at the first reply that is not entity data), because rcon-cli cuts the
whole `Inventory` reply at about 110 characters (`...`). Stop them with `kill`. Each line is
`ISO time<TAB>agent<TAB>raw reply`; an inventory sample is the lines with the same time and agent. The parsers expect
`... entity data: [12.5d, 64.0d, -3.2d]` for `Pos` and `... entity data: {Slot: 0b, id: "minecraft:stone", count: 3}`
per inventory line (`Count: 3b` is read too). The per-slot reply shape is the whole-list element form seen in real
replies; check one real reply from your server version before a long run.

## Report

```bash
docker logs --timestamps <paper container> 2>&1 | node tools/progress-metrics/src/cli.ts --paper - \
  --body 'logs/players-host-*.log' --outcomes outcomes.jsonl --positions pos.tsv --inventory inv.tsv --thoughts thoughts.json \
  --window-minutes 60 --csv metrics.csv
```

Markdown goes to stdout; the CSV carries every field (with `--csv` it goes to that file, otherwise after the table).

## Columns

- time to first tool: minutes from the agent's first inventory sample to the first pickaxe.
- deaths per hour: deaths divided by the window length.
- chunks, stuck seconds, escape seconds: from the position samples in the window. A jump over 100 blocks between two
  samples is a teleport and adds no distance. Escape seconds run from the start of the longest stuck stretch to the
  first sample outside that 3x3 area (empty if the agent never left).
- repeated journal share: near-duplicate journal entries over journal entries.
- no_effect share: `no_effect` actions over all actions.
- escape success: ladder rungs that worked over all rungs tried (the ladder stops at the first rung that works).
- episode success: an escape episode starts at a `stall_diag` with reason `stall` and ends at the next one. It
  succeeded if a ladder rung reported `worked: true` in it, or a position sample within 5 minutes is 4 or more blocks
  (horizontal) from the first sample after the stall. Without position samples only the rung evidence counts, so the
  rate is a lower bound. The rungs ratio above is kept as well.

## Exporting Glass thoughts

`/api/thoughts` returns at most 100 per request and a `next` cursor. `tools/progress-metrics/export-glass.ts` pages
it and writes `{"thoughts": [...]}` for `--thoughts`:

```bash
# Glass listens on loopback only: through an SSH tunnel (ssh -L 8787:127.0.0.1:8787 <node>)
node tools/progress-metrics/export-glass.ts --base http://127.0.0.1:8787 --count 1500 --out thoughts.json
# or inside the container, with a Node that can run TypeScript (22.18+):
docker exec -i geldar-colo-glass-1 node --input-type=module-typescript - --out /tmp/thoughts.json < tools/progress-metrics/export-glass.ts
```

`--agent <life id>` limits it to one agent. Journal entries are only part of the thought stream, so a count of 1500 may
hold fewer journal entries than you expect; page further for a longer run.
