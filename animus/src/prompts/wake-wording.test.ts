import { describe, expect, it } from 'vitest';
import { wakeWording } from './wake-wording.ts';

describe('wakeWording', () => {
  it('renders the mind_start, idle and fallback reasons in plain words, not their codes', () => {
    expect(wakeWording('mind_start')).toBe('you had just come into this life');
    expect(wakeWording('idle')).toBe('it had been quiet for a while and you had no plan running');
    expect(wakeWording('fallback')).toBe('it was time to look at things again');
    expect(wakeWording('unexpected_damage')).toBe('you were hurt suddenly');
  });

  it('never returns a code name: no underscore, no raw reason', () => {
    for (const reason of ['mind_start', 'fallback', 'idle', 'unexpected_damage', 'no_plan']) {
      expect(wakeWording(reason)).not.toContain('_');
      expect(wakeWording(reason)).not.toBe(reason);
    }
  });

  it('words a new agent within N blocks with the distance', () => {
    expect(wakeWording('new_agent_within_6')).toBe('someone new came within 6 blocks of you');
  });

  it('reads an unknown reason as a plain change in the world', () => {
    expect(wakeWording('some_future_reason')).toBe('something changed around you');
  });
});
