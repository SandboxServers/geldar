import type { Action } from '@geldar/contract';
import { findVisibleAgent } from '../perception/visible-agent.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** The `give` action as the contract types it. */
type GiveAction = Extract<Action, { do: 'give' }>;

/** The recipient must be this close (blocks) when the items are tossed. */
export const GIVE_REACH = 3;
/** The Body walks up to this close (blocks) to the recipient first. */
const WALK_RANGE = 2;

/** The one text for a recipient the agent cannot see. It never says whether the name exists. */
export const NOT_IN_SIGHT = 'no such agent in sight';

/**
 * Hands items to a nearby agent by tossing them toward it, so it can pick them up (there is no
 * trade window: spec 5.x item transfer). The recipient is resolved only among the players the
 * agent sees now (`findVisibleAgent`), never by a lookup of the name in the server's player list,
 * so the verb cannot probe whether a player exists or where they are (decisions 0058 and 0068).
 * A name that is not in sight fails `not_found` with one fixed text. The Body walks up to
 * `WALK_RANGE` blocks from the recipient, checks again that it is in sight and within
 * `GIVE_REACH`, faces it and tosses. Receipts for economic operations are a later packet.
 */
export const giveAction: ActionHandler<'give'> = {
  kind: 'give',
  timeoutMs: 30_000,
  async run(ctx: ActionContext, action: GiveAction): Promise<ActionOutcome> {
    const { bot } = ctx;
    const first = findVisibleAgent(bot, action.to);
    if (!first) return failed('not_found', NOT_IN_SIGHT);

    const info = bot.registry.itemsByName?.[action.item];
    const held = bot.inventory
      .items()
      .filter((stack) => stack.name === action.item)
      .reduce((sum, stack) => sum + stack.count, 0);
    if (!info || held < action.count) {
      return failed('not_possible', `not holding ${action.count} ${action.item}`);
    }

    if (first.distance > GIVE_REACH) {
      const move = await moveNear(bot, first.position, WALK_RANGE, {
        signal: ctx.signal,
        timeScale: ctx.timeScale,
      });
      if (!move.ok) return outcomeOfMove(move);
    }
    if (ctx.signal.aborted) return cancelled();

    // The agent may have moved or turned out of sight while walking: resolve again, from scratch.
    const target = findVisibleAgent(bot, action.to);
    if (!target) return failed('not_found', NOT_IN_SIGHT);
    if (target.distance > GIVE_REACH) return failed('out_of_reach', 'too far from the agent');

    try {
      await bot.lookAt(target.position.offset(0, target.height * 0.9, 0), true);
      if (ctx.signal.aborted) return cancelled();
      await bot.toss(info.id, null, action.count);
    } catch (error) {
      return failed('interrupted', errorText(error));
    }
    return completed({ to: action.to, item: action.item, count: action.count });
  },
};
