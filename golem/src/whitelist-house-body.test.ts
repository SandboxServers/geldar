import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { repoRoot } from './config.ts';
import { admitLifeOverRcon } from './players/whitelist.ts';
import { houseBodyName } from './whitelist-house-body.ts';

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
