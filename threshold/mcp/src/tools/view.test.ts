import { describe, expect, it, vi } from 'vitest';
import { BodyUnavailable, type BudgetLedger } from '../ports.ts';
import { VIEW_TEXT_LIMIT, type ViewDeps, type ViewRead, viewTool } from './view.ts';

const CALL = { playerId: 'pl_jason', lifeId: 'ag_jason_01' };

/** View deps whose Body answers `read`, with a budget spy and an open session. */
function deps(read: ViewRead | (() => Promise<ViewRead>), open = true) {
  const reserve = vi.fn(async () => ({ ok: true, remaining: 9 }));
  const refund = vi.fn(async () => 9);
  const balance = vi.fn(async () => 9);
  const budget = { balance, reserve, refund } as unknown as BudgetLedger;
  const view = vi.fn(async (_lifeId: string, _size: unknown) =>
    typeof read === 'function' ? read() : read,
  );
  const d: ViewDeps = { view, budget, isOpen: () => open };
  return { d, view, reserve, refund, balance };
}

describe('view: the text viewport from where the body looks', () => {
  it('accepts a call with the grid size and passes it to the Body', async () => {
    const { d, view } = deps({ text: 'Facing north.' });
    const result = await viewTool(d, CALL, { cols: 21, rows: 9 });
    expect(result).toEqual({ text: 'Facing north.' });
    expect(view).toHaveBeenCalledWith('ag_jason_01', { cols: 21, rows: 9 });
  });

  it('accepts an empty call and sends no size, so the Body uses its default', async () => {
    const { d, view } = deps({ text: 'Facing north.' });
    expect(await viewTool(d, CALL, {})).toEqual({ text: 'Facing north.' });
    expect(view).toHaveBeenCalledWith('ag_jason_01', {});
  });

  it('rejects an extra key and a non-numeric size as invalid_input, and never asks the Body', async () => {
    const { d, view } = deps({ text: 'x' });
    expect(await viewTool(d, CALL, { cols: 21, reach: 1 })).toEqual({ error: 'invalid_input' });
    expect(await viewTool(d, CALL, { rows: 'nine' })).toEqual({ error: 'invalid_input' });
    expect(await viewTool(d, CALL, [])).toEqual({ error: 'invalid_input' });
    expect(view).not.toHaveBeenCalled();
  });

  it('clamps an oversized or undersized grid to the schema range', async () => {
    const { d, view } = deps({ text: 'x' });
    await viewTool(d, CALL, { cols: 500, rows: 0 });
    expect(view).toHaveBeenLastCalledWith('ag_jason_01', { cols: 41, rows: 1 });
    await viewTool(d, CALL, { cols: -4, rows: 99 });
    expect(view).toHaveBeenLastCalledWith('ag_jason_01', { cols: 1, rows: 15 });
  });

  it('is free: the budget is never reserved or refunded by a view', async () => {
    const { d, reserve, refund, balance } = deps({ text: 'x' });
    const before = await d.budget.balance(CALL.lifeId, 0);
    await viewTool(d, CALL, {});
    expect(reserve).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
    expect(await d.budget.balance(CALL.lifeId, 0)).toBe(before);
    expect(balance).toHaveBeenCalledTimes(2);
  });

  it('cuts the answer to VIEW_TEXT_LIMIT characters', async () => {
    const { d } = deps({ text: 'a'.repeat(VIEW_TEXT_LIMIT + 50) });
    const result = await viewTool(d, CALL, {});
    expect(result).toEqual({ text: 'a'.repeat(VIEW_TEXT_LIMIT) });
  });

  it('answers session_closed with no throw and never asks the Body after close', async () => {
    const { d, view } = deps({ text: 'x' }, false);
    await expect(viewTool(d, CALL, {})).resolves.toEqual({ error: 'session_closed' });
    expect(view).not.toHaveBeenCalled();
  });

  it('throws BodyUnavailable when the Body throws, never a result the output schema refuses', async () => {
    const thrown = deps(async () => {
      throw new Error('nats down');
    });
    await expect(viewTool(thrown.d, CALL, {})).rejects.toBeInstanceOf(BodyUnavailable);
  });

  it('throws BodyUnavailable when the Body replies {error:"unavailable"}', async () => {
    const refused = deps({ error: 'unavailable' });
    await expect(viewTool(refused.d, CALL, {})).rejects.toBeInstanceOf(BodyUnavailable);
  });

  it('passes a valid text reply through unchanged, with no error key', async () => {
    const { d } = deps({ text: 'Open ground.' });
    const result = await viewTool(d, CALL, {});
    expect(result).toEqual({ text: 'Open ground.' });
    expect(Object.keys(result)).toEqual(['text']);
  });
});
