import { type ViewInput, validateViewInput } from '@geldar/contract';
import type { BudgetLedger } from '../ports.ts';
import type { ToolCall } from './look.ts';

/** The most characters a `view` answer carries (mcp-view.schema.json: text maxLength 4000). */
export const VIEW_TEXT_LIMIT = 4000;
/** The grid size range the schema allows; a size outside it is clamped here, not refused. */
const COLS_RANGE = { min: 1, max: 41 } as const;
const ROWS_RANGE = { min: 1, max: 15 } as const;
const KEYS: ReadonlySet<string> = new Set(['cols', 'rows']);

/** What the Body answers for one view: the viewport as text, or a failure it could not read. */
export type ViewRead = { text: string } | { error: 'unavailable' };

/** The view result: the viewport text (at most VIEW_TEXT_LIMIT characters), or a refusal with one closed code. */
export type ViewResult = { text: string } | { error: ViewError };

export type ViewError = 'invalid_input' | 'session_closed' | 'body_unavailable';

export interface ViewDeps {
  /** The Body's text viewport for a life, from where its body looks, at the grid size named. */
  view: (lifeId: string, size: ViewInput) => Promise<ViewRead>;
  /** Held only so the free rule is testable: `view` never reserves or refunds credits. */
  budget: BudgetLedger;
  /** False once the session has closed; a closed session refuses without asking the Body. */
  isOpen: () => boolean;
}

/** Clamps one optional grid axis into its range; undefined stays undefined, a non-integer or non-number is refused. */
function clampAxis(value: unknown, range: { min: number; max: number }): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/**
 * `view`: the text viewport from where the body looks. Free (decision 0154, ruling 7). The input is
 * an optional `cols` and `rows` (mcp-view.schema.json); a missing or non-numeric axis is kept out,
 * and an out-of-range size is clamped to the schema range. Any other key, or a value that is not
 * a finite number, is `invalid_input`. The answer is cut to VIEW_TEXT_LIMIT characters. Never throws.
 */
export async function viewTool(
  deps: ViewDeps,
  call: ToolCall,
  input: unknown,
): Promise<ViewResult> {
  if (!deps.isOpen()) return { error: 'session_closed' };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { error: 'invalid_input' };
  }
  if (Object.keys(input).some((key) => !KEYS.has(key))) return { error: 'invalid_input' };
  const raw = input as { cols?: unknown; rows?: unknown };
  const cols = clampAxis(raw.cols, COLS_RANGE);
  const rows = clampAxis(raw.rows, ROWS_RANGE);
  if (cols === null || rows === null) return { error: 'invalid_input' };
  const size: Record<string, number> = {};
  if (cols !== undefined) size.cols = cols;
  if (rows !== undefined) size.rows = rows;
  const checked = validateViewInput(size);
  if (!checked.ok) return { error: 'invalid_input' };
  let read: ViewRead;
  try {
    read = await deps.view(call.lifeId, checked.value);
  } catch {
    return { error: 'body_unavailable' };
  }
  if ('error' in read) return { error: 'body_unavailable' };
  return { text: read.text.slice(0, VIEW_TEXT_LIMIT) };
}
