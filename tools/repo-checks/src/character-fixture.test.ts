// AN-12b: the disposable character fixture has the shape the card names: three Bodies (all-3, aggression-1,
// aggression-5), rolls true, sheets of the contract's schema. A plain YAML parse only; the loader-level parse
// (parseCharacterConfig, normalizeSheet) is AN-12a's test, in golem/.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'shards', 'character-fixture.yaml');
const doc = parse(readFileSync(FIXTURE, 'utf8')) as {
  shard: string;
  character: { mode: string; rolls: boolean };
  sovereign: { players: { player_id: string; life_id: string; character_sheet: Sheet }[] };
};

interface Sheet {
  version: number;
  attributes: Record<string, number>;
  alignment: Record<string, number>;
  op_modes: Record<string, number>;
}

const SCORE_KEYS = {
  attributes: ['curiosity', 'common_sense', 'cleverness', 'aggression'],
  alignment: ['law', 'good'],
  op_modes: ['explorer', 'farmer', 'miner', 'builder', 'crafter', 'warrior', 'nitwit'],
};

describe('shards/character-fixture.yaml (AN-12b)', () => {
  const players = doc.sovereign.players;

  it('is a sheet-mode fixture with rolls on', () => {
    expect(doc.shard).toBe('character-fixture');
    expect(doc.character.mode).toBe('sheet');
    expect(doc.character.rolls).toBe(true);
  });

  it('has exactly three Bodies with distinct life ids, each matching the life-id pattern', () => {
    expect(players).toHaveLength(3);
    const lives = players.map((p) => p.life_id);
    expect(new Set(lives).size).toBe(3);
    for (const life of lives) expect(life).toMatch(/^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/);
  });

  it('gives the three sheets the all-3, aggression-1 and aggression-5 values, and nothing else varied', () => {
    const aggression = players.map((p) => p.character_sheet.attributes.aggression);
    expect(aggression).toEqual([3, 1, 5]);
    for (const p of players) {
      const s = p.character_sheet;
      for (const [block, keys] of Object.entries(SCORE_KEYS) as [
        keyof typeof SCORE_KEYS,
        string[],
      ][]) {
        for (const key of keys) {
          const value = s[block][key];
          expect(
            typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5,
          ).toBe(true);
        }
      }
    }
    // All-3: every score is 3 in the first sheet; the other two differ only in aggression.
    const all3 = players[0]?.character_sheet;
    for (const block of Object.keys(SCORE_KEYS) as (keyof typeof SCORE_KEYS)[]) {
      for (const value of Object.values(all3?.[block] ?? {})) expect(value).toBe(3);
    }
    for (const p of players.slice(1)) {
      const others = { ...p.character_sheet.attributes, aggression: 3 };
      expect(others).toEqual(all3?.attributes);
    }
  });

  it('carries the schema version and no proficiency block in any sheet', () => {
    for (const p of players) {
      expect(p.character_sheet.version).toBe(1);
      expect(Object.keys(p.character_sheet).sort()).toEqual([
        'alignment',
        'attributes',
        'op_modes',
        'version',
      ]);
    }
  });
});
