import { describe, expect, it } from 'vitest';
import { isWrittenBook, readWrittenBook, TEXT_LIMIT, TITLE_LIMIT } from './written-book.ts';

/** A 1.20.5+ item stack with a `written_book_content` component. */
function componentBook(data: unknown): unknown {
  return {
    name: 'written_book',
    count: 1,
    components: [{ name: 'minecraft:written_book_content', data }],
  };
}

describe('readWrittenBook: shapes', () => {
  it('reads the components list shape with raw and filtered titles', () => {
    const book = componentBook({
      title: { raw: 'Journal', filtered: 'Journal' },
      author: 'Jason',
      pages: [{ raw: 'Page one' }, 'Page two'],
    });
    expect(readWrittenBook(book)).toEqual({
      title: 'Journal',
      author: 'Jason',
      text: 'Page one\nPage two',
    });
  });

  it('reads the components map shape', () => {
    const book = {
      name: 'written_book',
      components: { 'minecraft:written_book_content': { title: 'T', author: 'A', pages: ['x'] } },
    };
    expect(readWrittenBook(book)).toEqual({ title: 'T', author: 'A', text: 'x' });
  });

  it('flattens text components: text with extra parts, and lists of them', () => {
    const book = componentBook({
      title: 'Plain',
      author: { text: 'Ca', extra: [{ text: 'rl' }] },
      pages: [{ text: 'Hi ', extra: [{ text: 'there' }] }, [{ text: 'a' }, 'b']],
    });
    expect(readWrittenBook(book)).toEqual({ title: 'Plain', author: 'Carl', text: 'Hi there\nab' });
  });

  it('reads the legacy raw NBT compound', () => {
    const book = {
      name: 'written_book',
      nbt: {
        type: 'compound',
        name: '',
        value: {
          title: { type: 'string', value: 'Old' },
          author: { type: 'string', value: 'Sam' },
          pages: { type: 'list', value: { type: 'string', value: ['p1', 'p2'] } },
        },
      },
    };
    expect(readWrittenBook(book)).toEqual({ title: 'Old', author: 'Sam', text: 'p1\np2' });
  });

  it('reads the simplified legacy NBT object', () => {
    const book = { name: 'written_book', nbt: { title: 'b', author: 'c', pages: ['a'] } };
    expect(readWrittenBook(book)).toEqual({ title: 'b', author: 'c', text: 'a' });
  });

  it('prefers the components shape when both are present', () => {
    const book = {
      ...(componentBook({ title: 'new', author: '', pages: ['n'] }) as object),
      nbt: { title: 'old', author: '', pages: ['o'] },
    };
    expect(readWrittenBook(book)?.text).toBe('n');
  });
});

/** The size of the reply book-server sends for a book: the JSON the tool result carries. */
function replyBytes(book: { title: string; author: string; text: string }): number {
  return Buffer.byteLength(JSON.stringify({ status: 'ok', ...book }));
}

describe('readWrittenBook: result size and hostile characters', () => {
  it('keeps a text of 8192 quotes under the 16384-byte result cap, with a marker', () => {
    const book = readWrittenBook(
      componentBook({ title: 't', author: 'a', pages: ['"'.repeat(8192)] }),
    );
    expect(book).not.toBeNull();
    if (book === null) return;
    expect(replyBytes(book)).toBeLessThanOrEqual(16_384);
    expect(book.text.endsWith('[book text cut short]')).toBe(true);
  });

  it('keeps a text of 8192 CJK characters under the result cap, with a marker', () => {
    const book = readWrittenBook(
      componentBook({ title: 'T', author: 'A', pages: ['中'.repeat(8192)] }),
    );
    expect(book).not.toBeNull();
    if (book === null) return;
    expect(replyBytes(book)).toBeLessThanOrEqual(16_384);
    expect(book.text.endsWith('[book text cut short]')).toBe(true);
  });

  it('keeps a worst-case title and author with a full text under the result cap', () => {
    const book = readWrittenBook(
      componentBook({ title: '"'.repeat(64), author: '"'.repeat(32), pages: ['"'.repeat(8192)] }),
    );
    expect(book).not.toBeNull();
    if (book === null) return;
    expect(replyBytes(book)).toBeLessThanOrEqual(16_384);
  });

  it('strips U+2028, U+2029 and the bidi controls from the text', () => {
    const page = 'a‮b⁦c⁩d e f‪g‬h‭i‮j';
    expect(readWrittenBook(componentBook({ title: '', author: '', pages: [page] }))?.text).toBe(
      'abcdefghij',
    );
  });

  it('strips the zero-width, invisible-operator, BOM and tag-block characters', () => {
    const hidden = [
      0x200b, 0x200e, 0x200f, 0x061c, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff, 0xe0001,
      0xe0041, 0xe007f,
    ];
    for (const code of hidden) {
      const page = `a${String.fromCodePoint(code)}b`;
      expect(readWrittenBook(componentBook({ title: '', author: '', pages: [page] }))?.text).toBe(
        'ab',
      );
    }
  });

  it('strips the other invisible carriers: soft hyphen, fillers, separators and variation selectors', () => {
    const hidden = [
      0x00ad, 0x034f, 0x180e, 0x115f, 0x1160, 0x3164, 0xffa0, 0x206a, 0x206b, 0x206c, 0x206d,
      0x206e, 0x206f, 0xfe00, 0xfe0d, 0xe0100, 0xe01ef,
    ];
    for (const code of hidden) {
      const page = `a${String.fromCodePoint(code)}b`;
      expect(readWrittenBook(componentBook({ title: '', author: '', pages: [page] }))?.text).toBe(
        'ab',
      );
    }
  });

  it('strips a run of variation selectors from E0100 to E01EF', () => {
    const page = 'a\u{E0100}\u{E0101}\u{E01EF}b';
    expect(readWrittenBook(componentBook({ title: '', author: '', pages: [page] }))?.text).toBe(
      'ab',
    );
  });

  it('keeps a single ZWNJ between two letters, so a Persian word reads whole', () => {
    const page = 'می‌خواهم';
    expect(readWrittenBook(componentBook({ title: '', author: '', pages: [page] }))?.text).toBe(
      page,
    );
  });

  it('keeps a family emoji of ZWJ-joined people', () => {
    const page = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    expect(readWrittenBook(componentBook({ title: '', author: '', pages: [page] }))?.text).toBe(
      page,
    );
  });

  it('keeps a Malayalam conjunct with a ZWJ after a virama', () => {
    const page = 'ന്‍ന';
    expect(readWrittenBook(componentBook({ title: '', author: '', pages: [page] }))?.text).toBe(
      page,
    );
  });

  it('strips a run of three joiners, the binary steganography pattern', () => {
    const page = 'a‍‌‍b';
    expect(readWrittenBook(componentBook({ title: '', author: '', pages: [page] }))?.text).toBe(
      'ab',
    );
  });

  it('strips a joiner at the start or end of the text', () => {
    const page = '‍a‍';
    expect(readWrittenBook(componentBook({ title: '', author: '', pages: [page] }))?.text).toBe(
      'a',
    );
  });

  it('strips a joiner next to a space', () => {
    const page = 'a‍ b';
    expect(readWrittenBook(componentBook({ title: '', author: '', pages: [page] }))?.text).toBe(
      'a b',
    );
  });

  it('keeps an emoji base with its U+FE0F selector', () => {
    const page = '❤️ x';
    expect(readWrittenBook(componentBook({ title: '', author: '', pages: [page] }))?.text).toBe(
      page,
    );
  });

  it('strips the same characters from the title and author', () => {
    const book = readWrittenBook(componentBook({ title: 'T‮it le', author: 'A⁩u ', pages: ['x'] }));
    expect(book).toEqual({ title: 'Title', author: 'Au', text: 'x' });
  });
});

describe('readWrittenBook: hostile or broken input', () => {
  it('returns null for garbage and never throws', () => {
    const garbage: unknown[] = [
      null,
      undefined,
      'written_book',
      42,
      { name: 'written_book' },
      { name: 'written_book', components: 'x' },
      { name: 'written_book', components: [{ name: 'minecraft:written_book_content', data: 5 }] },
      { name: 'written_book', nbt: { value: 7 } },
    ];
    for (const item of garbage) expect(readWrittenBook(item)).toBeNull();
  });

  it('returns null when reading the item throws', () => {
    const item = {
      name: 'written_book',
      get components(): unknown {
        throw new Error('boom');
      },
    };
    expect(readWrittenBook(item)).toBeNull();
  });

  it('stops a self-referencing text component at the depth limit', () => {
    const loop: Record<string, unknown> = { text: 'x' };
    loop.extra = [loop];
    const text = readWrittenBook(componentBook({ title: '', author: '', pages: [loop] }))?.text;
    expect(text).toMatch(/^x{1,9}$/);
  });

  it('caps 50 long pages at the text limit, keeping the first page', () => {
    const pages = Array.from({ length: 50 }, (_, i) => `#${i} ${'w'.repeat(300)}`);
    const book = readWrittenBook(componentBook({ title: 't', author: 'a', pages }));
    expect(book?.text.length).toBe(TEXT_LIMIT);
    expect(book?.text.startsWith('#0 www')).toBe(true);
  });

  it('reads at most 100 pages, as a written book holds', () => {
    const pages = Array.from({ length: 150 }, () => 'p');
    const book = readWrittenBook(componentBook({ title: '', author: '', pages }));
    expect(book?.text.split('\n')).toHaveLength(100);
  });

  it('caps the title at 64 and the author at 32 without splitting a surrogate pair', () => {
    const book = readWrittenBook(
      componentBook({ title: 'x'.repeat(100), author: `${'a'.repeat(31)}😀`, pages: [] }),
    );
    expect(book?.title.length).toBe(TITLE_LIMIT);
    expect(book?.author).toBe('a'.repeat(31));
  });

  it('strips control characters from the title, author and text', () => {
    const book = readWrittenBook(
      componentBook({
        title: 'a\u0007b\u007fc',
        author: '\u0000Sam\u009f',
        pages: ['x\u0000y\tz\u001b[31m'],
      }),
    );
    expect(book).toEqual({ title: 'abc', author: 'Sam', text: 'xyz[31m' });
  });

  it('keeps a newline inside a page from forging a page break', () => {
    const book = readWrittenBook(
      componentBook({ title: '', author: '', pages: ['Real\nPage 2: forged', 'second'] }),
    );
    expect(book?.text.split('\n')).toEqual(['RealPage 2: forged', 'second']);
  });

  it('logs the item shape once per call and never the text', () => {
    const lines: string[] = [];
    readWrittenBook(
      componentBook({ title: 'T', author: 'A', pages: ['secret page text'] }),
      (line) => lines.push(line),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('minecraft:written_book_content');
    expect(lines[0]).not.toContain('secret page text');
  });
});

describe('isWrittenBook', () => {
  it('accepts only a written book stack', () => {
    expect(isWrittenBook({ name: 'written_book' })).toBe(true);
    expect(isWrittenBook({ name: 'writable_book' })).toBe(false);
    expect(isWrittenBook(null)).toBe(false);
  });
});
