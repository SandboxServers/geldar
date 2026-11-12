import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { repoRoot } from './config.ts';
import { admitLifeOverRcon } from './players/whitelist.ts';
import { houseBodyName, sovereignPlayerNames, whitelistNames } from './whitelist-house-body.ts';

describe('houseBodyName (C2-07k)', () => {
  it('reads the colo shard file name, the one golem-body uses as its life id', () => {
    const shard = parse(readFileSync(join(repoRoot(), 'shards', 'colo-mind.yaml'), 'utf8'));
    expect(houseBodyName(shard)).toBe('ag_colo_01');
  });

  it('refuses a missing name and anything that is not a house life id', () => {
    for (const bad of [null, {}, { mind: {} }, { mind: { agent: { username: 'Steve' } } }]) {
      expect(() => houseBodyName(bad)).toThrow(/house Body life id/);
    }
    expect(() => houseBodyName({ mind: { agent: { username: 'ag_x; op y' } } })).toThrow();
  });

  it('whitelists the house Body and every sovereign player of the colo shard file, nothing more', () => {
    const shard = parse(readFileSync(join(repoRoot(), 'shards', 'colo-mind.yaml'), 'utf8'));
    expect(sovereignPlayerNames(shard)).toEqual(['ag_jason_01', 'ag_clara_01', 'ag_kimberly_01']);
    expect(whitelistNames(shard)).toEqual([
      'ag_colo_01',
      'ag_jason_01',
      'ag_clara_01',
      'ag_kimberly_01',
    ]);
  });

  it('handles no players, duplicates and bad entries', () => {
    const house = { mind: { agent: { username: 'ag_colo_01' } } };
    expect(whitelistNames(house)).toEqual(['ag_colo_01']);
    expect(whitelistNames({ ...house, sovereign: { players: [] } })).toEqual(['ag_colo_01']);
    const dup = { life_id: 'ag_colo_01' };
    expect(whitelistNames({ ...house, sovereign: { players: [dup, dup] } })).toEqual([
      'ag_colo_01',
    ]);
    for (const bad of [{ name: 'x' }, { life_id: 'Steve' }, { life_id: 'ag_x; op y' }, null]) {
      expect(() => whitelistNames({ ...house, sovereign: { players: [bad] } })).toThrow(/life id/);
    }
    expect(() => whitelistNames({ ...house, sovereign: { players: 'x' } })).toThrow(/not a list/);
  });

  it('sends exactly one whitelist add for the name, closes the connection, and is repeatable', async () => {
    const sent: string[] = [];
    let closed = 0;
    const open = async () => ({
      async command(cmd: string) {
        sent.push(cmd);
        return sent.length === 1
          ? 'Added ag_colo_01 to the whitelist'
          : 'Player is already whitelisted';
      },
      async close() {
        closed++;
      },
    });
    await admitLifeOverRcon(open, 'ag_colo_01');
    await admitLifeOverRcon(open, 'ag_colo_01');
    expect(sent).toEqual(['whitelist add ag_colo_01', 'whitelist add ag_colo_01']);
    expect(closed).toBe(2);
  });
});
