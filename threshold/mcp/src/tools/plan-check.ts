import { validateToolInput, validateToolResult } from '@geldar/contract';
import type { ToolCall } from './look.ts';

/**
 * The closed failures a `plan_check` call can end with; the world turns each into a tool error.
 */
export type PlanCheckError = 'invalid_input' | 'session_closed' | 'body_unavailable';

/** The fixed message for each `plan_check` failure (the body's own failure is the caller's message). */
export const PLAN_CHECK_MESSAGES: Record<PlanCheckError, string> = {
  invalid_input: 'plan_check takes a plan of a palette and steps, and no other input.',
  session_closed: 'The session ended, so no plan was checked.',
  body_unavailable: 'Your body is waking. Try again in a moment.',
};

export interface PlanCheckDeps {
  /** The Body's dry run of the request; a throw is `body_unavailable`. */
  check: (lifeId: string, request: { plan: unknown }) => Promise<unknown>;
  /** False once the session has closed; a closed session refuses without asking the Body. */
  isOpen: () => boolean;
}

/** The dry run as the Body states it. Counts only: no coordinates of unseen cells. */
export interface PlanCheckResult {
  cells: number;
  material_needs: Record<string, { need: number; have: number }>;
  unknown_cells: number;
  estimated_ticks: number;
  invalid_steps: { index: number; reason: string }[];
}

/** Either the dry run, or one closed failure. A failure is data here; the world throws it as a ToolError. */
export type PlanCheckOutcome = { check: PlanCheckResult } | { error: PlanCheckError };

/**
 * `plan_check`: forwards a building plan to the life's Body, which dries it against its pack and seen
 * map (the dry run places and breaks nothing). A closed session and a bad input never reach the Body; a
 * Body reply the contract does not accept is `body_unavailable`. Never throws.
 */
export async function planCheckTool(
  deps: PlanCheckDeps,
  call: ToolCall,
  input: unknown,
): Promise<PlanCheckOutcome> {
  if (!deps.isOpen()) return { error: 'session_closed' };
  if (!validateToolInput('plan_check', input).ok) return { error: 'invalid_input' };
  let reply: unknown;
  try {
    reply = await deps.check(call.lifeId, input as { plan: unknown });
  } catch {
    return { error: 'body_unavailable' };
  }
  if (!validateToolResult('plan_check', reply).ok) return { error: 'body_unavailable' };
  return { check: reply as PlanCheckResult };
}
