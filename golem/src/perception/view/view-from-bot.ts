/**
 * The Body's side of the `view` request (the view-tool packet): the text viewport of a bot from
 * where its body looks, at the grid size the caller named. The rays come from `castViewport`, the
 * words from `describeView`; the answer is capped at the contract's text limit, so a result the
 * contract accepts is always sent.
 */
import type { ViewInput } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { castViewport, viewFromBot } from './viewport.ts';
import { describeView } from './viewport-text.ts';

/** The most characters a view answer carries (mcp-view.schema.json: text maxLength 4000). */
export const VIEW_TEXT_CAP = 4000;

/** The viewport of `bot` as text, at the size asked (an absent axis takes the default). */
export function viewTextFromBot(bot: Bot, size: ViewInput): string {
  const { world, pose } = viewFromBot(bot);
  const text = describeView(castViewport(world, pose, size.cols, size.rows));
  return text.slice(0, VIEW_TEXT_CAP);
}
