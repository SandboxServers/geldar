import { type MoveResult, moveNear } from '../../actions/pathing.ts';
import type { Reflex, ReflexContext, ReflexOutcome, Trigger } from '../reflex.ts';
import type { BodyView } from '../view.ts';

/** A walk that did not arrive: `goto` or `moveNear` ended `blocked` (the stall watchdog or no path). */
export interface BlockedReport {
  /** The goal the walk aimed at, in world coordinates. */
  goal: { x: number; y: number; z: number };
  /** The range the walk had to reach the goal within. */
  range: number;
  /** The intent that asked for the walk, if any; the wake names it. */
  intentId: string | null;
  /** The walk's own message (for example `no movement for 600 world ticks`). */
  message?: string;
}

/** Blocks the detour waypoint lies to the side of the line from the Body to the goal. */
const DETOUR_BLOCKS = 8;
/** The alternate goal radius is the original range plus this many blocks. */
const WIDER_BY = 2;
/** How close the Body gets to the detour waypoint, in blocks. */
const WAYPOINT_RANGE = 2;
/** The alternate walk gives up after this many world ticks without movement (10 s at 20 TPS). */
const ALTERNATE_STALL_TICKS = 200;

/** A walk like `moveNear`; tests pass a fake. */
export type Walk = typeof moveNear;

/** A report goes stale after this many world ticks without the reflex taking it (5 s at 20 TPS). */
export const REPORT_TTL_TICKS = 100;

/** The reports waiting for the reflex, by view (one view per Body), with the tick they came in. */
const pending = new WeakMap<BodyView, { report: BlockedReport; tick: number }>();

/**
 * Tells the reflex that a walk ended `blocked`. The createBody hook calls this when a `goto` fails
 * with `blocked`; the reflex fires on the next tick. A program that sees a report waiting stays
 * `running` instead of failing, so the detour can help it. A second report before the first is
 * handled replaces it.
 */
export function reportBlocked(view: BodyView, report: BlockedReport): void {
  pending.set(view, { report, tick: view.tick ?? 0 });
}

/** The live report for this view: a stale one (past `REPORT_TTL_TICKS`) is dropped and not returned. */
function liveReport(view: BodyView): BlockedReport | null {
  const entry = pending.get(view);
  if (!entry) return null;
  if ((view.tick ?? 0) - entry.tick > REPORT_TTL_TICKS) {
    pending.delete(view);
    return null;
  }
  return entry.report;
}

/** True when a live report waits for this view. */
export function hasBlockedReport(view: BodyView): boolean {
  return liveReport(view) !== null;
}

/** Drops the waiting report when it was made for `intentId`: that intent has ended. */
export function dropBlockedReport(view: BodyView, intentId: string): void {
  if (pending.get(view)?.report.intentId === intentId) pending.delete(view);
}

/**
 * Blocked path (spec 5.2): the stall watchdog in `moveNear` has already ended the walk after 30 s
 * without movement; the reflex gets one alternate route and otherwise gives up. A report is used
 * only while it is fresh (`REPORT_TTL_TICKS`) and its intent is still running. The alternate is a
 * detour through a waypoint to the side of the line to the goal, then a walk to the goal with a
 * wider radius. If it fails the original action's `failed(blocked)` stands and the reflex raises
 * an `action_failed` wake whose detail says `blocked`, so the intent hears about it.
 */
export function createBlockedPathReflex(walk: Walk = moveNear): Reflex {
  return {
    name: 'blocked_path',
    priority: 20,
    cooldownTicks: 100,
    check(view): Trigger | null {
      const report = liveReport(view);
      if (!report) return null;
      return {
        x: report.goal.x,
        y: report.goal.y,
        z: report.goal.z,
        range: report.range,
        intent_id: report.intentId,
      };
    },
    async run(_trigger, ctx) {
      const report = liveReport(ctx.view);
      pending.delete(ctx.view);
      if (!report) return { result: 'abandoned', detail: 'nothing blocked' };
      await ctx.cancelAction();
      return alternateRoute(walk, ctx, report);
    },
  };
}

/** The reflex with the real `moveNear`. */
export const blockedPathReflex: Reflex = createBlockedPathReflex();

/** The detour waypoint: the midpoint to the goal, moved sideways by `DETOUR_BLOCKS`. */
export function detourWaypoint(
  from: { x: number; y: number; z: number },
  goal: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const dx = goal.x - from.x;
  const dz = goal.z - from.z;
  const length = Math.hypot(dx, dz) || 1;
  return {
    x: from.x + dx / 2 - (dz / length) * DETOUR_BLOCKS,
    y: from.y,
    z: from.z + dz / 2 + (dx / length) * DETOUR_BLOCKS,
  };
}

/** Walks to the waypoint, then to the goal. One try; any failure abandons the action as blocked. */
async function alternateRoute(
  walk: Walk,
  ctx: ReflexContext,
  report: BlockedReport,
): Promise<ReflexOutcome> {
  const opts = { signal: ctx.signal, timeScale: ctx.timeScale, stallTicks: ALTERNATE_STALL_TICKS };
  const here = ctx.bot.entity.position;
  const waypoint = detourWaypoint(here, report.goal);
  let move: MoveResult = await walk(ctx.bot, waypoint, WAYPOINT_RANGE, opts);
  if (move.ok) move = await walk(ctx.bot, report.goal, report.range + WIDER_BY, opts);
  if (move.ok) return { result: 'handled', detail: 'the alternate route reached the goal' };
  if (move.reason === 'cancelled') return { result: 'abandoned', detail: 'cancelled' };

  const why = `blocked: no alternate route (${move.message})`;
  ctx.sink.wake({
    reason: 'action_failed',
    tick: ctx.tick,
    intentId: report.intentId,
    detail: why,
  });
  return { result: 'abandoned', detail: why };
}
