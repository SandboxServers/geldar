import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markedWords } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { wakeWording } from './wake-wording.ts';

/** The repository's `prompts/` directory (this file is `animus/src/prompts/`). */
const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'prompts');

/** The default agent-facing templates: every file an agent reads as its own text (decisions 0058, 0059). */
const DEFAULT_TEMPLATES = ['thought/v5.md', 'reflection/v2.md', 'body-api/v2.json'];

/** Every wake reason the Body and the Mind can give (ports/attention.ts). */
const WAKE_REASONS = [
  'directly_addressed',
  'precondition_failed',
  'unexpected_damage',
  'goal_completed',
  'reflex_danger',
  'action_failed',
  'limit_reached',
  'no_plan',
  'speech_addressed',
  'speech_about_me',
  'speech_about_my_commitments',
  'idle',
  'fallback',
  'mind_start',
];

describe('default agent-facing templates', () => {
  for (const file of DEFAULT_TEMPLATES) {
    it(`${file} has no observer, harness or out-of-world marker`, () => {
      const text = readFileSync(join(PROMPTS, file), 'utf8');
      expect(markedWords(text), file).toEqual([]);
    });
  }

  it('the wording of every wake reason has no marker word', () => {
    const reasons = [...WAKE_REASONS, 'new_agent_within_4', 'something_new'];
    const texts = reasons.map((reason) => wakeWording(reason));
    expect(texts.flatMap((text) => markedWords(text))).toEqual([]);
  });

  it('finds a marker word in text that has one (the scan itself works)', () => {
    expect(markedWords('observers can read it, and the makers')).toEqual(['observers', 'makers']);
  });
});
