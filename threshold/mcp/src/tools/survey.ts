import { validateToolInput, validateToolResult } from '@geldar/contract';
import type { ToolCall } from './look.ts';

/** The least time between two surveys of one life (as `see`'s rate limit: one every 5 seconds). */
export const SURVEY_INTERVAL_MS = 5_000;

/** The closed failures a `survey` call can end with; the world turns each into a tool error. */
export type SurveyError = 'invalid_input' | 'session_closed' | 'rate_limited' | 'body_unavailable';

/** The survey as the Body answered it: text and truncated, and nothing else (no owner field). */
export interface SurveyRead {
  text: string;
  truncated: boolean;
}

/** Either the survey, or one closed failure. A failure is data here; the world throws it as a ToolError. */
export type SurveyOutcome = { survey: SurveyRead } | { error: SurveyError };

/** One window per life: a survey is admitted when the last admitted one is at least 5 seconds old. */
export interface SurveyLimiter {
  admit: (lifeId: string) => boolean;
}

/** A limiter on the clock `now` (ms). A refused call does not move the window. */
export function createSurveyLimiter(now: () => number): SurveyLimiter {
  const admittedAt = new Map<string, number>();
  return {
    admit(lifeId: string): boolean {
      const at = now();
      const last = admittedAt.get(lifeId);
      if (last !== undefined && at - last < SURVEY_INTERVAL_MS) return false;
      admittedAt.set(lifeId, at);
      return true;
    },
  };
}

export interface SurveyDeps {
  /** The Body's survey of a box for a life; `layers` is passed only when the caller gave one. */
  survey: (lifeId: string, request: { box: unknown; layers?: number }) => Promise<unknown>;
  /** False once the session has closed; a closed session refuses without asking the Body. */
  isOpen: () => boolean;
  /** The per-life window. Its slot is taken when the call is admitted, even if the Body then fails. */
  limiter: SurveyLimiter;
}

/**
 * `survey`: a read of the blocks the body has seen in a box, by height. The input is checked against
 * the contract (a box of two corners and an optional layers count from 1 to 384); anything else is
 * `invalid_input`. Free of credits. A closed session, a bad input and a refused window never reach
 * the Body. A reply the contract does not accept is `body_unavailable`. Never throws.
 */
export async function surveyTool(
  deps: SurveyDeps,
  call: ToolCall,
  input: unknown,
): Promise<SurveyOutcome> {
  if (!deps.isOpen()) return { error: 'session_closed' };
  if (!validateToolInput('survey', input).ok) return { error: 'invalid_input' };
  const request = input as { box: unknown; layers?: number };
  if (!deps.limiter.admit(call.lifeId)) return { error: 'rate_limited' };
  let reply: unknown;
  try {
    reply = await deps.survey(call.lifeId, request);
  } catch {
    return { error: 'body_unavailable' };
  }
  if (!validateToolResult('survey', reply).ok) return { error: 'body_unavailable' };
  const { text, truncated } = reply as SurveyRead;
  return { survey: { text, truncated } };
}
