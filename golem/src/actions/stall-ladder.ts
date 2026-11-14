import type { Bot } from 'mineflayer';
import { nearDoor } from './path-doors.ts';

/** Escape ladders one goto may run before the plain `blocked` result stands. */
export const MAX_LADDERS = 2;

/**
 * Identical replans (the Body still on the same spot after each re-set of the goal) before the goto
 * runs the escape ladder (decision 0210). The next stall tick after that many replans runs the ladder
 * in place of another replan.
 */
export const ESCALATE_AFTER_REPLANS = 3;

/**
 * Wall-clock bound of the same escalation (decision 0210). At low TPS the tick count reaches the goto's
 * 120 s wall timeout first (240 ticks is 120 s at 2 TPS), so the escalation is also due once this much
 * wall time has passed since the Body last moved, with `ESCALATE_AFTER_REPLANS` replans behind it.
 */
export const ESCALATE_WALL_MS = 15_000;

/**
 * The wall-clock arm, once per still spell: `spell` is the movement the spell began with (the Body's last
 * move), so a new movement starts a new spell, and a refused check does not repeat on every watch tick.
 */
export function createWallArm(): {
  due(stuckReplans: number, spell: number, msSinceMove: number): boolean;
} {
  let tried: number | undefined;
  return {
    due(stuckReplans, spell, msSinceMove) {
      if (tried === spell || stuckReplans < ESCALATE_AFTER_REPLANS) return false;
      if (msSinceMove < ESCALATE_WALL_MS) return false;
      tried = spell;
      return true;
    },
  };
}

/** What opened an escalation: a blocked search, the long stall, or the identical replans. */
export type EscalateTrigger = 'blocked' | 'stall' | 'replans';

/**
 * Why the escape ladder must not run here, or null when it may. A door beside the bot or beside the
 * next path node is a doorway, which digging and pillaring only make worse. Nothing else skips: a
 * followPartial walk reports success even inside a pit, so the path status says nothing about a pit.
 */
export function ladderSkip(bot: Bot): string | null {
  if (nearDoor(bot)) return 'door_adjacent';
  return null;
}

/** The one stall_diag line an escalation writes when its ladder starts (the rung lines follow it). */
export function escalateLine(trigger: EscalateTrigger, replans: number): string {
  return JSON.stringify({ event: 'stall_diag', reason: 'escalate', trigger, replans });
}
