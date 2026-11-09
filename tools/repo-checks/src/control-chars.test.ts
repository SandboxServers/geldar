import { describe, expect, it } from 'vitest';
import {
  findControlChar,
  type IndexEntry,
  parseCatFileBatch,
  parseIndexEntries,
} from './control-chars.ts';

const bytes = (text: string) => Buffer.from(text, 'latin1');

describe('findControlChar', () => {
  it('passes plain text with LF and TAB', () => {
    expect(findControlChar('a.md', bytes('one\n\ttwo\n'))).toBeNull();
  });

  it('reports a CR with its line', () => {
    expect(findControlChar('a.md', bytes('one\r\ntwo\n'))).toEqual({
      path: 'a.md',
      line: 1,
      byte: 0x0d,
    });
  });

  it('reports a control character such as ESC or BEL on a later line', () => {
    expect(findControlChar('a.ts', bytes('a\nb\nc\u001bd\n'))?.line).toBe(3);
    expect(findControlChar('a.ts', bytes('\u0007'))?.byte).toBe(0x07);
  });

  it('allows CRLF pairs but not a lone CR when crlfPairsOk is set', () => {
    expect(findControlChar('a.md', bytes('one\r\ntwo\r\n'), true)).toBeNull();
    expect(findControlChar('a.md', bytes('one\r\ntwo\rthree\n'), true)).toEqual({
      path: 'a.md',
      line: 2,
      byte: 0x0d,
    });
    expect(findControlChar('a.md', bytes('a\u000c\r\n'), true)?.byte).toBe(0x0c);
    expect(findControlChar('a.md', bytes('end\r'), true)?.byte).toBe(0x0d);
  });

  it('skips binary content (any NUL byte)', () => {
    expect(findControlChar('a.png', bytes('\u0001\u0000\u0002'))).toBeNull();
  });

  it('skips the files .gitattributes marks CRLF', () => {
    expect(findControlChar('run.BAT', bytes('echo\r\n'))).toBeNull();
    expect(findControlChar('run.cmd', bytes('echo\r\n'))).toBeNull();
  });
});

const file = (path: string): IndexEntry => ({ path, gitlink: false });

describe('parseIndexEntries', () => {
  it('reads paths and marks gitlinks by mode 160000', () => {
    const out = '100644 aaa 0\ta.md\u0000160000 bbb 0\tsub\u0000';
    expect(parseIndexEntries(out)).toEqual([
      { path: 'a.md', gitlink: false },
      { path: 'sub', gitlink: true },
    ]);
  });

  it('lists a conflicted path once', () => {
    const out = '100644 aaa 1\ta.md\u0000100644 bbb 2\ta.md\u0000';
    expect(parseIndexEntries(out)).toHaveLength(1);
  });

  it('rejects a path containing a line feed', () => {
    expect(() => parseIndexEntries('100644 aaa 0\ta\nb.md\0')).toThrow('line feed');
  });
});

describe('parseCatFileBatch', () => {
  it('maps each requested path to its blob and skips a missing gitlink', () => {
    const out = Buffer.concat([
      bytes('abc blob 3\nfoo\n'),
      bytes(':sub missing\n'),
      bytes('def blob 4\nb\r\nr\n'),
    ]);
    const entries = [file('a'), { path: 'sub', gitlink: true }, file('b')];
    const files = parseCatFileBatch(entries, out);
    expect(files.get('a')?.toString()).toBe('foo');
    expect(files.has('sub')).toBe(false);
    expect(files.get('b')?.toString()).toBe('b\r\nr');
  });

  it('throws on a missing object that is not a gitlink', () => {
    expect(() => parseCatFileBatch([file('a')], bytes(':a missing\n'))).toThrow('cannot read');
  });

  it('throws on truncated output', () => {
    expect(() => parseCatFileBatch([file('a'), file('b')], bytes('abc blob 1\nx\n'))).toThrow(
      'truncated before b',
    );
    expect(() => parseCatFileBatch([file('a')], bytes('abc blob 9\nxy\n'))).toThrow(
      'truncated inside a',
    );
  });

  it('throws on a non-integer size', () => {
    expect(() => parseCatFileBatch([file('a')], bytes('abc blob x\nfoo\n'))).toThrow('unexpected');
  });

  it('throws on an object type that is not a blob', () => {
    expect(() => parseCatFileBatch([file('a')], bytes('abc tree 3\nfoo\n'))).toThrow('not a blob');
  });
});
