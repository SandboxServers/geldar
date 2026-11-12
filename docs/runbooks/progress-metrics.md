# Progress metrics (operator only)

`tools/progress-metrics` turns logs and samples that already exist into per-agent, per-window numbers, so a harness or
model change can be judged on data. It only reads files. It does not write to the world, does not call the agents' MCP
and publishes nothing; keep its output off anything agents or Glass can read.

## Inputs

| Flag | Source | Gives |
| --- | --- | --- |
| `--paper <file or ->` | Paper console log, or `docker logs --timestamps <paper>` on stdin | deaths with cause, joins, leaves, chat counts |
| `--body <file>` (`--agent <id>` if lines carry no agent) | Body or player-host JSON lines | action outcomes by reason, `stall_diag` and the escape-ladder rung that worked, `body_watchdog`, `eat`, `body_restart`, short sessions (`player_down` with `uptime_ms` under 60 s) |
| `--positions <file>` | `sample.sh pos` | distance, distinct 16x16 chunks, longest time in one 3x3 area, time to leave it |
| `--inventory <file>` | `sample.sh inventory` | distinct item types, first-seen time of wooden/stone pickaxe, crafting table, furnace, bed, torch; time to first pickaxe |
| `--thoughts <file>` | Glass `/api/thoughts` JSON export | journal entries, near-duplicate share (normalised equality or Jaccard >= 0.9 against the previous 20), `asleep` entries |

Without a docker timestamp prefix, Paper lines carry only a clock time: pass `--date YYYY-MM-DD` (UTC). Body action
outcome lines are read when the event is `action_result`, `action_end`, `action_outcome` or `action` and has a `reason`
(or `outcome`). Time comes from `ts`/`time`/`at`/`t`, else the docker prefix. `--window-minutes N` cuts the data into
windows; the default is one window over everything.

## Sampling positions and inventory

Run on the node, as the operator, one per kind (read-only `data get`):

```bash
RCON_CMD="docker exec <paper container> rcon-cli" \
  tools/progress-metrics/sample.sh pos 10 /var/tmp/pos.tsv ag_zack_01 ag_amy_02 &
RCON_CMD="docker exec <paper container> rcon-cli" \
  tools/progress-metrics/sample.sh inventory 60 /var/tmp/inv.tsv ag_zack_01 ag_amy_02 &
```

Stop them with `kill`. Each line is `ISO time<TAB>agent<TAB>raw reply`. The parsers expect the reply form
`... entity data: [12.5d, 64.0d, -3.2d]` for `Pos` and `[{Slot: 0b, id: "minecraft:stone", count: 3}, ...]` for
`Inventory` (the older `Count: 3b` order is read too); check a real reply from your server version once before a long run.

## Report

```bash
docker logs --timestamps <paper container> 2>&1 | node tools/progress-metrics/src/cli.ts --paper - \
  --body body.log --positions pos.tsv --inventory inv.tsv --thoughts thoughts.json \
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
