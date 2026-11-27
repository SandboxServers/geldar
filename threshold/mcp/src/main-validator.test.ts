import { describe, expect, it } from 'vitest';
import type { McpConfig } from './config.ts';
import { buildActValidator } from './main.ts';

/** A config with only the two fields the validator reads; the cast keeps the rest of McpConfig out of the test. */
const configWith = (worldBorderRadius: number) =>
  ({ buildingOn: true, worldBorderRadius }) as unknown as McpConfig;

const goto = (z: number) =>
  JSON.stringify({
    reasoning: 'test',
    say: '',
    actions: [{ do: 'goto', target: { x: 0, y: 64, z } }],
  });

describe('buildActValidator uses the shard world border', () => {
  it('accepts a goto target past the default 1516 reach when the shard border is 9500', () => {
    const validator = buildActValidator(configWith(9500));
    expect(validator.parseThought(goto(-3100)).ok).toBe(true);
    expect(validator.parseThought(goto(-9500)).ok).toBe(true);
  });

  it('still refuses a goto target one block past the shard border with out_of_bounds', () => {
    const result = buildActValidator(configWith(9500)).parseThought(goto(-9600));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('out_of_bounds');
  });
});
