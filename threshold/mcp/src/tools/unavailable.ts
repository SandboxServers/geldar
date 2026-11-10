import type { SovereignCallPayload } from '@geldar/contract';
import { ToolError } from '@geldar/mcp-mock';
import type { BudgetLedger, CallRecorder } from '../ports.ts';
import type { ToolCall } from './look.ts';

/** The six tools of the contract that the Phase 0 world does not run yet (spec 5.15.3). */
export type NotAvailableTool = Extract<
  SovereignCallPayload['tool'],
  'write_book' | 'define_skill' | 'use_skill' | 'offer' | 'propose' | 'vote'
>;

/** The one message every unavailable tool gives. It names no observer and no audience. */
export const NOT_AVAILABLE_MESSAGE = 'This is not available in this world yet.';

export interface UnavailableDeps {
  recorder: CallRecorder;
  budget: BudgetLedger;
  now: () => number;
}

/**
 * Answers an unavailable tool with the fixed message and records one `sovereign_call` with the
 * `not_available` reason. Nothing is charged, nothing is done in the world.
 */
export async function notAvailableTool(
  deps: UnavailableDeps,
  call: ToolCall,
  tool: NotAvailableTool,
): Promise<never> {
  const started = deps.now();
  const balance = await deps.budget.balance(call.lifeId, started);
  await deps.recorder.record({
    player_id: call.playerId,
    tool,
    outcome: 'rejected',
    accepted: [],
    rejected: [{ index: 0, reason: 'not_available' }],
    credits_charged: 0,
    budget_remaining: Math.max(0, Math.floor(balance)),
    latency_ms: Math.max(0, deps.now() - started),
  });
  throw new ToolError('not_available', NOT_AVAILABLE_MESSAGE);
}
