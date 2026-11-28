# CHAR-BLOCK: the Colo character block on

Owner decision (relayed 2026-11-28): all open decisions at defaults, sheet functionality on for all characters, activation hold lifted. `shards/colo-mind.yaml` now carries, uncommented:

```yaml
character:
  mode: sheet
  rolls: false
  proficiency:
    enabled: false
```

No sheet values are in the file. A life's sheet is adopted from the database (`mind.agent.character_sheet`, or `sovereign.players[].character_sheet`); a life with none takes `STANDARD_SHEET`.

## Findings

### (1) Who reads the file, and when

- The Body reads it once, at process start: `golem/src/adam/main.ts:201` calls `loadAdamConfig()`, which reads `shards/<GELDAR_SHARD>.yaml` (`golem/src/adam/adam-config.ts:129-134`). No watcher or reload exists.
- The file is bind-mounted read-only into the Body container as `/opt/geldar/shards/colo.yaml` (`compose/colo.yml:279`, service `golem-body`). The same mount is in `geldar-mcp` (`:332`), `players-host` (`:602`) and `admin` (`:657`).
- The players host reads it once per player Body at start: `golem/src/players/main.ts:77` calls `parsePlayerConfig`, which builds the same `character` config.
- `deploy/genesis/config-bundle.list:62` lists the file for the config bundle. I did not trace how the CD copies that bundle to the node; the practical rule is that a change takes effect when the Body and players containers restart.
- Consequence: the block is not live-reloaded. Turning it on or off needs a restart of the Colo Bodies.

### (2) What changes in the Body with mode sheet

Mode `sheet` with a NULL or standard sheet (no stored `character_sheet`):

- `golem/src/character/character-config.ts:131-133` returns `{ sheet: STANDARD_SHEET, source: 'standard' }` and logs one line, `standard sheet for <lifeId>`. The Adam loader passes no logger, so the line goes to the container's console (`character-config.ts:26`), not to any agent-visible channel.
- `golem/src/adam/adam-body.ts:215-216`: the threat policy is built only when `source === 'config'`. Standard returns `undefined`, so the legacy reflex runs unchanged.
- `golem/src/adam/adam-body.ts:291-292`: the audit publisher, `recordAdoption`, and the chunk-visit watcher run only for `source === 'config'`. Standard emits no audit event.
- `golem/src/character/proficiency-host.ts:58`: the proficiency cache starts only for `source === 'config'` with `proficiency.enabled`. Standard sends no request.
- `adam-body.ts:229` (`rolls`) is read only inside the config branch.
- Grep of `golem/src` (non-test) finds no other consumer of `env.character`. `ReflexContext.character` is unused (AN-07 worknote).

Result: with a standard sheet, sheet mode changes no Body behaviour and no text an agent reads. The only new output is the console log line above. No owner text approval is needed for the standard path.

Not covered by the standard path: a life with a stored sheet (`source === 'config'`) does change. Its fight-or-flee reflex uses `decideThreat` with the stored aggression (`golem/src/body/reflexes/threat-policy.ts`, `golem/src/character/runtime.ts:40-91`), it emits an adoption audit event, and it starts the chunk-visit evidence watcher. I did not check whether any life in the database has a stored sheet today, so the effect of this step on existing lives is unverified. The owner's decision covers this change.

### (3) Does `character.mode` need the kit 0.2.1 side

- The Body does not read the kit. `golem/src/character/character-config.ts:38` (`KNOWN_KEYS`) validates `mode`, `rolls` and `proficiency` itself. `parseAdamConfig` does not reject unknown top-level keys.
- I could not confirm the kit 0.2.1 side from this worktree: the string `0.2.1` does not appear under `docs/analysis/harness`, and the kit is not in this repo. The brief states it is already on all Minds; that is unverified here.

## Tests

- `golem/src/adam/adam-config.colo-block.test.ts` parses the real `shards/colo-mind.yaml` and asserts `character` equals `{ mode: 'sheet', rolls: false, proficiency: { enabled: false } }`, that the parsed config is sheet mode with rolls and proficiency off, and that the file stores no sheet (source `standard`, `STANDARD_SHEET`).
- `golem/src/adam/adam-config.character.test.ts`: two pinned tests asserted that `colo-mind.yaml` had no block. They now take a mode per file (`phase0.yaml` off, `colo-mind.yaml` sheet).
- Revert check: on the committed state, changing `mode: sheet` to `mode: off` in the file fails all three new tests. The commented-out block also fails the first test (`doc.character` is undefined). The file was restored from a backup and `git diff --stat` came back empty.

## Follow-up

- `rolls: true` and `proficiency.enabled: true` come with the XP writer switch on eventsink. Both are off in this step because the XP and proficiency writers are still off.
