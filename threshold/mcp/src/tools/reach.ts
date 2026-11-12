import { type ReachPosition, validateReachInput } from '@geldar/contract';
import type { BudgetLedger } from '../ports.ts';
import type { ToolCall } from './look.ts';

/** What the Body answers for one reach: the PX-8a outcome, and the steps when it is `walk`. */
export type ReachOutcome = 'in_hand' | 'walk' | 'needs_digging' | 'blocked' | 'unknown';

export interface ReachRead {
  outcome: ReachOutcome;
  steps?: number;
}

/** The reach result: an outcome (`steps` only for `walk`), or a refusal with one closed code. */
export type ReachResult = { outcome: ReachOutcome; steps?: number } | { error: ReachError };

export type ReachError = 'invalid_input' | 'session_closed' | 'body_unavailable';

const OUTCOMES: ReadonlySet<string> = new Set([
  'in_hand',
  'walk',
  'needs_digging',
  'blocked',
  'unknown',
]);

export interface ReachDeps {
  /** The Body's dry run for a life at a position (PX-8a). A hidden and an unknown block both answer `unknown`. */
  reach: (lifeId: string, at: ReachPosition) => Promise<ReachRead>;
  /** Held only so the free rule is testable: `reach` never reserves or refunds credits. */
  budget: BudgetLedger;
  /** False once the session has closed; a closed session refuses without asking the Body. */
  isOpen: () => boolean;
}

/**
 * `reach`: how the Body would reach a block, as a dry run. Free (decision 0154, ruling 7). The
 * input is three integers (mcp-reach.schema.json); a missing or extra key, or a value out of range,
 * is `invalid_input`. A hidden block and an unknown one give the same answer, and only `walk`
 * carries steps (no oracle, decision 0145). Never throws.
 */
export async function reachTool(
  deps: ReachDeps,
  call: ToolCall,
  input: unknown,
): Promise<ReachResult> {
  if (!deps.isOpen()) return { error: 'session_closed' };
  const checked = validateReachInput(input);
  if (!checked.ok) return { error: 'invalid_input' };
  let read: ReachRead;
  try {
    read = await deps.reach(call.lifeId, checked.value);
  } catch {
    return { error: 'body_unavailable' };
  }
  if (!OUTCOMES.has(read.outcome)) return { outcome: 'unknown' };
  if (read.outcome !== 'walk') return { outcome: read.outcome };
  return { outcome: 'walk', steps: Math.max(0, Math.floor(read.steps ?? 0)) };
}
