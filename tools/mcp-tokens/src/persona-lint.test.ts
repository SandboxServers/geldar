import { describe, expect, it } from 'vitest';
import { personaMarks } from './persona-lint.ts';
import { checkSeed, type Seed } from './players.ts';

const seed = (identity: string, goals = ''): Seed => ({ identity, goals });

describe('persona lint', () => {
  it('refuses a persona that says humans watch the character', () => {
    expect(() => checkSeed(seed('Humans are watching you, so act well.'))).toThrow(
      /watch the character.*--allow-meta/,
    );
    expect(personaMarks('Observers can read what you do every day.')).toEqual(['watched']);
  });

  it('refuses a persona that says the character is an AI, a model or a simulation', () => {
    expect(personaMarks('You are an AI language model.')).toEqual(['software']);
    expect(personaMarks('Nothing here is real: you live in a simulation.')).toEqual(['software']);
  });

  it('refuses a persona that names the harness, shard, colo or credits', () => {
    expect(personaMarks('Your harness gives you 90 credits a day.')).toEqual(['meta']);
    expect(personaMarks('You belong to a colo on the shard east.')).toEqual(['meta']);
  });

  it('lets the persona through with the override, which the CLI warns about', () => {
    const meta = seed('You are an AI living on the shard.');
    expect(() => checkSeed(meta)).toThrow(/--allow-meta/);
    expect(() => checkSeed(meta, true)).not.toThrow();
  });

  it('passes a clean persona, including Minecraft-the-game words', () => {
    const clean = seed(
      'You are Adam, a quiet builder who likes oak trees and the night sky. You watch the sunset from the hill and craft tools.',
      'Put an Observer block by the Echo Shard, roll the end credits from spectator mode, and build a bed.',
    );
    expect(personaMarks(`${clean.identity}\n${clean.goals}`)).toEqual([]);
    expect(() => checkSeed(clean)).not.toThrow();
  });
});
