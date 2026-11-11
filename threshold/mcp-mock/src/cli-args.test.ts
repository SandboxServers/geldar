import { describe, expect, it } from 'vitest';
import { parseCliArgs } from './cli-args.ts';

const base = ['--tokens', 't.json', '--scenario', 's.json'];

describe('parseCliArgs', () => {
  it('maps each timing flag and --suppressed-log to its override field', () => {
    const r = parseCliArgs([
      ...base,
      '--day-length-seconds',
      '11',
      '--min-wake-spacing-seconds',
      '22',
      '--intent-run-too-long-seconds',
      '33',
      '--suppressed-log',
      'sup.log',
    ]);
    expect(r).toEqual({
      tokens: 't.json',
      port: 8787,
      host: '127.0.0.1',
      scenario: 's.json',
      overrides: { dayLengthSeconds: 11, minWakeSpacingSeconds: 22, intentRunTooLongSeconds: 33 },
      suppressedLog: 'sup.log',
    });
  });

  it('sets only the flag given', () => {
    const r = parseCliArgs([...base, '--min-wake-spacing-seconds', '0.5']);
    expect(r).toMatchObject({ overrides: { minWakeSpacingSeconds: 0.5 } });
    expect(Object.keys((r as { overrides: object }).overrides)).toEqual(['minWakeSpacingSeconds']);
  });

  it.each([
    ['--day-length-seconds', 'abc'],
    ['--min-wake-spacing-seconds', ''],
    ['--intent-run-too-long-seconds', 'Infinity'],
  ])('refuses %s %j', (flag, value) => {
    expect(parseCliArgs([...base, flag, value])).toEqual({
      code: 2,
      message: `invalid ${flag}`,
    });
  });

  it('refuses the timing flags and --suppressed-log without --scenario', () => {
    const msg = 'the timing flags and --suppressed-log need --scenario';
    expect(parseCliArgs(['--tokens', 't', '--day-length-seconds', '5'])).toEqual({
      code: 2,
      message: msg,
    });
    expect(parseCliArgs(['--tokens', 't', '--suppressed-log', 'x'])).toEqual({
      code: 2,
      message: msg,
    });
  });

  it('refuses a missing --tokens, an unknown flag, a bad port and a blank host', () => {
    expect(parseCliArgs([])).toMatchObject({ code: 2 });
    expect(parseCliArgs(['--tokens', 't', '--nope'])).toMatchObject({ code: 2 });
    expect(parseCliArgs(['--tokens', 't', '--port', '65536'])).toEqual({
      code: 2,
      message: 'invalid --port',
    });
    expect(parseCliArgs(['--tokens', 't', '--host', ' '])).toEqual({
      code: 2,
      message: 'invalid --host',
    });
  });
});
