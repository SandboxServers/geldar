import { describe, expect, it } from 'vitest';
import {
  formatStatus,
  listRangers,
  parsePid,
  RANGER_HEAP_MB,
  type Ranger,
  RangerError,
  rangerCommand,
  rangerState,
  selectRangers,
} from './rangers.ts';

const SHARD = `
sovereign:
  allowed: true
  players:
    - { player_id: ag-jason-01, life_id: ag_jason_01, name: Jason }
    - { player_id: ag-test-01, life_id: ag_test_01, name: Test }
`;

const ALL: Ranger[] = [
  { playerId: 'ag-jason-01', lifeId: 'ag_jason_01', name: 'Jason' },
  { playerId: 'ag-test-01', lifeId: 'ag_test_01', name: 'Test' },
];

describe('listRangers', () => {
  it('reads the players in config order', () => {
    expect(listRangers(SHARD)).toEqual(ALL);
  });

  it('refuses a config with no sovereign players list', () => {
    expect(() => listRangers('sovereign:\n  allowed: true\n')).toThrow(RangerError);
  });

  it('refuses an entry without a life id instead of skipping it', () => {
    expect(() =>
      listRangers('sovereign:\n  players:\n    - { player_id: ag-x-01, name: X }\n'),
    ).toThrow(RangerError);
  });
});

describe('selectRangers', () => {
  it('selects every ranger without an id, and one by id', () => {
    expect(selectRangers(ALL, undefined)).toHaveLength(2);
    expect(selectRangers(ALL, 'ag-test-01')).toEqual([ALL[1]]);
  });

  it('refuses an id the shard config does not name', () => {
    expect(() => selectRangers(ALL, 'ag-nobody-01')).toThrow(RangerError);
  });
});

describe('rangerCommand', () => {
  it('caps each ranger process at the heap size and names its player', () => {
    const { args } = rangerCommand('/repo', 'ag-jason-01');
    expect(args).toContain(`--max-old-space-size=${RANGER_HEAP_MB}`);
    expect(args.slice(-2)).toEqual(['--player', 'ag-jason-01']);
    expect(args[1]).toBe('/repo/golem/src/players/main.ts');
  });
});

describe('parsePid and rangerState', () => {
  it('accepts only a positive integer PID', () => {
    expect(parsePid('4242\n')).toBe(4242);
    expect(parsePid('0')).toBeNull();
    expect(parsePid('12abc')).toBeNull();
  });

  it('reports online for a live PID, stale for a dead one, down without a file', () => {
    const alive = (pid: number) => pid === 4242;
    expect(rangerState('4242', alive)).toEqual({ state: 'online', pid: 4242 });
    expect(rangerState('7', alive)).toEqual({ state: 'stale', pid: 7 });
    expect(rangerState(null, alive)).toEqual({ state: 'down', pid: null });
  });
});

describe('formatStatus', () => {
  it('prints down when nothing runs', () => {
    const rows = ALL.map((ranger) => ({ ranger, state: 'down' as const, pid: null, rssMb: null }));
    expect(formatStatus(rows)).toEqual(['down']);
  });

  it('prints the state, PID and RSS of a running ranger', () => {
    const lines = formatStatus([
      { ranger: ALL[0] as Ranger, state: 'online', pid: 99, rssMb: 180 },
      { ranger: ALL[1] as Ranger, state: 'down', pid: null, rssMb: null },
    ]);
    expect(lines).toEqual([
      'ag-jason-01 online pid 99 rss 180 MB (life ag_jason_01)',
      'ag-test-01 down',
    ]);
  });
});
