import type { Action } from '@geldar/contract';
import type { Position } from './bot-types.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, completed, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** A `goto` that ends within this many blocks of where it began did not move the bot. */
const FINISHED_STILL = 0.5;

/** The `goto` action as the contract types it. */
type GotoAction = Extract<Action, { do: 'goto' }>;

/** A goto aim: a block position, or a player to walk up to. */
export type GotoTarget =
  | { kind: 'position'; x: number; y: number; z: number }
  | { kind: 'player'; name: string };

/** Splits a `goto` target into the two forms the handler handles. */
export function targetOf(action: Pick<GotoAction, 'target'>): GotoTarget {
  const { target } = action;
  if (typeof target === 'string') return { kind: 'player', name: target };
  return { kind: 'position', x: target.x, y: target.y, z: target.z };
}

/**
 * Walks the bot to a position or next to a player. This is one approach, not a continuous follow
 * (that is the `follow` program of wave 4). The path search reads loaded chunks, which the Mind's
 * snapshot would not expose: execution may use any world knowledge Mineflayer has, and the
 * authorized-perception rule (5.2) applies to the snapshot, built in wave 4.
 */
export const gotoAction: ActionHandler<'goto'> = {
  kind: 'goto',
  timeoutMs: 120_000,
  async run(ctx: ActionContext, action: GotoAction): Promise<ActionOutcome> {
    const target = targetOf(action);
    let aim: Position;
    let range: number;
    if (target.kind === 'player') {
      const entity = ctx.bot.players[target.name]?.entity;
      // Also covers a player known to the server but outside render distance (no entity loaded).
      if (!entity) return failed('not_found', `no player ${target.name} in view`);
      aim = { x: entity.position.x, y: entity.position.y, z: entity.position.z };
      range = 2;
    } else {
      // Aim at the block center; one block of range is enough to stand next to it.
      aim = { x: target.x + 0.5, y: target.y, z: target.z + 0.5 };
      range = 1;
    }

    const from = ctx.bot.entity.position.clone();
    const move = await moveNear(ctx.bot, aim, range, {
      signal: ctx.signal,
      timeScale: ctx.timeScale,
    });
    if (!move.ok) return outcomeOfMove(move);
    const at = ctx.bot.entity.position;
    // "Finished" without moving while still far from the goal: the unstick reflex counts it as a stall.
    const stalled = at.distanceTo(from) < FINISHED_STILL && move.distance > range + 1;
    return completed({
      position: { x: at.x, y: at.y, z: at.z },
      distance: move.distance,
      ...(stalled ? { stalled: true } : {}),
    });
  },
};
