import { describe, expect, it } from 'vitest';
import { parseStatusLog } from '../src/status-run.ts';

const T0 = Date.parse('2026-11-10T00:00:00.000Z');
const at = (min: number): string => new Date(T0 + min * 60_000).toISOString();

/** One status.log sample line, then harness event lines, as adam-run writes them. */
const sample = (min: number): string => JSON.stringify({ minute: min, at: at(min), alive: {} });
const event = (min: number, name: string): string =>
  JSON.stringify({ minute: min, at: at(min), event: name, detail: '' });

describe('parseStatusLog', () => {
  it('reads a planned restart and a Body kill, with their at times', () => {
    const text = [sample(0), event(10, 'restart_stack'), event(20, 'body_kill'), sample(21)].join(
      '\n',
    );
    const s = parseStatusLog(`${text}\n`);
    expect(s.restarts).toEqual([
      { atMs: T0 + 10 * 60_000, kind: 'planned' },
      { atMs: T0 + 20 * 60_000, kind: 'body' },
    ]);
    expect(s.aborted).toBe(false);
    expect(s.ended).toBe(false);
  });

  it('a run with no harness lines has no restarts', () => {
    expect(parseStatusLog([sample(0), sample(1)].join('\n')).restarts).toEqual([]);
  });

  it('an abort line marks the run aborted; an end line marks it ended', () => {
    expect(parseStatusLog([sample(0), event(5, 'abort')].join('\n'))).toMatchObject({
      aborted: true,
      ended: false,
    });
    expect(parseStatusLog([sample(0), event(5, 'end')].join('\n'))).toMatchObject({
      aborted: false,
      ended: true,
    });
  });

  it('skips a line that does not parse, and an empty text is an empty run', () => {
    const text = `${sample(0)}\n{not json\n${event(3, 'body_kill')}\n`;
    expect(parseStatusLog(text).restarts).toEqual([{ atMs: T0 + 3 * 60_000, kind: 'body' }]);
    expect(parseStatusLog('')).toEqual({ restarts: [], aborted: false, ended: false });
  });

  it('ignores an event name it does not know, even one that is a property name of Object', () => {
    const s = parseStatusLog([event(1, 'constructor'), event(2, 'safe_stop')].join('\n'));
    expect(s).toEqual({ restarts: [], aborted: false, ended: false });
  });
});
