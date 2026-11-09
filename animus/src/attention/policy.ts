/**
 * The attention policy (spec 5.3.2, decision 0047): which wake reasons outrank which, and which are
 * exempt from the minimum spacing. Pure data and functions, so the tests can read the table.
 */
import type { MindWakeReason } from '../ports/index.ts';

/** The reason a candidate carries before it is a decision: the speech class that is not a port reason. */
export type CandidateReason = MindWakeReason | 'speech_about_my_commitments';

/** Priority tiers, most urgent first. A lower tier number wins. */
const TIER_ONE: readonly string[] = [
  'reflex_danger',
  'unexpected_damage',
  'action_failed',
  'precondition_failed',
  'directly_addressed',
  'speech_addressed',
];
const TIER_TWO: readonly string[] = [
  'speech_about_my_commitments',
  'limit_reached',
  'goal_completed',
  'no_plan',
  'mind_start',
  'speech_about_me',
];
const TIER_THREE: readonly string[] = ['idle', 'fallback'];

/** Wakes the 20 s spacing never delays (decision from the orchestrator, Q8). */
const SPACING_EXEMPT: ReadonlySet<string> = new Set(['no_plan', 'mind_start']);

const NEW_AGENT = /^new_agent_within_\d+$/;

/**
 * The rank of a reason: its tier times 100 plus its place in the tier's list. Lower is more urgent.
 * `new_agent_within_N` opens tier three; a reason the policy does not know is `null`.
 */
export function rankOf(reason: string): number | null {
  const one = TIER_ONE.indexOf(reason);
  if (one >= 0) return one;
  const two = TIER_TWO.indexOf(reason);
  if (two >= 0) return 100 + two;
  if (NEW_AGENT.test(reason)) return 200;
  const three = TIER_THREE.indexOf(reason);
  if (three >= 0) return 201 + three;
  return null;
}

/** The `WakeDecision.priority` of a rank: 2 danger or direct address, 1 normal, 0 idle or fallback. */
export function priorityOf(rank: number): 0 | 1 | 2 {
  if (rank < 100) return 2;
  return rank < 200 ? 1 : 0;
}

/** Whether the minimum spacing does not apply to this reason. */
export function isSpacingExempt(reason: string): boolean {
  return SPACING_EXEMPT.has(reason);
}
