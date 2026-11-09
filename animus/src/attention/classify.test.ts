import { describe, expect, it } from 'vitest';
import { classifySpeech, type SpeechClass } from './classify.ts';
import { priorityOf, rankOf } from './policy.ts';

const ME = { name: 'Adam', username: 'Adam_B0T' };
const partner = (s: string): boolean => s === 'Eve';

describe('classifySpeech', () => {
  const cases: [string, string, string, SpeechClass][] = [
    ['name opens the line', 'Steve', 'Adam, come here', 'addressed'],
    ['greeting then name', 'Steve', 'hey adam how are you', 'addressed'],
    ['name closes the line', 'Steve', 'where are you, Adam?', 'addressed'],
    ['username as a whole word', 'Steve', '@Adam_B0T give me wood', 'addressed'],
    ['name mid-sentence is a mention', 'Steve', 'I saw Adam at the lake today', 'about_me'],
    ['a longer word is not the name', 'Steve', 'the adamant miner left', 'overheard'],
    ['commitment counterparty', 'Eve', 'I will bring the wood tomorrow', 'about_my_commitments'],
    ['addressed beats counterparty', 'Eve', 'Adam, the wood is ready', 'addressed'],
    ['everything else', 'Steve', 'nice weather', 'overheard'],
  ];
  it.each(cases)('%s', (_label, speaker, text, expected) => {
    expect(classifySpeech(speaker, text, ME, partner)).toBe(expected);
  });
});

describe('policy', () => {
  it('orders the reasons by the spec tiers', () => {
    const order = [
      'reflex_danger',
      'unexpected_damage',
      'action_failed',
      'precondition_failed',
      'directly_addressed',
      'speech_about_my_commitments',
      'limit_reached',
      'goal_completed',
      'no_plan',
      'new_agent_within_16',
      'idle',
      'fallback',
    ];
    const ranks = order.map((r) => rankOf(r) ?? Number.NaN);
    expect(ranks.every((r) => !Number.isNaN(r))).toBe(true);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('maps tiers to the decision priority', () => {
    expect(priorityOf(rankOf('reflex_danger') ?? -1)).toBe(2);
    expect(priorityOf(rankOf('goal_completed') ?? -1)).toBe(1);
    expect(priorityOf(rankOf('idle') ?? -1)).toBe(0);
    expect(rankOf('something_new')).toBeNull();
  });
});
