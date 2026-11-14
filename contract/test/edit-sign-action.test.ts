import { describe, expect, it } from 'vitest';
import { validateThought } from '../src/index.ts';

/** An edit of the sign at a block position, the shape the Body receives. */
const EDIT = { do: 'edit_sign', at: { x: 12, y: 64, z: -7 }, text: 'Wheat for sale' };

/** A thought with one action and no intent or say. */
function oneAction(action: unknown): unknown {
  return { reasoning: 'Update the stall sign.', actions: [action] };
}

describe('edit_sign action schema', () => {
  it('accepts an edit of a sign at a block position with new text', () => {
    expect(validateThought(oneAction(EDIT)).ok).toBe(true);
  });

  it('accepts sign text of exactly 60 characters', () => {
    expect(validateThought(oneAction({ ...EDIT, text: 'x'.repeat(60) })).ok).toBe(true);
  });

  it.each([
    ['no position', { do: 'edit_sign', text: 'Wheat' }],
    ['no text', { do: 'edit_sign', at: { x: 12, y: 64, z: -7 } }],
    ['the feet keyword', { ...EDIT, at: 'feet' }],
    ['a partial position', { ...EDIT, at: { x: 12, y: 64 } }],
    ['text of 61 characters', { ...EDIT, text: 'x'.repeat(61) }],
    ['a stray count', { ...EDIT, count: 1 }],
    ['a stray block', { ...EDIT, block: 'oak_sign' }],
  ])('rejects an edit_sign with %s', (_label, action) => {
    expect(validateThought(oneAction(action)).ok).toBe(false);
  });
});
