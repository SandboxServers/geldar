import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { findVisibleAgent } from '../perception/visible-agent.ts';
import { STEP_BACK_BELOW, STEP_BACK_TO, stepBackPoint } from './give-spot.ts';
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
/**
 * Wall-clock wait for the recipient to pick the tossed items up, scaled by `timeScale`. A player's
 * toss waits 40 ticks (2 s) before anyone may collect it, then the items must travel to the
 * recipient, so the wait is 5 s, not the 3 s a collection after the toss could take.
 */
export const PICKUP_WAIT_MS = 5_000;
/** How often the wait checks for pickups and for an abort. */
const POLL_MS = 25;
/** Item entities further than this (blocks) from the Body are not the ones it tossed. */
const DROP_RANGE = 8;
/** How close (blocks) the Body walks to a tossed item to take it back. */
const TAKE_BACK_RANGE = 1;
/** How close (blocks) the Body walks to the spot it steps back to. */
const STEP_RANGE = 0.5;

/** The one text for a recipient the agent cannot see. It never says whether the name exists. */
export const NOT_IN_SIGHT = 'no such agent in sight';

/** The item entities one toss created, and the ones picked up since: by the recipient or the Body. */
interface PickupWatch {
  dropped: Set<number>;
  collected: Set<number>;
  taken: Set<number>;
  stop(): void;
}

/**
 * Listens for the item entities a toss creates near the Body, and for pickups of them by the
 * recipient and by the Body itself. It must be started before the toss, so no spawn is missed.
 */
function watchPickup(bot: Bot, to: string): PickupWatch {
  const dropped = new Set<number>();
  const collected = new Set<number>();
  const taken = new Set<number>();
  const onDrop = (entity: Entity): void => {
    if (entity.name !== 'item') return;
    if (entity.position.distanceTo(bot.entity.position) > DROP_RANGE) return;
    dropped.add(entity.id);
  };
  const onCollect = (collector: Entity, item: Entity): void => {
    if (!dropped.has(item.id)) return;
    if (collector.username === to) collected.add(item.id);
    else if (collector === bot.entity) taken.add(item.id);
  };
  bot.on('entitySpawn', onDrop);
  bot.on('itemDrop', onDrop);
  bot.on('playerCollect', onCollect);
  return {
    dropped,
    collected,
    taken,
    stop: () => {
      bot.removeListener('entitySpawn', onDrop);
      bot.removeListener('itemDrop', onDrop);
      bot.removeListener('playerCollect', onCollect);
    },
  };
}

/** Every tossed item has been picked up by the recipient. */
function allPicked(watch: PickupWatch): boolean {
  return watch.dropped.size > 0 && watch.collected.size === watch.dropped.size;
}

/** Waits until `done()` holds, the wait runs out, or the run aborts. */
async function awaitUntil(done: () => boolean, signal: AbortSignal, waitMs: number): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (!signal.aborted && Date.now() < deadline && !done()) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** The distance (blocks) between two points, counting only the x and z axes. */
function horizontalGap(a: Entity['position'], b: Entity['position']): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Steps the Body back to `STEP_BACK_TO` blocks from a recipient closer than `STEP_BACK_BELOW`, so
 * the toss flies past them. A step that fails leaves the Body where it is; the caller checks the
 * distance it ends at.
 */
async function stepBackFrom(
  ctx: ActionContext,
  bot: Bot,
  recipient: Entity['position'],
): Promise<void> {
  const spot = stepBackPoint(bot.entity.position, recipient, STEP_BACK_TO);
  if (!spot) return;
  await moveNear(bot, spot, STEP_RANGE, { signal: ctx.signal, timeScale: ctx.timeScale });
}

/**
 * Walks to each tossed item the recipient did not pick up and waits for the Body to collect it.
 * An item the Body already collected counts as taken back, with no walk. True when the Body took
 * every one back. An abort or a walk that fails leaves them on the ground.
 */
async function takeBack(ctx: ActionContext, bot: Bot, watch: PickupWatch): Promise<boolean> {
  const missing = [...watch.dropped].filter((id) => !watch.collected.has(id));
  const everyTaken = () => missing.every((id) => watch.taken.has(id));
  for (const id of missing) {
    if (watch.taken.has(id)) continue;
    const item = bot.entities[id];
    if (!item) return false;
    const move = await moveNear(bot, item.position, TAKE_BACK_RANGE, {
      signal: ctx.signal,
      timeScale: ctx.timeScale,
    });
    if (!move.ok) return false;
  }
  await awaitUntil(everyTaken, ctx.signal, PICKUP_WAIT_MS * ctx.timeScale);
  return !ctx.signal.aborted && everyTaken();
}

/** The outcome once the toss has run and the wait is over. */
async function settle(
  ctx: ActionContext,
  bot: Bot,
  action: GiveAction,
  watch: PickupWatch,
): Promise<ActionOutcome> {
  const total = watch.dropped.size;
  const picked = watch.collected.size;
  if (total === 0) return failed('interrupted', 'the tossed items were not seen on the ground');
  if (picked === total) return completed({ to: action.to, item: action.item, count: action.count });
  if (picked === 0) {
    const took = await takeBack(ctx, bot, watch);
    if (ctx.signal.aborted) return cancelled();
    if (took)
      return failed('not_possible', `${action.to} did not pick the items up; you took them back`);
    return failed('not_possible', `the items are on the ground near ${action.to}`);
  }
  return failed('not_possible', `${picked} of ${total} were picked up; the rest are on the ground`);
}

/**
 * Hands items to a nearby agent by tossing them toward it, so it can pick them up (there is no
 * trade window: spec 5.x item transfer). The recipient is resolved only among the players the
 * agent sees now (`findVisibleAgent`), never by a lookup of the name in the server's player list,
 * so the verb cannot probe whether a player exists or where they are (decisions 0058 and 0068).
 * A name that is not in sight fails `not_found` with one fixed text. The Body walks up to
 * `WALK_RANGE` blocks from the recipient, checks again that it is in sight and within
 * `GIVE_REACH`, steps back to `STEP_BACK_TO` blocks if the recipient is closer than
 * `STEP_BACK_BELOW` (and fails if it is still that close), faces the recipient at about 0.9 of
 * its height, and tosses. The give completes only when the
 * recipient picks up every tossed item within `PICKUP_WAIT_MS`. When the recipient picks up none,
 * the Body takes the items back and says so; if it cannot, it says where the items are, with no
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
    let target = findVisibleAgent(bot, action.to);
    if (!target) return failed('not_found', NOT_IN_SIGHT);
    if (target.distance > GIVE_REACH) return failed('out_of_reach', 'too far from the agent');

    if (target.distance < STEP_BACK_BELOW) {
      await stepBackFrom(ctx, bot, target.position);
      if (ctx.signal.aborted) return cancelled();
      target = findVisibleAgent(bot, action.to);
      if (!target) return failed('not_found', NOT_IN_SIGHT);
      if (target.distance > GIVE_REACH) return failed('out_of_reach', 'too far from the agent');
      // A toss from this close lands in the Body's own pickup box, so it is not thrown.
      if (horizontalGap(bot.entity.position, target.position) < STEP_BACK_BELOW)
        return failed('not_possible', 'too close to toss, and no room to step back');
    }

    const watch = watchPickup(bot, action.to);
    try {
      // Aim at about the recipient's middle, not its feet, so the toss carries past the Body.
      await bot.lookAt(target.position.offset(0, target.height * 0.9, 0), true);
      if (ctx.signal.aborted) return cancelled();
      await bot.toss(info.id, null, action.count);
      await awaitUntil(() => allPicked(watch), ctx.signal, PICKUP_WAIT_MS * ctx.timeScale);
      if (ctx.signal.aborted) return cancelled();
      return await settle(ctx, bot, action, watch);
    } catch (error) {
      return failed('interrupted', errorText(error));
    } finally {
      watch.stop();
    }
  },
};
