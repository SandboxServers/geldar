import { describe, expect, it } from 'vitest';
import { validateRollEventPayload } from '../src/index.ts';

/** A plain d20 check: one die, no advantage. 14 + 1 bonus = 15 against DC 12 succeeds. */
const plain = () => ({
  life_id: 'ag_kestrel_01',
  decision_id: 'dec_gather_wood_0042',
  draw_index: 0,
  engine_version: 1,
  producer: 'body',
  fx: 'gather',
  score: 3,
  dc: 12,
  mode: 'flat',
  dice: [14],
  kept: 14,
  bonus: 1,
  total: 15,
  success: true,
});

describe('roll event payload', () => {
  it('accepts a plain roll', () => {
    expect(validateRollEventPayload(plain()).ok).toBe(true);
  });

  it('accepts an advantage roll that keeps the higher die', () => {
    const adv = { ...plain(), mode: 'adv', dice: [7, 17], kept: 17, bonus: 0, total: 17 };
    expect(validateRollEventPayload(adv).ok).toBe(true);
  });

  it('accepts a disadvantage roll that keeps the lower die', () => {
    const dis = {
      ...plain(),
      mode: 'dis',
      dice: [4, 15],
      kept: 4,
      bonus: 0,
      total: 4,
      success: false,
    };
    expect(validateRollEventPayload(dis).ok).toBe(true);
  });

  it('accepts the bonus bounds, -2 and 5', () => {
    expect(validateRollEventPayload({ ...plain(), bonus: -2 }).ok).toBe(true);
    expect(validateRollEventPayload({ ...plain(), bonus: 5 }).ok).toBe(true);
  });

  it('refuses three dice', () => {
    expect(validateRollEventPayload({ ...plain(), dice: [1, 2, 3] }).ok).toBe(false);
  });

  it('refuses a DC of 1 and accepts the DC bounds 2 and 30', () => {
    expect(validateRollEventPayload({ ...plain(), dc: 1 }).ok).toBe(false);
    expect(validateRollEventPayload({ ...plain(), dc: 2 }).ok).toBe(true);
    expect(validateRollEventPayload({ ...plain(), dc: 30 }).ok).toBe(true);
    expect(validateRollEventPayload({ ...plain(), dc: 31 }).ok).toBe(false);
  });

  it('refuses a bonus of 6', () => {
    expect(validateRollEventPayload({ ...plain(), bonus: 6 }).ok).toBe(false);
  });

  it('refuses a bonus of -3', () => {
    expect(validateRollEventPayload({ ...plain(), bonus: -3 }).ok).toBe(false);
  });

  it('refuses a score outside 1 to 5', () => {
    expect(validateRollEventPayload({ ...plain(), score: 0 }).ok).toBe(false);
    expect(validateRollEventPayload({ ...plain(), score: 6 }).ok).toBe(false);
  });

  it('refuses a proficiency above 3', () => {
    expect(validateRollEventPayload({ ...plain(), proficiency: 4 }).ok).toBe(false);
    expect(validateRollEventPayload({ ...plain(), proficiency: 3 }).ok).toBe(true);
  });

  it('refuses a producer other than body or kit', () => {
    expect(validateRollEventPayload({ ...plain(), producer: 'golem' }).ok).toBe(false);
    expect(validateRollEventPayload({ ...plain(), producer: 'kit' }).ok).toBe(true);
  });

  it('refuses a model_called field, because a roll must not claim later work', () => {
    expect(validateRollEventPayload({ ...plain(), model_called: true }).ok).toBe(false);
  });

  it('refuses a payload missing a required field', () => {
    const { total: _omitted, ...rest } = plain();
    expect(validateRollEventPayload(rest).ok).toBe(false);
  });
});
