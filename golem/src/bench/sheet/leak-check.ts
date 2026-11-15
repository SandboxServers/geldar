/**
 * Leak check for a capture (a chat log, a JSON reply, any text) from a sheet run. A hit means the text
 * shows something a player or the Body's public side must not see: a sheet number as a standalone
 * integer, or the words sheet, roll or experiment (matched case-insensitively at a word start, so
 * `rolled` and `experiments` count).
 */
export const LEAK_WORDS = ['sheet', 'roll', 'experiment'] as const;

/** Sheet values are the 1 to 5 innate scores (contract/schemas/character-sheet.schema.json). */
function checkedNumbers(sheetNumbers: readonly number[]): number[] {
  const unique = [...new Set(sheetNumbers)];
  if (unique.length === 0) throw new Error('leak check needs at least one sheet number');
  for (const n of unique) {
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      throw new Error(`sheet number ${n} is not an integer from 1 to 5`);
    }
  }
  return unique;
}

/**
 * The hits in `text`, as `number:<n>` and `word:<w>` labels, in a fixed order. Empty when clean. A number
 * before it must not be a word character or a dot, and after it must not be a word character or a dot
 * followed by a digit. So `13`, `x3`, `3d20` and `3.5` do not count for `3`, but `I scored a 3.` does.
 */
export function leakHits(text: string, sheetNumbers: readonly number[]): string[] {
  const hits: string[] = [];
  for (const n of checkedNumbers(sheetNumbers)) {
    if (new RegExp(`(?<![\\w.])(?<!\\d\\.)${n}(?!\\w|\\.\\d)`).test(text)) hits.push(`number:${n}`);
  }
  for (const word of LEAK_WORDS) {
    if (new RegExp(`\\b${word}`, 'i').test(text)) hits.push(`word:${word}`);
  }
  return hits;
}
