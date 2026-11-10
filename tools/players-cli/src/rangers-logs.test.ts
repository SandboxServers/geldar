import { describe, expect, it } from 'vitest';
import { LOG_CAP_BYTES, type LogFs, rotateLog, TAIL_BYTES, tailLines } from './rangers-logs.ts';

/** An in-memory fs: files map to text (ASCII in these tests, so characters are bytes). Counts bytes read. */
function fakeFs(files: Record<string, string>) {
  const content = new Map(Object.entries(files));
  const log = { bytesRead: 0, renames: [] as string[][] };
  const fs: LogFs = {
    exists: (path) => content.has(path),
    size: (path) => content.get(path)?.length ?? 0,
    read(path, start, length) {
      const text = (content.get(path) ?? '').slice(start, start + length);
      log.bytesRead += text.length;
      return text;
    },
    rename(from, to) {
      log.renames.push([from, to]);
      content.set(to, content.get(from) ?? '');
      content.delete(from);
    },
  };
  return { fs, log, content };
}

const tenMegabytes = (): string => {
  const lines: string[] = [];
  let size = 0;
  for (let n = 0; size < 10 * 1024 * 1024; n++) {
    const line = `line ${n}`;
    lines.push(line);
    size += line.length + 1;
  }
  return `${lines.join('\n')}\n`;
};

describe('tailLines', () => {
  it('returns the last lines of a 10 MB log and reads only the tail', () => {
    const big = tenMegabytes();
    const { fs, log } = fakeFs({ '/run/a.log': big });
    const lines = tailLines(fs, '/run/a.log', 200);
    expect(lines).toHaveLength(200);
    expect(lines.at(-1)).toBe(big.slice(0, -1).split('\n').at(-1));
    expect(log.bytesRead).toBeLessThanOrEqual(TAIL_BYTES);
    expect(log.bytesRead).toBeLessThan(big.length / 100);
  });

  it('drops a partial first line when the read starts mid-line', () => {
    const { fs } = fakeFs({ '/run/a.log': 'aaaa\nbbb\ncc\n' });
    expect(tailLines(fs, '/run/a.log', 10, 10)).toEqual(['bbb', 'cc']);
  });

  it('returns every line of a small log, without a trailing empty line', () => {
    const { fs, log } = fakeFs({ '/run/a.log': 'one\ntwo\n' });
    expect(tailLines(fs, '/run/a.log', 200)).toEqual(['one', 'two']);
    expect(log.bytesRead).toBe(8);
  });

  it('returns no lines for an empty log', () => {
    const { fs } = fakeFs({ '/run/a.log': '' });
    expect(tailLines(fs, '/run/a.log', 200)).toEqual([]);
  });
});

describe('rotateLog', () => {
  it('renames a log over the cap to .1 and leaves no file at the old path', () => {
    const { fs, log, content } = fakeFs({ '/run/a.log': 'x'.repeat(LOG_CAP_BYTES + 1) });
    expect(rotateLog(fs, '/run/a.log')).toBe(true);
    expect(log.renames).toEqual([['/run/a.log', '/run/a.log.1']]);
    expect(content.has('/run/a.log')).toBe(false);
  });

  it('replaces an old .1 so only one old file is kept', () => {
    const { fs, content } = fakeFs({ '/run/a.log': 'new'.repeat(10), '/run/a.log.1': 'old' });
    rotateLog(fs, '/run/a.log', 5);
    expect(content.get('/run/a.log.1')).toBe('new'.repeat(10));
  });

  it('leaves a log at or under the cap, and a missing log, alone', () => {
    const { fs, log } = fakeFs({ '/run/a.log': 'x'.repeat(LOG_CAP_BYTES) });
    expect(rotateLog(fs, '/run/a.log')).toBe(false);
    expect(rotateLog(fs, '/run/missing.log')).toBe(false);
    expect(log.renames).toEqual([]);
  });
});
