import { describe, expect, it } from 'vitest';
import type { Presence } from './rangers.ts';
import { parseOptions, runRangersCli, USAGE } from './rangers-cli.ts';

const SHARD = `
sovereign:
  players:
    - { player_id: ag-jason-01, life_id: ag_jason_01, name: Jason }
`;

describe('parseOptions', () => {
  it('accepts no option, or --player with an id', () => {
    expect(parseOptions([])).toEqual({ playerId: undefined });
    expect(parseOptions(['--player', 'ag-jason-01'])).toEqual({ playerId: 'ag-jason-01' });
  });

  it('refuses any other flag or a missing id', () => {
    expect(parseOptions(['--player'])).toBeNull();
    expect(parseOptions(['--player', ''])).toBeNull();
    expect(parseOptions(['--follow'])).toBeNull();
  });
});

describe('runRangersCli', () => {
  const noPresence = { readPresence: async () => new Map() };

  it('answers a usage error with exit 2 for an unknown verb', async () => {
    const result = await runRangersCli(['restart'], SHARD, noPresence);
    expect(result.code).toBe(2);
    expect(result.lines).toEqual([USAGE]);
  });

  it('refuses an id the shard config does not name, with exit 2 and no process started', async () => {
    const result = await runRangersCli(['up', '--player', 'ag-nobody-01'], SHARD, noPresence);
    expect(result.code).toBe(2);
    expect(result.lines[0]).toContain("no sovereign player 'ag-nobody-01'");
  });

  it('prints the presence of each life in status, read from the presence source', async () => {
    const readPresence = async (lifeIds: readonly string[]) =>
      new Map<string, Presence>(
        lifeIds.map((id) => [
          id,
          { kind: 'record', state: 'hibernating', desiredBody: 'down', at: '2026-11-10T12:00:00Z' },
        ]),
      );
    const result = await runRangersCli(['status'], SHARD, { readPresence });
    expect(result.code).toBe(0);
    expect(result.lines.join('\n')).toContain('presence: hibernating, desired body down');
  });

  it('prints presence unknown and keeps going when the presence source cannot be read', async () => {
    const result = await runRangersCli(['status'], SHARD, { readPresence: async () => new Map() });
    expect(result.code).toBe(0);
    expect(result.lines.join('\n')).toContain('presence: unknown');
  });
});
