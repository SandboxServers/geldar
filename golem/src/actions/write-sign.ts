import type { Action } from '@geldar/contract';
import { Vec3 } from 'vec3';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { placeAction } from './place.ts';
import type { ActionContext, ActionHandler } from './registry.ts';
import { wrapSignText } from './sign-text.ts';

/** Ticks to wait after placing, so the server has opened the sign for editing. */
const EDIT_DELAY_TICKS = 5;
/** The four horizontal steps, tried in this order for the cell beside the body. */
const SIDES = [new Vec3(1, 0, 0), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(0, 0, -1)];

/** The name of a standing sign item the body holds (`oak_sign`), or null. Hanging signs need a ceiling. */
function heldSign(ctx: ActionContext): string | null {
  const item = ctx.bot.inventory.items().find((it) => /_sign$/.test(it.name));
  return item?.name ?? null;
}

/** The first open cell beside the feet with solid ground under it, or `'feet'` when none is. */
function spotBeside(ctx: ActionContext): { x: number; y: number; z: number } | 'feet' {
  const { bot } = ctx;
  const feet = bot.entity.position.floored();
  for (const side of SIDES) {
    const cell = feet.plus(side);
    const here = bot.blockAt(cell);
    const below = bot.blockAt(cell.offset(0, -1, 0));
    if (
      here?.boundingBox === 'empty' &&
      here.name.endsWith('air') &&
      below?.boundingBox === 'block'
    ) {
      return { x: cell.x, y: cell.y, z: cell.z };
    }
  }
  return 'feet';
}

/**
 * `write_sign(text)`: places a sign the body holds beside it and writes the text on it. The text is
 * cleaned and wrapped to four lines (see `wrapSignText`); a text with nothing left is refused
 * before any sign is placed.
 */
export const writeSignAction: ActionHandler<'write_sign'> = {
  kind: 'write_sign',
  timeoutMs: 40_000,
  async run(ctx, action: Extract<Action, { do: 'write_sign' }>): Promise<ActionOutcome> {
    const lines = wrapSignText(action.text);
    if (lines.length === 0) return failed('invalid_args', 'the sign text is empty');
    const sign = heldSign(ctx);
    if (!sign) return failed('missing_materials', 'no sign in the inventory');

    const placed = await placeAction.run(ctx, { do: 'place', block: sign, at: spotBeside(ctx) });
    if (placed.status !== 'completed') return placed;
    const at = placed.detail.at;
    if (typeof at !== 'object' || at === null || Array.isArray(at)) {
      return failed('internal', 'the placement did not report where the sign is');
    }
    const { x, y, z } = at as { x: number; y: number; z: number };
    if (ctx.signal.aborted) return cancelled();
    await ctx.bot.waitForTicks(EDIT_DELAY_TICKS);
    if (ctx.signal.aborted) return cancelled();

    const block = ctx.bot.blockAt(new Vec3(x, y, z));
    if (!block?.name.endsWith('sign')) {
      return failed('blocked', 'the sign is not there any more');
    }
    try {
      ctx.bot.updateSign(block, lines.join('\n'));
    } catch (error) {
      return failed('internal', errorText(error));
    }
    return completed({ at: { x, y, z }, lines });
  },
};
