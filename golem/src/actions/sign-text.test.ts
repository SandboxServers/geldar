import { describe, expect, it } from 'vitest';
import { cleanSignText, wrapSignText } from './sign-text.ts';

describe('wrapSignText', () => {
  it.each([
    ['exact fit', 'abcdefghijklmno', ['abcdefghijklmno']],
    ['one over', 'abcdefghijklmnop', ['abcdefghijklmno', 'p']],
    ['words wrap whole', 'hello brave new world', ['hello brave new', 'world']],
    ['a long word is cut', 'x'.repeat(31), ['x'.repeat(15), 'x'.repeat(15), 'x']],
    ['empty', '', []],
    ['only whitespace', ' \t\n  ', []],
    [
      'multi-byte counts as one',
      '日本語日本語日本語日本語日本語',
      ['日本語日本語日本語日本語日本語'],
    ],
    [
      'more than four lines is cut',
      'a'.repeat(15).repeat(6),
      ['a'.repeat(15), 'a'.repeat(15), 'a'.repeat(15), 'a'.repeat(15)],
    ],
    ['newlines fold to spaces', 'one\ntwo\n\nthree', ['one two three']],
  ])('%s', (_name, text, lines) => {
    expect(wrapSignText(text)).toEqual(lines);
  });
});

describe('cleanSignText', () => {
  it('removes formatting codes, control characters and invisible marks', () => {
    expect(cleanSignText('§cred§r text\u0000\u0007​‮ end')).toBe('red text end');
    expect(cleanSignText('a b\u0085c')).toBe('a b c');
  });

  it('never leaves a section sign in the wrapped lines', () => {
    for (const line of wrapSignText('§4§lDANGER §kkeep out§')) expect(line).not.toContain('§');
  });
});
