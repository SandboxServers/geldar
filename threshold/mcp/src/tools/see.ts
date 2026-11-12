import { validateSeeInput } from '@geldar/contract';
import { ImageToolResult } from '@geldar/mcp-mock';
import type { BudgetLedger } from '../ports.ts';
import type { ToolCall } from './look.ts';

/** The caption sent with every picture: fixed here, never taken from the Body's reply. */
export const SEE_CAPTION = 'what you see, from your eyes (an approximation, not a photograph)';

/** The largest picture the tool draws (decision 0156); a larger size is brought down to it. */
export const SEE_MAX = { width: 640, height: 360 } as const;

/** The refusals the Body can give (golem's image reply, decision 0156 VP-2). */
export type SeeDetail =
  | 'renderer_disabled'
  | 'chunks_not_loaded'
  | 'rate_limited'
  | 'busy'
  | 'render_timeout'
  | 'render_failed';

/** Plain words for each refusal; the agent reads these, so they name no observer and no cost. */
export const SEE_REFUSALS: Record<SeeDetail, string> = {
  renderer_disabled: 'Pictures are not available right now. Your text view still works.',
  chunks_not_loaded: 'The ground around your eyes is not loaded yet, so no picture can be drawn.',
  rate_limited: 'Pictures are limited to one every 5 seconds and 30 an hour. Look again shortly.',
  busy: 'A picture is still being drawn. Try again in a moment.',
  render_timeout: 'The picture took too long to draw. Try again in a moment.',
  render_failed: 'The picture could not be drawn. Try again in a moment.',
};

/** What the Body answers for one picture: the PNG as base64, or its refusal. */
export type SeeRead = { png: string } | { error: 'view_unavailable'; detail: string };

/** The codes a `see` call can end with; the world turns each into a tool error with its message. */
export type SeeError = 'invalid_input' | 'session_closed' | 'body_unavailable';

/** Either the picture, or one closed failure. A failure is data here; the world throws it as a ToolError. */
export type SeeOutcome =
  | { picture: ImageToolResult }
  | { error: SeeError }
  | { error: 'view_unavailable'; detail: SeeDetail };

export interface SeeDeps {
  /** The Body's picture for a life at the size named (width and height are optional). */
  see: (lifeId: string, size: { width?: number; height?: number }) => Promise<SeeRead>;
  /** Held only so the free rule is testable: `see` never reserves or refunds credits. */
  budget: BudgetLedger;
  /** False once the session has closed; a closed session refuses without asking the Body. */
  isOpen: () => boolean;
}

/** One optional pixel axis: undefined stays undefined, a finite number is clamped to 1..max, anything else is null. */
function clampAxis(value: unknown, max: number): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(1, Math.round(value)));
}

/** A refusal the Body named that this table knows; any other detail reads as a failed render. */
function detailOf(detail: string): SeeDetail {
  return Object.hasOwn(SEE_REFUSALS, detail) ? (detail as SeeDetail) : 'render_failed';
}

/**
 * `see`: a picture of what the body sees from its eyes. Free (decision 0154, ruling 7); the Body
 * enforces the rate limit, so a refusal is passed on in plain words. Input is an optional width and
 * height in pixels, clamped to SEE_MAX; any other key, or a non-numeric size, is `invalid_input`.
 * Never throws: an unanswering Body is `body_unavailable`, and a closed session is `session_closed`
 * without a call to the Body.
 */
export async function seeTool(deps: SeeDeps, call: ToolCall, input: unknown): Promise<SeeOutcome> {
  if (!deps.isOpen()) return { error: 'session_closed' };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { error: 'invalid_input' };
  }
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'width' && key !== 'height')) return { error: 'invalid_input' };
  const raw = input as { width?: unknown; height?: unknown };
  const width = clampAxis(raw.width, SEE_MAX.width);
  const height = clampAxis(raw.height, SEE_MAX.height);
  if (width === null || height === null) return { error: 'invalid_input' };
  const size: { width?: number; height?: number } = {};
  if (width !== undefined) size.width = width;
  if (height !== undefined) size.height = height;
  if (!validateSeeInput(size).ok) return { error: 'invalid_input' };
  let read: SeeRead;
  try {
    read = await deps.see(call.lifeId, size);
  } catch {
    return { error: 'body_unavailable' };
  }
  if ('error' in read) return { error: 'view_unavailable', detail: detailOf(read.detail) };
  return { picture: new ImageToolResult(read.png, SEE_CAPTION) };
}
