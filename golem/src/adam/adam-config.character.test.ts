import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STANDARD_SHEET } from '@geldar/psyche';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { repoRoot } from '../config.ts';
import { parsePlayerConfig } from '../players/player-config.ts';
import { parseAdamConfig } from './adam-config.ts';

const SHEET = {
  version: 1,
  attributes: { curiosity: 5, common_sense: 2, cleverness: 4, aggression: 1 },
  alignment: { law: 2, good: 4 },
  op_modes: { explorer: 5, farmer: 2, miner: 3, builder: 4, crafter: 1, warrior: 2, nitwit: 3 },
};

const SHARD = {
  shard: 'phase0',
  tick_rate: 20,
  mind: { agent: { username: 'ag_adam_01', name: 'Adam' } },
  chat: { rate_limit_seconds: 7, max_chars: 111 },
  reflexes: {},
};

function collector(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line) };
}

/** Adam's shard with a character block and a stored sheet under `mind.agent`. */
function withCharacter(character: unknown, sheet?: unknown) {
  const agent = { ...SHARD.mind.agent, ...(sheet === undefined ? {} : { character_sheet: sheet }) };
  return { ...SHARD, character, mind: { agent } };
}

describe('character on the Adam config', () => {
  it('is off with no sheet when the shard file has no character block', () => {
    const character = parseAdamConfig(SHARD, collector().log).character;
    expect(character?.config.mode).toBe('off');
    expect(character?.sheet).toBeNull();
  });

  it('is off with no sheet when character is null', () => {
    const character = parseAdamConfig({ ...SHARD, character: null }, collector().log).character;
    expect(character?.config.mode).toBe('off');
    expect(character?.sheet).toBeNull();
  });

  it('takes the sheet from mind.agent.character_sheet in sheet mode', () => {
    const config = parseAdamConfig(withCharacter({ mode: 'sheet' }, SHEET), collector().log);
    expect(config.character?.sheet).toEqual(SHEET);
    expect(config.character?.source).toBe('config');
  });

  it('gives the standard sheet and logs one line when sheet mode stores none', () => {
    const log = collector();
    const config = parseAdamConfig(withCharacter({ mode: 'sheet' }), log.log);
    expect(config.character?.sheet).toEqual(STANDARD_SHEET);
    expect(log.lines).toEqual(['standard sheet for ag_adam_01']);
  });

  it('off yields no sheet even with a non-standard stored sheet', () => {
    const config = parseAdamConfig(withCharacter({ mode: 'off' }, SHEET), collector().log);
    expect(config.character?.sheet).toBeNull();
  });

  it('refuses a malformed stored sheet and names the life and the field', () => {
    const bad = { ...SHEET, alignment: { law: 0, good: 4 } };
    expect(() => parseAdamConfig(withCharacter({ mode: 'sheet' }, bad), collector().log)).toThrow(
      /ag_adam_01.*alignment\.law/,
    );
  });

  it('tolerates the instinct keys in the block and logs one line each', () => {
    const log = collector();
    const config = parseAdamConfig(withCharacter({ mode: 'off', tom: true, drift: 1 }), log.log);
    expect(config.character?.config.mode).toBe('off');
    expect(log.lines).toHaveLength(2);
  });

  it('refuses an unknown key in the character block', () => {
    expect(() =>
      parseAdamConfig(withCharacter({ mode: 'off', sheet: SHEET }), collector().log),
    ).toThrow('character.sheet: unknown key');
  });
});

describe('the real shard files through both loaders', () => {
  async function shardFile(name: string): Promise<Record<string, unknown>> {
    const text = await readFile(join(repoRoot(), 'shards', name), 'utf8');
    return parse(text) as Record<string, unknown>;
  }

  // phase0 keeps no character block (mode off, no sheet); the Colo is in sheet mode (CHAR-BLOCK), so its
  // Adam takes the standard sheet when the database has none. Off means no sheet at all.
  it.each([
    ['phase0.yaml', 'off'],
    ['colo-mind.yaml', 'sheet'],
  ])('%s is character mode %s; Adam has a sheet only in sheet mode', async (name, mode) => {
    const doc = await shardFile(name);
    const character = parseAdamConfig(doc, collector().log).character;
    expect(character?.config.mode).toBe(mode);
    expect(character?.sheet === null).toBe(mode === 'off');
  });

  it.each([
    ['phase0.yaml', 'off'],
    ['colo-mind.yaml', 'sheet'],
  ])('%s gives every listed player character mode %s', async (name, mode) => {
    const doc = await shardFile(name);
    const players = (doc.sovereign as { players: { player_id: string }[] }).players;
    expect(players.length).toBeGreaterThan(0);
    for (const player of players) {
      const character = parsePlayerConfig(doc, player.player_id, collector().log).character;
      expect(character?.config.mode).toBe(mode);
      expect(character?.sheet === null).toBe(mode === 'off');
    }
  });
});
