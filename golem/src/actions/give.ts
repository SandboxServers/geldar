import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { findVisibleAgent } from '../perception/visible-agent.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** The `give` action as the contract types it. */
type GiveAction = Extract<Action, { do: 'give' }>;
type Entity = Bot['entities'][string];

/** The recipient must be this close (blocks) when the items are tossed. */
export const GIVE_REACH = 3;
/** The Body walks up to this close (blocks) to the recipient first. */
const WALK_RANGE = 2;
/** Wall-clock wait for the recipient to pick the tossed items up, scaled by `timeScale`. */
export const PICKUP_WAIT_MS = 3_000;
/** How often the wait checks for pickups and for an abort. */
const POLL_MS = 25;
/** Item entities further than this (blocks) from the Body are not the ones it tossed. */
const DROP_RANGE = 8;

/** The one text for a recipient the agent cannot see. It never says whether the name exists. */
export const NOT_IN_SIGHT = 'no such agent in sight';

/** The item entities one toss created, and the ones the recipient has picked up since. */
interface PickupWatch {
  dropped: Set<number>;
  collected: Set<number>;
  stop(): void;
}

/**
 * Listens for the item entities a toss creates near the Body, and for the recipient's pickups of
 * them. It must be started before the toss, so no spawn is missed.
 */
function watchPickup(bot: Bot, to: string): PickupWatch {
  const dropped = new Set<number>();
  const collected = new Set<number>();
  const onDrop = (entity: Entity): void => {
    if (entity.name !== 'item') return;
    if (entity.position.distanceTo(bot.entity.position) > DROP_RANGE) return;
    dropped.add(entity.id);
  };
  const onCollect = (collector: Entity, item: Entity): void => {
    if (collector.username === to && dropped.has(item.id)) collected.add(item.id);
  };
  bot.on('entitySpawn', onDrop);
  bot.on('itemDrop', onDrop);
  bot.on('playerCollect', onCollect);
  return {
    dropped,
    collected,
    stop: () => {
      bot.removeListener('entitySpawn', onDrop);
      bot.removeListener('itemDrop', onDrop);
      bot.removeListener('playerCollect', onCollect);
    },
  };
}

/** Waits until every tossed item is picked up, the wait runs out, or the run aborts. */
async function awaitPickup(
  watch: PickupWatch,
  signal: AbortSignal,
  timeScale: number,
): Promise<void> {
  const deadline = Date.now() + PICKUP_WAIT_MS * timeScale;
  const allPicked = () => watch.dropped.size > 0 && watch.collected.size === watch.dropped.size;
  while (!signal.aborted && Date.now() < deadline && !allPicked()) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/**
 * Hands items to a nearby agent by tossing them toward it, so it can pick them up (there is no
 * trade window: spec 5.x item transfer). The recipient is resolved only among the players the
 * agent sees now (`findVisibleAgent`), never by a lookup of the name in the server's player list,
 * so the verb cannot probe whether a player exists or where they are (decisions 0058 and 0068).
 * A name that is not in sight fails `not_found` with one fixed text. The Body walks up to
 * `WALK_RANGE` blocks from the recipient, checks again that it is in sight and within
 * `GIVE_REACH`, faces it and tosses. The give completes only when the recipient picks up every
 * tossed item within `PICKUP_WAIT_MS`; otherwise it fails and says where the items are, with no
 * advice. Receipts for economic operations are a later packet.
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

    const watch = watchPickup(bot, action.to);
    try {
      await bot.lookAt(target.position.offset(0, target.height * 0.9, 0), true);
      if (ctx.signal.aborted) return cancelled();
      await bot.toss(info.id, null, action.count);
      await awaitPickup(watch, ctx.signal, ctx.timeScale);
    } catch (error) {
      return failed('interrupted', errorText(error));
    } finally {
      watch.stop();
    }
    if (ctx.signal.aborted) return cancelled();

    const total = watch.dropped.size;
    const picked = watch.collected.size;
    if (total === 0) return failed('interrupted', 'the tossed items were not seen on the ground');
    if (picked === total)
      return completed({ to: action.to, item: action.item, count: action.count });
    if (picked === 0)
      return failed('not_possible', `the items are on the ground near ${action.to}`);
    return failed(
      'not_possible',
      `${picked} of ${total} were picked up; the rest are on the ground`,
    );
  },
};
