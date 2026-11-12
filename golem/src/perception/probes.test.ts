import { readdirSync } from 'node:fs';
import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { composeProbes, type Probe } from './compose-probes.ts';
import { FakeWorld } from './perception.fakes.ts';
import { SELF_PROBES, selfProbes } from './self/index.ts';
import { SURROUNDINGS_PROBES, surroundingsProbes } from './surroundings/index.ts';

const bot = {} as unknown as Bot;

/** The probe files in a folder, without `index.ts` and the tests beside them. */
function probeFiles(folder: URL): string[] {
  return readdirSync(folder)
    .filter((name) => name.endsWith('.ts') && name !== 'index.ts' && !name.endsWith('.test.ts'))
    .sort();
}

describe('probe registries', () => {
  it('registers every self probe file, and no file is left out', () => {
    const registered = SELF_PROBES.map((entry) => `${entry.file}.ts`).sort();
    expect(probeFiles(new URL('./self/', import.meta.url))).toEqual(registered);
  });

  it('registers every surroundings probe file, and no file is left out', () => {
    const registered = SURROUNDINGS_PROBES.map((entry) => `${entry.file}.ts`).sort();
    expect(probeFiles(new URL('./surroundings/', import.meta.url))).toEqual(registered);
  });

  it('gives the stub probes their current values, and the sky probe reads the world', () => {
    // Open air with sky above and no time: no ground in 32 cells (perched), no sun phase.
    expect(selfProbes(new FakeWorld().bot)).toEqual({
      armor: 0,
      ground_below: 32,
      trapped: 'perched',
    });
    expect(surroundingsProbes(bot)).toEqual({});
  });
});

describe('composeProbes', () => {
  const first: Probe<Snapshot['self']> = { file: 'first', probe: () => ({ armor: 1 }) };
  const second: Probe<Snapshot['self']> = {
    file: 'second',
    probe: () => ({ armor: 2, hunger: 3 }),
  };

  it('merges in list order, so a later probe wins a shared key', () => {
    expect(composeProbes([first, second], bot)).toEqual({ armor: 2, hunger: 3 });
    expect(composeProbes([second, first], bot)).toEqual({ armor: 1, hunger: 3 });
  });

  it('keeps keys in the order they first appear in the list', () => {
    // second is listed first, so armor (its first key) comes before hunger; first then overwrites armor.
    const merged = composeProbes([second, first], bot);
    expect(Object.keys(merged)).toEqual(['armor', 'hunger']);
  });

  it('adds the field of an injected probe without editing the registry', () => {
    const extra: Probe<Snapshot['self']> = {
      file: 'injected',
      probe: () => ({ unlocked_recipes: ['injected'] }),
    };
    expect(composeProbes([...SELF_PROBES, extra], new FakeWorld().bot)).toEqual({
      armor: 0,
      ground_below: 32,
      trapped: 'perched',
      unlocked_recipes: ['injected'],
    });
  });

  it('adds the field of an injected surroundings probe', () => {
    const extra: Probe<Snapshot['surroundings']> = {
      file: 'injected',
      probe: () => ({ blocks_summary: 'lava nearby' }),
    };
    expect(composeProbes([...SURROUNDINGS_PROBES, extra], bot)).toEqual({
      blocks_summary: 'lava nearby',
    });
  });
});
