import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSince, rotateLog, sizeOf, tailOf } from './log-files.ts';

const dir = (): string => mkdtempSync(join(tmpdir(), 'adam-logs-'));

describe('tailOf', () => {
  it('returns the last lines of a small log', () => {
    const path = join(dir(), 'body.log');
    writeFileSync(path, 'one\ntwo\nthree\n');
    expect(tailOf(path, 2)).toBe('two\nthree\n');
  });

  it('reads only the end of a large log, and drops a partial first line', () => {
    const path = join(dir(), 'big.log');
    const lines = Array.from({ length: 20_000 }, (_, i) => `line ${i}`);
    writeFileSync(path, `${lines.join('\n')}\n`);
    const tail = tailOf(path, 3, 1024);
    expect(tail).toContain('line 19999');
    expect(tail).not.toContain('line 0\n');
    expect(tail.startsWith('line ')).toBe(true);
    expect(tail.split('\n').every((l) => l === '' || /^line \d+$/.test(l))).toBe(true);
  });

  it('returns an empty string for a missing log', () => {
    expect(tailOf(join(dir(), 'none.log'), 5)).toBe('');
  });
});

describe('readSince', () => {
  it('returns only the text appended after the offset, and where it ends', () => {
    const path = join(dir(), 'body.log');
    writeFileSync(path, 'a\nb\n');
    const first = readSince(path, 0);
    expect(first).toEqual({ text: 'a\nb\n', end: 4 });
    writeFileSync(path, 'a\nb\nc\n');
    expect(readSince(path, first.end)).toEqual({ text: 'c\n', end: 6 });
  });

  it('reads the whole file again when it is shorter than the offset, as after a rotation', () => {
    const path = join(dir(), 'body.log');
    writeFileSync(path, 'fresh\n');
    expect(readSince(path, 500)).toEqual({ text: 'fresh\n', end: 6 });
  });

  it('is empty for a missing log', () => {
    expect(readSince(join(dir(), 'none.log'), 0)).toEqual({ text: '', end: 0 });
    expect(sizeOf(join(dir(), 'none.log'))).toBe(0);
  });
});

describe('rotateLog', () => {
  it('leaves a log at or under the cap in place', () => {
    const path = join(dir(), 'body.log');
    writeFileSync(path, '12345');
    expect(rotateLog(path, 5)).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe('12345');
  });

  it('renames a log over the cap to .1 and starts it empty', () => {
    const path = join(dir(), 'body.log');
    writeFileSync(path, '123456');
    expect(rotateLog(path, 5)).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(`${path}.1`, 'utf8')).toBe('123456');
  });

  it('does nothing for a missing log', () => {
    expect(rotateLog(join(dir(), 'none.log'), 5)).toBe(false);
  });
});
