import type { ReachPosition } from '@geldar/contract';
import { describe, expect, it, vi } from 'vitest';
import type { BudgetLedger } from '../ports.ts';
import { type ReachDeps, type ReachRead, reachTool } from './reach.ts';

const CALL = { playerId: 'pl_jason', lifeId: 'ag_jason_01' };
const GOOD = { x: 5, y: 64, z: -2 };

/** Reach deps whose Body answers `read`, with a budget spy and an open session. */
function deps(read: ReachRead | (() => Promise<ReachRead>), open = true) {
  const reserve = vi.fn(async () => ({ ok: true, remaining: 9 }));
  const refund = vi.fn(async () => 9);
  const balance = vi.fn(async () => 9);
  const budget = { balance, reserve, refund } as unknown as BudgetLedger;
  const reach = vi.fn(async (_lifeId: string, _at: ReachPosition) =>
    typeof read === 'function' ? read() : read,
  );
  const d: ReachDeps = { reach, budget, isOpen: () => open };
  return { d, reach, reserve, refund, balance };
}

describe('reach: a free dry run of how the Body would reach a block', () => {
  it('accepts a call with all three integers and passes the position to the Body', async () => {
    const { d, reach } = deps({ outcome: 'walk', steps: 5 });
    const result = await reachTool(d, CALL, GOOD);
    expect(result).toEqual({ outcome: 'walk', steps: 5 });
    expect(reach).toHaveBeenCalledWith('ag_jason_01', GOOD);
  });

  it('rejects a missing z as invalid_input and never asks the Body', async () => {
    const { d, reach } = deps({ outcome: 'walk', steps: 5 });
    expect(await reachTool(d, CALL, { x: 5, y: 64 })).toEqual({ error: 'invalid_input' });
    expect(reach).not.toHaveBeenCalled();
  });

  it('rejects an extra key and an out-of-range y as invalid_input', async () => {
    const { d, reach } = deps({ outcome: 'walk', steps: 5 });
    expect(await reachTool(d, CALL, { ...GOOD, reach: 1 })).toEqual({ error: 'invalid_input' });
    expect(await reachTool(d, CALL, { x: 0, y: 400, z: 0 })).toEqual({ error: 'invalid_input' });
    expect(await reachTool(d, CALL, { x: 0.5, y: 64, z: 0 })).toEqual({ error: 'invalid_input' });
    expect(reach).not.toHaveBeenCalled();
  });

  it('is free: the budget is never reserved or refunded by a reach', async () => {
    const { d, reserve, refund, balance } = deps({ outcome: 'in_hand' });
    const before = await d.budget.balance(CALL.lifeId, 0);
    await reachTool(d, CALL, GOOD);
    expect(reserve).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
    expect(await d.budget.balance(CALL.lifeId, 0)).toBe(before);
    expect(balance).toHaveBeenCalledTimes(2);
  });

  it('gives a hidden block and an unknown block the same answer, with no steps', async () => {
    const hidden = deps({ outcome: 'unknown' });
    const unseen = deps({ outcome: 'unknown' });
    const a = await reachTool(hidden.d, CALL, { x: 1, y: 64, z: 1 });
    const b = await reachTool(unseen.d, CALL, { x: 900, y: 64, z: 900 });
    expect(a).toEqual({ outcome: 'unknown' });
    expect(b).toEqual(a);
  });

  it('drops steps from every outcome but walk, and maps an unknown outcome to unknown', async () => {
    const inHand = deps({ outcome: 'in_hand', steps: 3 });
    expect(await reachTool(inHand.d, CALL, GOOD)).toEqual({ outcome: 'in_hand' });
    const odd = deps({ outcome: 'teleport' as ReachRead['outcome'] });
    expect(await reachTool(odd.d, CALL, GOOD)).toEqual({ outcome: 'unknown' });
  });

  it('answers session_closed with no throw and never asks the Body after close', async () => {
    const { d, reach } = deps({ outcome: 'walk', steps: 5 }, false);
    await expect(reachTool(d, CALL, GOOD)).resolves.toEqual({ error: 'session_closed' });
    expect(reach).not.toHaveBeenCalled();
  });

  it('answers body_unavailable with no throw when the Body fails', async () => {
    const { d } = deps(async () => {
      throw new Error('nats down');
    });
    await expect(reachTool(d, CALL, GOOD)).resolves.toEqual({ error: 'body_unavailable' });
  });
});
