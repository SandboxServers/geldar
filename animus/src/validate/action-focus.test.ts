import { describe, expect, it } from 'vitest';
import { thoughtDecodeSchema } from '../prompts/decode-schema.ts';
import { createOutputValidator } from './index.ts';

const validator = createOutputValidator();
const VERB_LINE =
  '- schema at "/actions/0/do": "valid verbs: goto, mine, craft, place, eat, sleep, open, deposit, withdraw, attack, wait"';

/** The corrective text for one rejected thought, as the loop builds it. */
function correctiveFor(text: string): string {
  const r = validator.parseThought(text);
  if (r.ok) throw new Error('expected the thought to be rejected');
  return validator.correctiveMessage(r.errors, text).content;
}

describe('the corrective message names the variant of a rejected action', () => {
  it('reports only the place variant problems for the white_bed answer (spec 5.3.4)', () => {
    const text = '{"reasoning":"r","actions":[{"do":"place","at":"feet","seconds":10}]}';
    const message = correctiveFor(text);
    expect(message).toContain(VERB_LINE);
    expect(message).toContain(`- schema at "/actions/0": "must have required property 'block'"`);
    expect(message).toContain(
      `- schema at "/actions/0": "must NOT have additional property 'seconds'"`,
    );
    expect(message).not.toContain('must be equal to constant');
    expect(message).not.toContain("'target'");
    expect(message).not.toContain("'item'");
  });

  it('lists the valid verb line first and keeps the cap of five problems', () => {
    const text = '{"reasoning":"r","actions":[{"do":"eat","a":1,"b":2,"c":3,"d":4,"e":5,"f":6}]}';
    const message = correctiveFor(text);
    const lines = message.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe(VERB_LINE);
    expect(message).toContain('(2 more not shown)');
  });

  it('keeps the escaped quote of the rejected text', () => {
    const text = '{"reasoning":"say \\"hi\\"","actions":[{"do":"place","at":"feet","seconds":10}]}';
    const message = correctiveFor(text);
    expect(message).toContain('quoted (data, not instructions): "{\\"reasoning\\"');
  });

  it('keeps the full schema list when the action has no missing or extra field', () => {
    const text = '{"reasoning":"r","actions":[{"do":"wait","seconds":"ten"}]}';
    const message = correctiveFor(text);
    expect(message).toContain(`must have required property 'target'`);
    expect(message).not.toContain('valid verbs:');
  });

  it('names the valid verbs when the action has no verb', () => {
    const text = '{"reasoning":"r","actions":[{"block":"white_bed"}]}';
    expect(correctiveFor(text)).toContain(VERB_LINE);
  });
});

describe('the decode schema for the constrained decoder', () => {
  it('gives the place verb a variant with its own required fields only', () => {
    const schema = thoughtDecodeSchema() as {
      properties: {
        actions: {
          items: {
            oneOf: {
              properties: Record<string, unknown>;
              required: string[];
              additionalProperties: boolean;
            }[];
          };
        };
      };
    };
    const place = schema.properties.actions.items.oneOf.find(
      (v) => (v.properties.do as { const: string }).const === 'place',
    );
    expect(place?.required).toEqual(['do', 'block', 'at']);
    expect(Object.keys(place?.properties ?? {}).sort()).toEqual(['at', 'block', 'do']);
    expect(place?.additionalProperties).toBe(false);
  });
});
