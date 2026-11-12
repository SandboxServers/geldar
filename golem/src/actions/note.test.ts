import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { NOTE_MAX_CHARS, noteAction, sanitizeNote } from './note.ts';

const run = (text: string) =>
  noteAction.run(
    { bot: {} as Bot, signal: new AbortController().signal, timeScale: 1 },
    {
      do: 'note',
      text,
    },
  );

describe('note', () => {
  it('records the text in the detail and changes nothing else', async () => {
    expect(await run('chest by the bed is shared')).toEqual({
      status: 'completed',
      detail: { text: 'chest by the bed is shared' },
    });
  });

  it('strips control characters, folds white space and caps the length', () => {
    expect(sanitizeNote('a\u0000b\u001b[31m\r\n  c d')).toBe('ab[31m cd');
    expect(sanitizeNote('x'.repeat(NOTE_MAX_CHARS + 50))).toHaveLength(NOTE_MAX_CHARS);
  });

  it('fails invalid_args on a note with nothing left after sanitising', async () => {
    expect(await run(' \u0000\n ')).toMatchObject({ status: 'failed', reason: 'invalid_args' });
  });
});
