import { describe, expect, it } from 'vitest';
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
  it('answers a usage error with exit 2 for an unknown verb', () => {
    const result = runRangersCli(['restart'], SHARD);
    expect(result.code).toBe(2);
    expect(result.lines).toEqual([USAGE]);
  });

  it('refuses an id the shard config does not name, with exit 2 and no process started', () => {
    const result = runRangersCli(['up', '--player', 'ag-nobody-01'], SHARD);
    expect(result.code).toBe(2);
    expect(result.lines[0]).toContain("no sovereign player 'ag-nobody-01'");
  });
});
