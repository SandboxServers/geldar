// The code an out-of-view cell reports to the agent (decision 0424, 2026-11-22 addendum, ruling F12).
// For a cell the agent cannot see, the agent learns one thing: the cell is not as expected. Every
// fine outcome that would tell it more (done_already, changed, blocked, unbreakable, no_tool) reports
// one code. An in-view cell keeps its detailed code. The lane applies this where a code is counted.
import type { CellCode } from './cell-do.ts';

/** The one code an out-of-view cell reports when it is not as expected: the existing `changed`. */
export const OUT_OF_VIEW_CODE: CellCode = 'changed';

/** The fine outcomes an out-of-view cell collapses into OUT_OF_VIEW_CODE. */
const COLLAPSED: ReadonlySet<CellCode> = new Set<CellCode>([
  'done_already',
  'changed',
  'blocked',
  'unbreakable',
  'no_tool',
]);

/**
 * The code a cell reports. `inView` is whether the cell was in the agent's seen view when it ran.
 * Only `false` collapses: an unknown view (`undefined`) keeps the fine code. Other codes pass through.
 */
export function reportedCode(code: CellCode, inView: boolean | undefined): CellCode {
  if (inView !== false || !COLLAPSED.has(code)) return code;
  return OUT_OF_VIEW_CODE;
}
