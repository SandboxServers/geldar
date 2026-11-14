import { describe, expect, it } from 'vitest';
import { ACTION_FIELDS } from '../validate/action-shapes.ts';
import { thoughtDecodeSchema } from './decode-schema.ts';

/** One verb's variant in the thought decode schema's action union. */
interface Variant {
  properties: Record<string, { const?: string; maxLength?: number }>;
}

/** The text length cap the decode schema gives one verb's `text` field, or undefined if it has none. */
function textCap(verb: string): number | undefined {
  const schema = thoughtDecodeSchema() as {
    properties: { actions: { items: { oneOf: Variant[] } } };
  };
  const variant = schema.properties.actions.items.oneOf.find(
    (candidate) => candidate.properties.do?.const === verb,
  );
  return variant?.properties.text?.maxLength;
}

describe('thought decode schema: the text cap', () => {
  it.each(['write_sign', 'edit_sign'])('caps the text of %s at 60 characters', (verb) => {
    expect(textCap(verb)).toBe(60);
  });

  it('caps every other text field at 512 characters', () => {
    const others = Object.entries(ACTION_FIELDS)
      .filter(
        ([verb, fields]) =>
          fields.includes('text') && verb !== 'write_sign' && verb !== 'edit_sign',
      )
      .map(([verb]) => verb);
    expect(others).toContain('note');
    for (const verb of others) {
      expect(textCap(verb), verb).toBe(512);
    }
  });
});
