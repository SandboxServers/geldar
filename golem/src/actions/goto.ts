import type { Action } from '@geldar/contract';
import { findVisibleAgent } from '../perception/visible-agent.ts';
import type { Position } from './bot-types.ts';
import { NOT_IN_SIGHT } from './give.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, completed, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext, ActionHandler } from './registry.ts';
import { reportStall } from './stall-diag.ts';

/** A `goto` that ends within this many blocks of where it began did not move the bot. */
const FINISHED_STILL = 0.5;

/** The failure text when a walk stopped short of an unreachable goal. Facts only, no coordinates. */
const BLOCKED_TEXT = 'the way was blocked; you got as close as you could';

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
      // Only an agent the character sees now; a name that is far, hidden or unknown fails alike (0058, 0145).
      const agent = findVisibleAgent(ctx.bot, target.name);
      if (!agent) return failed('not_found', NOT_IN_SIGHT);
      aim = { x: agent.position.x, y: agent.position.y, z: agent.position.z };
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
    if (stalled) reportStall(ctx.bot, { reason: 'goto_stalled' });
    const position = { x: at.x, y: at.y, z: at.z };
    const note = move.message ? { note: move.message } : {};
    // Far from the goal when the walk settled: the way was blocked. A partial walk is the closest
    // reachable spot to an unreachable goal; an ok walk that never moved (an empty route) is the same.
    if (move.distance > range + 1) {
      return failed('blocked', BLOCKED_TEXT, {
        position,
        distance: move.distance,
        ...(move.partial ? { partial: true } : {}),
        ...(stalled ? { stalled: true } : {}),
        ...note,
      });
    }
    return completed({
      position,
      distance: move.distance,
      ...(stalled ? { stalled: true } : {}),
      ...(move.partial ? { partial: true } : {}),
      ...note,
    });
  },
};
