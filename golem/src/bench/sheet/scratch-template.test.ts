import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { repoRoot } from '../../config.ts';
import { parsePlayerConfig } from '../../players/player-config.ts';

describe('bench/sheet/scratch-shard.template.yaml', () => {
  it('loads through parsePlayerConfig as the sheet driver player', async () => {
    const text = await readFile(
      join(repoRoot(), 'bench', 'sheet', 'scratch-shard.template.yaml'),
      'utf8',
    );
    const config = parsePlayerConfig(parse(text), 'ag-sheetdrv-01');
    expect(config.playerId).toBe('ag-sheetdrv-01');
    expect(config.lifeId).toBe('ag_sheetdrv_01');
    expect(config.shard).toBe('scratch-sheet0');
    expect(config.displayName).toBe('SheetSample');
    expect(config.start).toBe('on_demand');
    expect(config.character.config.mode).toBe('sheet');
    expect(config.character.sheet).not.toBeNull();
  });

  it('refuses the Mind placeholder life id as a player', async () => {
    const text = await readFile(
      join(repoRoot(), 'bench', 'sheet', 'scratch-shard.template.yaml'),
      'utf8',
    );
    expect(() => parsePlayerConfig(parse(text), 'ag-sheetmind-01')).toThrow(
      /not in sovereign.players/,
    );
  });
});
