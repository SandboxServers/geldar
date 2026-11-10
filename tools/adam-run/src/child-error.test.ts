import { describe, expect, it } from 'vitest';
import { stderrTail } from './child-error.ts';

describe('stderrTail: the end of a failed child stderr for an abort reason', () => {
  it('keeps the last 20 lines, joined on one line', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const tail = stderrTail(lines.join('\n'));
    expect(tail.startsWith('line 11 | ')).toBe(true);
    expect(tail.endsWith('line 30')).toBe(true);
    expect(tail).not.toContain('line 10 ');
    expect(tail).not.toContain('\n');
  });

  it('drops blank lines and trailing spaces before counting', () => {
    expect(stderrTail('first  \n\n\nsecond\r\n')).toBe('first | second');
  });

  it('redacts password- and token-like values and keeps the key', () => {
    const tail = stderrTail(
      [
        'POSTGRES_PASSWORD=hunter2-real',
        'rcon password: rcon-secret-9',
        'api_key=abc123def',
        'Authorization: Bearer eyJhbGciOi.payload.sig',
        'adam up: animus.log fatal ENOENT',
      ].join('\n'),
    );
    expect(tail).not.toContain('hunter2-real');
    expect(tail).not.toContain('rcon-secret-9');
    expect(tail).not.toContain('abc123def');
    expect(tail).not.toContain('eyJhbGciOi');
    expect(tail).toContain('POSTGRES_PASSWORD=<redacted>');
    expect(tail).toContain('api_key=<redacted>');
    expect(tail).toContain('fatal ENOENT');
  });

  it('caps the length, keeping the end of the text', () => {
    const tail = stderrTail(`${'x'.repeat(5000)} the-end`);
    expect(tail.length).toBeLessThanOrEqual(1503);
    expect(tail.endsWith('the-end')).toBe(true);
    expect(tail.startsWith('...')).toBe(true);
  });

  it('is empty for empty stderr', () => {
    expect(stderrTail('')).toBe('');
  });
});
