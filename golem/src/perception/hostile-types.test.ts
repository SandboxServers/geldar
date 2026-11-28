import { observationSentence } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { ALWAYS_HOSTILE } from './hostile-types.ts';

/**
 * The always-hostile mobs whose name takes `an` (a vowel letter, decision 0450). Every other mob
 * takes `a`. A new mob must be checked here, so a new name that breaks the article fails the build.
 */
const AN_MOBS: ReadonlySet<string> = new Set(['elder_guardian', 'endermite', 'evoker']);

describe('fight_seen article for the always-hostile mobs (decision 0450)', () => {
  it('every always-hostile mob gets the article its name takes, pinned here', () => {
    for (const mob of ALWAYS_HOSTILE) {
      const article = AN_MOBS.has(mob) ? 'an' : 'a';
      const text = mob.replace(/_/g, ' ');
      expect(observationSentence({ kind: 'fight_seen', target: mob })).toBe(
        `Someone fought ${article} ${text} nearby.`,
      );
    }
  });

  it('every pinned an-mob is in the list', () => {
    for (const mob of AN_MOBS) expect(ALWAYS_HOSTILE.has(mob)).toBe(true);
  });
});
