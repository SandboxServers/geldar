import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The repository's `prompts/` directory (this file is `animus/src/prompts/`). */
const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'prompts');

/** The default agent-facing templates: every file an agent reads as its own text (decisions 0058, 0059). */
const DEFAULT_TEMPLATES = ['thought/v4.md', 'reflection/v2.md', 'body-api/v1.json'];

/** A word that tells the agent it is watched, that it is software, or that it is in a test. */
const MARKER = /observer|watch|human|maker|stream|credit|colo|shard|harness/i;

/**
 * Words that contain a marker and are allowed in agent text, each with the reason. Empty today:
 * add a word here only with a reason an in-world reader would accept.
 */
const ALLOWED: Record<string, string> = {};

function markedWords(text: string): string[] {
  const words = text.match(/[A-Za-z][A-Za-z_-]*/g) ?? [];
  return words.filter((word) => MARKER.test(word) && !(word.toLowerCase() in ALLOWED));
}

describe('default agent-facing templates', () => {
  for (const file of DEFAULT_TEMPLATES) {
    it(`${file} has no observer, harness or out-of-world marker`, () => {
      const text = readFileSync(join(PROMPTS, file), 'utf8');
      expect(markedWords(text), file).toEqual([]);
    });
  }

  it('finds a marker word in text that has one (the scan itself works)', () => {
    expect(markedWords('observers can read it, and the makers')).toEqual(['observers', 'makers']);
  });
});
