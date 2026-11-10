import { describe, expect, it } from 'vitest';
import { markedWords } from '../src/index.ts';

describe('markedWords', () => {
  it('marks the words that tell an agent it is watched, software or in a test', () => {
    expect(markedWords('the observers, a harness and 3 credits')).toEqual([
      'observers',
      'harness',
      'credits',
    ]);
  });

  it('does not mark Minecraft-the-game words that contain a marker', () => {
    const text =
      'Put an Observer block by the Echo Shard, roll the end credits from spectator mode, and buckle a happy ghast harness on.';
    expect(markedWords(text)).toEqual([]);
  });

  it('still marks a marker word next to a Minecraft one', () => {
    expect(markedWords('an Echo Shard, but the observer is a human')).toEqual([
      'observer',
      'human',
    ]);
  });
});
