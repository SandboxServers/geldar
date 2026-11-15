import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import { DEFAULT_DIAG_SINK, emitStallDiag } from './stall-diag.ts';
import { EIGHT, scanDrop } from './unstick-plan.ts';

/**
 * The `no_way_out` diag line, with the steps this call tried, the health, and the drop beside the feet in
 * each of the eight directions (`scanDrop`: blocks fallen and what lands). The shared diag line has no
 * field for them, so the line is built by `emitStallDiag` (same snapshot, same rate limit) and gets them added.
 */
export function reportNoWayOut(bot: Bot, tried: readonly string[]): void {
  const feet = bot.entity.position.floored();
  const drops = EIGHT.map((dir) => ({
    dir: [dir.x, dir.z],
    ...scanDrop((cell) => bot.blockAt(cell), feet.plus(dir).offset(0, -1, 0)),
  }));
  emitStallDiag(
    bot,
    { reason: 'no_way_out' },
    {
      now: () => DEFAULT_DIAG_SINK.now(),
      log: (line) =>
        DEFAULT_DIAG_SINK.log(
          JSON.stringify({ ...JSON.parse(line), tried, health: bot.health ?? 20, drops }),
        ),
    },
  );
}

/** The cells whose ownership the last-resort pass prefetches: the feet and head, and the eight neighbours. */
export function escapePoints(feet: Vec3): Vec3[] {
  const ring = EIGHT.map((dir) => feet.plus(dir));
  return [feet, feet.offset(0, 1, 0), ...ring, ...ring.map((cell) => cell.offset(0, 1, 0))];
}
