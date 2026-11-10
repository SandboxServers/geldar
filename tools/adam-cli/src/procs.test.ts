import { describe, expect, it } from 'vitest';
import {
  formatStatus,
  isLifeId,
  latencySql,
  parseLatency,
  parsePid,
  procState,
  SERVICES,
  stopOrder,
} from './procs.ts';

describe('PID files', () => {
  it('parses a PID with a trailing newline and rejects anything else', () => {
    expect(parsePid('4242\n')).toBe(4242);
    for (const bad of ['', '0', '-5', '12abc', '1 2', '99999999999'])
      expect(parsePid(bad)).toBeNull();
  });

  it('is stopped without a file, stale for a dead or unreadable PID, running for a live one', () => {
    expect(procState(null, () => true)).toBe('stopped');
    expect(procState('77\n', () => false)).toBe('stale');
    expect(procState('garbage', () => true)).toBe('stale');
    expect(procState('77\n', (pid) => pid === 77)).toBe('running');
  });
});

describe('start and stop order', () => {
  it('stops in reverse start order with the Body last', () => {
    expect(SERVICES[0]?.name).toBe('body');
    expect(stopOrder().map((s) => s.name)).toEqual(['lantern-local', 'animus', 'body']);
  });
});

describe('status', () => {
  const stopped = SERVICES.map((s) => ({ name: s.name, state: 'stopped' as const, pid: null }));

  it('prints down when nothing runs', () => {
    expect(formatStatus(stopped, 'ag_adam_01', null)).toEqual(['down']);
  });

  it('prints down and names stale PID files', () => {
    const rows = [{ name: 'animus', state: 'stale' as const, pid: null }, ...stopped.slice(2)];
    const lines = formatStatus(rows, 'ag_adam_01', null);
    expect(lines[0]).toBe('down');
    expect(lines[1]).toContain('animus');
  });

  it('prints each process and the last latency when something runs', () => {
    const rows = [{ name: 'body', state: 'running' as const, pid: 10 }, ...stopped.slice(1)];
    expect(formatStatus(rows, 'ag_adam_01', 1830)).toEqual([
      'body: running (pid 10)',
      'animus: stopped',
      'lantern-local: stopped',
      'life: ag_adam_01',
      'last thought latency: 1830 ms',
    ]);
    expect(formatStatus(rows, 'ag_adam_01', null).at(-1)).toBe('last thought latency: unknown');
  });

  it('reads the latency from the single psql line', () => {
    expect(parseLatency('1830\n')).toBe(1830);
    expect(parseLatency('')).toBeNull();
    expect(parseLatency('ERROR: relation does not exist')).toBeNull();
  });

  it('builds the latency SQL only for a life id', () => {
    expect(isLifeId('ag_adam_01')).toBe(true);
    expect(latencySql('ag_adam_01')).toContain("life_id = 'ag_adam_01'");
    expect(() => latencySql("ag_adam_01' OR 1=1 --")).toThrow(/not a life id/);
  });
});
