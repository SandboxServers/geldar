import { type PlanProgressPayload, validatePlanProgressPayload } from '@geldar/contract';
import type { SimEvent } from '@geldar/mcp-mock';
import type { MindEvent } from '@geldar/player-core/src/ports/body.ts';
import type { MindHandler } from './types.ts';

/**
 * The `plan_progress` handler: the Body's counts for a running build plan become one sim event, which the
 * presenter reads as one sentence. A payload the contract refuses gives no event. The event never wakes the
 * agent (`wakeOn` is null). The MindEvent union does not carry plan_progress yet (player-core owns it), so the
 * type is cast here; until it does, no event of this type reaches this handler.
 */
export const planProgressHandler: MindHandler = {
  type: 'plan_progress' as MindEvent['type'],
  map: (event, base) => {
    const payload = (event as unknown as { payload: unknown }).payload;
    if (!validatePlanProgressPayload(payload)) return [];
    return [
      {
        ...base,
        wakeOn: null,
        kind: 'plan_progress',
        plan: planCounts(payload as PlanProgressPayload),
      },
    ];
  },
};

function planCounts(p: PlanProgressPayload): NonNullable<SimEvent['plan']> {
  const counts = { done: p.done, total: p.total, phase: p.phase };
  return p.next_need === undefined
    ? counts
    : { ...counts, nextNeed: { block: p.next_need.block, count: p.next_need.count } };
}
