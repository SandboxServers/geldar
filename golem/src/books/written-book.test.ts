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
