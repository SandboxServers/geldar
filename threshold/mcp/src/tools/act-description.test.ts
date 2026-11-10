/**
 * The act description is the text a player reads for `act`. It must say that intent.limits is required and carry a
 * minimal intent that the contract accepts, so the example cannot drift from the schema.
 */
import { mcpToolSchemas, validateToolInput } from '@geldar/contract';
import { describe, expect, it } from 'vitest';

/** The example is the last thing in the description, after this phrase. */
const EXAMPLE = /Minimal valid intent: (\{.*\})$/;

const description = mcpToolSchemas.act.description;

describe('the act tool description', () => {
  it('states that intent.limits is required, with both fields and their bounds', () => {
    expect(description).toContain('An intent must carry limits');
    expect(description).toContain('max_world_ticks (1 to 240000)');
    expect(description).toContain('max_block_operations (1 to 10000)');
  });

  it('ends with a minimal intent that the contract accepts as act input', () => {
    const match = EXAMPLE.exec(description);
    expect(match, 'the description ends with "Minimal valid intent: {...}"').not.toBeNull();
    const intent = JSON.parse(match?.[1] ?? 'null');
    const result = validateToolInput('act', { reasoning: 'example', intent });
    expect(result.ok, result.ok ? '' : result.errors.join('; ')).toBe(true);
  });

  it('the documented example fails without limits, so the requirement is real', () => {
    const match = EXAMPLE.exec(description);
    const intent = JSON.parse(match?.[1] ?? 'null') as Record<string, unknown>;
    const { limits: _limits, ...withoutLimits } = intent;
    expect(validateToolInput('act', { reasoning: 'example', intent: withoutLimits }).ok).toBe(
      false,
    );
  });

  it('carries no mock, stand-in or observer wording', () => {
    expect(description).not.toMatch(/mock|stand-in|observer/i);
  });
});
