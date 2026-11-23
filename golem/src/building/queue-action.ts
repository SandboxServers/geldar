import { completed, failed } from '../actions/outcome.ts';
import type { ActionHandler } from '../actions/registry.ts';
import { BUILDING_REFUSAL } from './names.ts';
import type { PlanBody, PlanChunk, PlanQueue, SubmitReply } from './queue.ts';

/** The plan action's fields as the handler reads them (the contract's PlanAction, both variants). */
interface PlanFields {
  op: 'add' | 'replace' | 'cancel';
  plan_id: string;
  palette?: Readonly<Record<string, unknown>>;
  steps?: readonly unknown[];
  origin?: unknown;
  order?: unknown;
  final?: boolean;
  seq?: number;
}

function replyOutcome(reply: SubmitReply) {
  if (reply.kind === 'refused') return failed('not_possible', reply.message);
  if (reply.kind === 'uploading') return completed({ state: 'uploading', next_seq: reply.nextSeq });
  return completed({ state: 'queued', cells: reply.cells, position: reply.position });
}

/**
 * The plan verb handler. Refused with the neutral message while the flag is off. With the flag on
 * and a queue, `add`, `replace` and `cancel` go through the queue. With the flag on and no queue
 * (the lane is not wired yet) it still throws, as the S3a stub did.
 */
export function planHandler(
  enabled: boolean,
  queue: PlanQueue | null = null,
): ActionHandler<'plan'> {
  return {
    kind: 'plan',
    timeoutMs: 30_000,
    run: async (_ctx, action) => {
      if (!enabled) return failed('not_possible', BUILDING_REFUSAL);
      if (queue === null) throw new Error('not_implemented: plan');
      const a = action as unknown as PlanFields;
      if (a.op === 'cancel') {
        const dropped = await queue.cancel(a.plan_id);
        if (dropped === 0 && a.plan_id !== 'all') {
          return failed('not_possible', `no plan ${a.plan_id} to cancel`);
        }
        return completed({ cancelled: dropped });
      }
      const body: PlanBody = {
        palette: a.palette ?? {},
        steps: a.steps ?? [],
        origin: a.origin,
        order: a.order,
      };
      const chunk: PlanChunk = {
        planId: a.plan_id,
        op: a.op,
        final: a.final !== false,
        body,
        ...(a.seq === undefined ? {} : { seq: a.seq }),
      };
      return replyOutcome(await queue.submit(chunk));
    },
  };
}

/** The handler as the registry holds it by default: the flag is off. */
export const planAction = planHandler(false);
