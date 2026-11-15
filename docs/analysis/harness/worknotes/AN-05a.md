# AN-05a worknote: golem loaders for the sheet and the character block

Branch `phase1/an-05-loaders`, from `origin/main`. Scope: golem loaders only. AN-05b (roster and
CLI in `tools/mcp-tokens`) is not in this packet.

## What changed

- `golem/src/character/character-config.ts` (new): `parseCharacterConfig`, `lifeCharacter`,
  `CHARACTER_OFF`. The validator and the standard sheet come from `@geldar/psyche`
  (`normalizeSheet`, `STANDARD_SHEET`, `DEFAULT_THRESHOLDS`).
- `golem/src/adam/adam-config.ts`: `AdamConfig.character?: LifeCharacter`, filled from
  `root.character` and `mind.agent.character_sheet`. `parseAdamConfig` takes an optional log.
- `golem/src/players/player-config.ts`: `parsePlayerConfig` passes `entry.character_sheet` through
  the replacement `mind.agent`, next to `harness` and `model`.
- Tests: `character-config.test.ts`, `adam-config.character.test.ts` (new), and additions to
  `player-config.test.ts`. The real `shards/phase0.yaml` and `shards/colo-mind.yaml` are parsed
  through both loaders; neither file changed.

## Decisions taken where the card is silent

- Defaults inside a present block: `rolls` false, `proficiency.enabled` false, thresholds
  `[10, 30, 70]` (psyche's `DEFAULT_THRESHOLDS`). A block with no `mode` is off.
- Thresholds must strictly ascend (`[10, 10, 70]` is refused).
- The log sink is an optional last parameter. It defaults to `console.log`.
- A sheet with `mode: off` is not validated. Off stays inert.

## Dependency and image

- `golem/package.json` already declares `"@geldar/psyche": "workspace:*"`, the same form as
  `@geldar/contract`. No change was needed.
- `golem/Dockerfile` already has `COPY psyche ./psyche`, and `golem/Dockerfile.dockerignore`
  already has `!psyche`. No image change was needed. The docker build was not run.

## Not done here

- The roster and the CLI (AN-05b).
- The sheet fields in the shard files stay absent; the loaders read them only.
