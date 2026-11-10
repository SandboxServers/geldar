import { describe, expect, it } from 'vitest';
import {
  formatPidFile,
  formatStatus,
  listRangers,
  type Presence,
  parsePid,
  parsePidFile,
  parsePresenceRecord,
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
    const current = (pid: number) =>
      formatPidFile({ pid, started: 'start-1', marker: 'players/main.ts --player ag-x' });
    expect(rangerState(current(4242), alive)).toEqual({ state: 'online', pid: 4242 });
    expect(rangerState(current(7), alive)).toEqual({ state: 'stale', pid: 7 });
    expect(rangerState(null, alive)).toEqual({ state: 'down', pid: null });
  });

  it('reads a bare-PID file from before format 2 as old: never online, and the PID is kept', () => {
    const alive = () => true;
    expect(parsePidFile('4242\n')).toEqual({ kind: 'old', pid: 4242 });
    expect(rangerState('4242\n', alive)).toEqual({ state: 'stale', pid: 4242 });
    expect(parsePidFile('not a pid')).toEqual({ kind: 'old', pid: null });
  });

  it('round-trips a format 2 PID file with its start time and marker', () => {
    const record = {
      pid: 99,
      started: '2026-11-10T12:00:00.0000000Z',
      marker: 'players/main.ts --player ag-x',
    };
    expect(parsePidFile(formatPidFile(record))).toEqual({ kind: 'current', record });
  });
});

const AT = '2026-11-10T12:00:00.000Z';
const awake: Presence = { kind: 'record', state: 'awake', desiredBody: 'up', at: AT };
const dim: Presence = { kind: 'record', state: 'dim', desiredBody: 'up', at: AT };
const hibernating: Presence = { kind: 'record', state: 'hibernating', desiredBody: 'down', at: AT };
const unknown: Presence = { kind: 'unknown' };
const JASON = ALL[0] as Ranger;
const TEST = ALL[1] as Ranger;

describe('parsePresenceRecord', () => {
  const record = (overrides: Record<string, unknown>) =>
    JSON.stringify({
      life_id: 'ag_jason_01',
      state: 'hibernating',
      desired_body: 'down',
      at: AT,
      ...overrides,
    });

  it('reads a valid record of the life', () => {
    expect(parsePresenceRecord(record({}), 'ag_jason_01')).toEqual(hibernating);
  });

  it('treats a record of another life, an unknown state, or bad JSON as no record', () => {
    expect(parsePresenceRecord(record({}), 'ag_test_01')).toEqual({ kind: 'none' });
    expect(parsePresenceRecord(record({ state: 'asleep' }), 'ag_jason_01')).toEqual({
      kind: 'none',
    });
    expect(parsePresenceRecord('{not json', 'ag_jason_01')).toEqual({ kind: 'none' });
  });
});

describe('formatStatus', () => {
  it('prints down when no process runs and the bucket holds no record', () => {
    const rows = ALL.map((ranger) => ({
      ranger,
      state: 'down' as const,
      pid: null,
      rssMb: null,
      presence: { kind: 'none' as const },
    }));
    expect(formatStatus(rows)).toEqual(['down']);
  });

  it('keeps the per-ranger lines when NATS cannot be read, even with no process', () => {
    const lines = formatStatus(
      ALL.map((ranger) => ({
        ranger,
        state: 'down' as const,
        pid: null,
        rssMb: null,
        presence: unknown,
      })),
    );
    expect(lines).toEqual([
      'ag-jason-01 down (life ag_jason_01) presence: unknown',
      'ag-test-01 down (life ag_test_01) presence: unknown',
    ]);
  });

  it('prints an awake ranger with its PID, RSS and presence', () => {
    const lines = formatStatus([
      { ranger: JASON, state: 'online', pid: 99, rssMb: 180, presence: awake },
      { ranger: TEST, state: 'down', pid: null, rssMb: null, presence: { kind: 'none' } },
    ]);
    expect(lines).toEqual([
      `ag-jason-01 online pid 99 rss 180 MB (life ag_jason_01) presence: awake, desired body up, at ${AT}`,
      'ag-test-01 down (life ag_test_01) presence: no record',
    ]);
  });

  it('prints a dim ranger as dim, with its process still online', () => {
    const [line] = formatStatus([
      { ranger: JASON, state: 'online', pid: 99, rssMb: 180, presence: dim },
    ]);
    expect(line).toContain('presence: dim, desired body up');
    expect(line).toContain('online pid 99');
  });

  it('prints a hibernating Body as hibernating while its process stays online', () => {
    const [line] = formatStatus([
      { ranger: JASON, state: 'online', pid: 99, rssMb: 180, presence: hibernating },
    ]);
    expect(line).toContain('online pid 99');
    expect(line).toContain('presence: hibernating, desired body down');
  });

  it('prints presence unknown when NATS could not be read, and keeps the process line', () => {
    const [line] = formatStatus([
      { ranger: JASON, state: 'online', pid: 99, rssMb: null, presence: unknown },
    ]);
    expect(line).toBe('ag-jason-01 online pid 99 rss unknown (life ag_jason_01) presence: unknown');
  });

  it('prints a dead process as stale, and a known record even with no process', () => {
    const lines = formatStatus([
      { ranger: JASON, state: 'stale', pid: 7, rssMb: null, presence: awake },
      { ranger: TEST, state: 'down', pid: null, rssMb: null, presence: hibernating },
    ]);
    expect(lines[0]).toContain('stale pid 7 rss unknown');
    expect(lines[1]).toBe(
      `ag-test-01 down (life ag_test_01) presence: hibernating, desired body down, at ${AT}`,
    );
  });
});
