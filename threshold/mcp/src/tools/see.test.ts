import { validateSeeInput } from '@geldar/contract';
import { describe, expect, it, vi } from 'vitest';
import { BodyUnavailable, type BudgetLedger } from '../ports.ts';
import {
  SEE_CAPTION,
  SEE_MAX,
  SEE_REFUSALS,
  type SeeDeps,
  type SeeDetail,
  type SeeRead,
  seeTool,
} from './see.ts';

const CALL = { playerId: 'pl_jason', lifeId: 'ag_jason_01' };
const PNG = 'iVBORw0KGgo=';

/** See deps whose Body answers `read`, with a budget spy and an open session. */
function deps(read: SeeRead | (() => Promise<SeeRead>), open = true) {
  const reserve = vi.fn(async () => ({ ok: true, remaining: 9 }));
  const refund = vi.fn(async () => 9);
  const balance = vi.fn(async () => 9);
  const budget = { balance, reserve, refund } as unknown as BudgetLedger;
  const see = vi.fn(async (_lifeId: string, _size: unknown) =>
    typeof read === 'function' ? read() : read,
  );
  const d: SeeDeps = { see, budget, isOpen: () => open };
  return { d, see, reserve, refund, balance };
}

describe('see: a picture of what the body sees', () => {
  it('returns the Body picture as an image block with the fixed caption', async () => {
    const { d, see } = deps({ png: PNG });
    const outcome = await seeTool(d, CALL, {});
    expect(outcome).toHaveProperty('picture');
    if (!('picture' in outcome)) return;
    expect(outcome.picture.png).toBe(PNG);
    expect(outcome.picture.caption).toBe(SEE_CAPTION);
    expect(see).toHaveBeenCalledWith('ag_jason_01', {});
  });

  it('passes an in-range size to the Body unchanged', async () => {
    const { d, see } = deps({ png: PNG });
    await seeTool(d, CALL, { width: 320, height: 180 });
    expect(see).toHaveBeenCalledWith('ag_jason_01', { width: 320, height: 180 });
  });

  it('maps every refusal the Body names to a typed view_unavailable, never invalid_output', async () => {
    for (const detail of Object.keys(SEE_REFUSALS) as SeeDetail[]) {
      const { d } = deps({ error: 'view_unavailable', detail });
      const outcome = await seeTool(d, CALL, {});
      expect(outcome).toEqual({ error: 'view_unavailable', detail });
      expect(JSON.stringify(outcome)).not.toContain('invalid_output');
    }
  });

  it('reads an unknown refusal detail as render_failed', async () => {
    const { d } = deps({ error: 'view_unavailable', detail: 'something_new' });
    expect(await seeTool(d, CALL, {})).toEqual({
      error: 'view_unavailable',
      detail: 'render_failed',
    });
  });

  it('answers body_unavailable, without a throw, when the Body is offline', async () => {
    const { d } = deps(async () => {
      throw new BodyUnavailable('no responder');
    });
    await expect(seeTool(d, CALL, {})).resolves.toEqual({ error: 'body_unavailable' });
  });

  it('answers body_unavailable, without a throw, on any other Body failure', async () => {
    const { d } = deps(async () => {
      throw new Error('socket reset');
    });
    await expect(seeTool(d, CALL, {})).resolves.toEqual({ error: 'body_unavailable' });
  });

  it('answers session_closed without a throw and never asks the Body', async () => {
    const { d, see } = deps({ png: PNG }, false);
    await expect(seeTool(d, CALL, {})).resolves.toEqual({ error: 'session_closed' });
    expect(see).not.toHaveBeenCalled();
  });

  it('rejects an extra key, a non-numeric size and a non-object as invalid_input, and never asks the Body', async () => {
    const { d, see } = deps({ png: PNG });
    expect(await seeTool(d, CALL, { width: 10, reach: 1 })).toEqual({ error: 'invalid_input' });
    expect(await seeTool(d, CALL, { height: 'tall' })).toEqual({ error: 'invalid_input' });
    expect(await seeTool(d, CALL, [])).toEqual({ error: 'invalid_input' });
    expect(see).not.toHaveBeenCalled();
  });

  it('clamps an oversized picture to 640 by 360 on each axis', async () => {
    const { d, see } = deps({ png: PNG });
    await seeTool(d, CALL, { width: 5000, height: 5000 });
    expect(see).toHaveBeenLastCalledWith('ag_jason_01', {
      width: SEE_MAX.width,
      height: SEE_MAX.height,
    });
    expect(SEE_MAX).toEqual({ width: 640, height: 360 });
    await seeTool(d, CALL, { width: 641, height: 361 });
    expect(see).toHaveBeenLastCalledWith('ag_jason_01', { width: 640, height: 360 });
  });

  it('clamps a size below 1 up to 1, and rounds a fraction', async () => {
    const { d, see } = deps({ png: PNG });
    await seeTool(d, CALL, { width: 0, height: -7 });
    expect(see).toHaveBeenLastCalledWith('ag_jason_01', { width: 1, height: 1 });
    await seeTool(d, CALL, { width: 320.4, height: 179.6 });
    expect(see).toHaveBeenLastCalledWith('ag_jason_01', { width: 320, height: 180 });
  });

  it('is free: the budget is never reserved or refunded by a picture', async () => {
    const { d, reserve, refund, balance } = deps({ png: PNG });
    const before = await d.budget.balance(CALL.lifeId, 0);
    await seeTool(d, CALL, {});
    expect(reserve).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
    expect(await d.budget.balance(CALL.lifeId, 0)).toBe(before);
    expect(balance).toHaveBeenCalledTimes(2);
  });

  it('the input schema rejects an extra property', () => {
    expect(validateSeeInput({ width: 1, extra: 1 }).ok).toBe(false);
    expect(validateSeeInput({ width: 1, height: 1 }).ok).toBe(true);
  });
});
