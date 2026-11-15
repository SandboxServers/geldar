import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { type ActionRun, runAction } from '../../actions/registry.ts';
import type { Reflex, ReflexContext, ReflexOutcome, Trigger } from '../reflex.ts';
import type { BodyView } from '../view.ts';
import { hasBurrow } from './panic-burrow.ts';

/** Ticks (20 per second) the Body must stay put, with no action, before it counts as idle: 60 s. */
export const IDLE_TICKS = 1200;
/**
 * Ticks the Body must stay put, boxed in, before it counts as stuck while it stands on a block it placed
 * itself: 120 s (decision 0330). Shorter stays on its own plank are its work (building, waiting).
 */
export const IDLE_TICKS_ON_OWN = 2400;
/** A move of at least this many blocks from where the Body stood counts as movement. */
export const MOVE_BLOCKS = 0.5;
/** The first wait after an unstick run that did not free the Body: 60 s, doubling per failure. */
export const BACKOFF_BASE_TICKS = 1200;
/** The longest wait between unstick runs in one stuck spell: 10 min. */
export const BACKOFF_CAP_TICKS = 12000;
/** Dark shelter refusals in a row at one spot that run unstick once (decision 0196, B2). */
export const REFUSALS_TO_UNSTICK = 3;
/** A refusal counts as the same spot while the Body is within this many blocks of the first one. */
export const SAME_REFUSAL_SPOT = 2;
/** Most unstick runs one Body may start in any hour of world time (decision 0196). */
export const RUNS_PER_HOUR = 6;
/** One hour of world time in ticks. */
export const HOUR_TICKS = 72000;
/**
 * Ticks idle_stuck waits after a run the Body was hurt in, before it may run again: 15 s. A flee or
 * fight reflex needs a few seconds to clear a hostile, so 15 s lets it act first; a Body still stuck
 * then re-arms well inside the 60 s clock and the doubling backoff (decision 0196, 2026-11-14).
 */
export const IDLE_STUCK_DAMAGE_BACKOFF_TICKS = 300;
/** How long a run waits for the unstick handler to wind down once the run ends: the runtime's 2 s grace. */
const HANDLER_GRACE_MS = 2000;

const TICKS_PER_SECOND = 20;

interface Spot {
  x: number;
  y: number;
  z: number;
}

/** What the idle clock and the unstick backoff remember about one Body (one view). */
interface IdleState {
  /** Where the Body stood when the still spell began; null until the first check. */
  anchor: Spot | null;
  /** World tick the still spell began (or the last reset of its clock; a run's end). */
  since: number;
  /** World tick of the last finished action; -1 before any. */
  actionEnd: number;
  /** Unstick runs that did not free the Body, in one spell. */
  failures: number;
  /** No unstick run before this world tick. */
  until: number;
  /** World ticks at which unstick runs started, for the hourly cap. */
  runs: number[];
}

const idleStates = new WeakMap<BodyView, IdleState>();

function stateOf(view: BodyView): IdleState {
  let state = idleStates.get(view);
  if (!state) {
    state = { anchor: null, since: 0, actionEnd: -1, failures: 0, until: 0, runs: [] };
    idleStates.set(view, state);
  }
  return state;
}

function spotOf(view: BodyView): Spot {
  const { x, y, z } = view.position;
  return { x, y, z };
}

function distance(a: Spot, b: Spot): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function formatSpot(at: Spot): string {
  return `(${at.x.toFixed(1)}, ${at.y.toFixed(1)}, ${at.z.toFixed(1)})`;
}

/**
 * Tells the idle clock that an action ended at this tick. The clock restarts from here, so a goto
 * the Mind issued (and any action) does not count as stillness. Called for every finished action.
 */
export function noteActionEnd(view: BodyView): void {
  stateOf(view).actionEnd = view.tick ?? 0;
}

/** Forgets the idle clock, the backoff and the run count of a view (the Body died and respawned). */
export function resetIdleStuck(view: BodyView): void {
  idleStates.delete(view);
  refusals.delete(view);
}

/**
 * The guards the idle clock holds: no Mind action runs, the Body is neither asleep nor riding, and it is
 * not in a burrow it dug. A read the view cannot make (an unknown action or sleep state) is not a yes.
 */
function idleGuards(view: BodyView): boolean {
  return (
    view.actionRunning === false &&
    view.asleep === false &&
    view.riding === false &&
    !hasBurrow(view)
  );
}

/**
 * True when the dark shelter unstick (B2) may run for this Body: the idle guards hold and it does not
 * stand on a block it placed itself (its own pillar is its own work, owner ruling 2026-11-14). B1 does
 * not use this: its own-placement clock is `IDLE_TICKS_ON_OWN` (decision 0330).
 */
export function mayUnstick(view: BodyView): boolean {
  return idleGuards(view) && view.onOwnPlacement !== true;
}

/**
 * Idle stuck (decision 0196, B1): the Body has not moved (less than `MOVE_BLOCKS`) for `IDLE_TICKS`
 * and `mayUnstick` holds, and it is stuck: enclosed by day, or on a ledge it cannot step off. At night
 * an enclosed Body is a sealed shelter, so it is left alone. It runs the `unstick` action once, then
 * waits (60 s, doubling, capped at 10 min) until the next run, counted from the end of that run. Its
 * priority is the lowest of the reflexes, so the runner never checks it while another reflex fires
 * (panic burrow, hazard escape and the rest go first). A read it cannot make never fires it.
 */
export const idleStuckReflex: Reflex = {
  name: 'idle_stuck',
  suspendedWhileAsleep: () => true,
  priority: 10,
  cooldownTicks: 200,
  check(view): Trigger | null {
    const now = view.tick;
    if (now === null) return null;
    const state = stateOf(view);
    const here = spotOf(view);
    if (!state.anchor || distance(here, state.anchor) >= MOVE_BLOCKS) {
      state.anchor = here;
      state.since = now;
      state.failures = 0;
      state.until = 0;
      return null;
    }
    if (!idleGuards(view)) {
      state.since = now;
      return null;
    }
    if (state.actionEnd > state.since) state.since = state.actionEnd;
    const wait = view.onOwnPlacement === true ? IDLE_TICKS_ON_OWN : IDLE_TICKS;
    if (now - state.since < wait || now < state.until) return null;
    const reason = stuckReason(view);
    if (reason === null) return null;
    return { reason, idle_seconds: Math.round((now - state.since) / TICKS_PER_SECOND) };
  },
  async run(trigger, ctx): Promise<ReflexOutcome> {
    return runUnstick(ctx, `idle_stuck (${String(trigger.reason)})`);
  },
};

/**
 * Why the Body is stuck, or null. Enclosed fires by day only: at night a sealed Body is in its shelter
 * (panic burrow leaves it alone too), and a view that cannot say whether it is night never fires it.
 * A ledge it cannot step off fires at any time.
 */
function stuckReason(view: BodyView): 'enclosed' | 'ledge' | null {
  if (view.enclosed === true) return view.isNight === false ? 'enclosed' : null;
  return view.canStepOff === false ? 'ledge' : null;
}

/**
 * Runs the `unstick` action once for a stuck Body, through the backoff both triggers share. It
 * refuses while the backoff holds, and when the Body has already started `RUNS_PER_HOUR` runs in the
 * last hour of world time. A run that frees the Body clears the backoff; any other run doubles it (60 s,
 * 120 s, ... capped at 10 min), counted from the tick the run ends. The Body's position is taken again
 * when the run ends, so the run's own movement is not "movement" and does not clear the backoff.
 * Returns one outcome whose detail is the one log line of the run.
 */
export async function runUnstick(ctx: ReflexContext, source: string): Promise<ReflexOutcome> {
  const state = stateOf(ctx.view);
  const at = formatSpot(spotOf(ctx.view));
  if (ctx.tick < state.until) {
    const wait = Math.round((state.until - ctx.tick) / TICKS_PER_SECOND);
    return { result: 'abandoned', detail: `${source}: unstick backing off ${wait}s at ${at}` };
  }
  state.runs = state.runs.filter((started) => ctx.tick - started < HOUR_TICKS);
  if (state.runs.length >= RUNS_PER_HOUR) {
    return {
      result: 'abandoned',
      detail: `${source}: unstick capped at ${RUNS_PER_HOUR} runs an hour at ${at}`,
    };
  }
  state.runs.push(ctx.tick);
  const action: Action = { do: 'unstick' };
  // The run holds the runtime's action slot, so a Mind action cannot start mid-dig (decision 0196).
  // Damage aborts the run (decision 0196, 2026-11-14), and the slot is released only after the
  // unstick handler has wound down.
  const hurt = watchHurt(ctx.bot, ctx.signal);
  const release = ctx.holdSlot?.();
  let run: ActionRun;
  try {
    let handlerEnded: Promise<void> = Promise.resolve();
    run = await runAction(ctx.registry, ctx.bot, action, {
      signal: hurt.signal,
      timeScale: ctx.timeScale,
      onHandler: (ended) => {
        handlerEnded = ended;
      },
    });
    await handlerWound(handlerEnded, ctx.timeScale);
  } finally {
    hurt.stop();
    release?.();
  }
  const end = ctx.view.tick ?? ctx.tick;
  state.anchor = spotOf(ctx.view);
  // A completed run frees the Body only when it now stands where it can step off (canStepOff true).
  // A run that dug one block lower from a deep drop completes but leaves the Body on the ledge.
  const freed = run.state === 'completed' && ctx.view.canStepOff === true;
  if (freed) {
    state.since = end;
    state.failures = 0;
    state.until = 0;
    return { result: 'handled', detail: `${source}: unstick freed the body; backoff 0s at ${at}` };
  }
  if (hurt.hurt()) {
    // Hurt during the run is not a failed run: the failure count stays, and only the short damage
    // backoff holds idle_stuck. The idle clock keeps the spell it had, so it re-arms when the backoff ends.
    state.until = end + IDLE_STUCK_DAMAGE_BACKOFF_TICKS;
    const wait = Math.round(IDLE_STUCK_DAMAGE_BACKOFF_TICKS / TICKS_PER_SECOND);
    return {
      result: 'abandoned',
      detail: `${source}: unstick stopped, the Body was hurt; backoff ${wait}s at ${at}`,
    };
  }
  state.since = end;
  state.failures++;
  const period = Math.min(BACKOFF_BASE_TICKS * 2 ** (state.failures - 1), BACKOFF_CAP_TICKS);
  state.until = end + period;
  const backoff = `backoff ${Math.round(period / TICKS_PER_SECOND)}s at ${at}`;
  if (run.state === 'cancelled') {
    return { result: 'abandoned', detail: `${source}: unstick cancelled; ${backoff}` };
  }
  if (run.state === 'completed') {
    return { result: 'failed', detail: `${source}: unstick left the body on a ledge; ${backoff}` };
  }
  return { result: 'failed', detail: `${source}: unstick found no way out; ${backoff}` };
}

/**
 * Watches the Body's health for a drop (the drop the view counts as hurt). `signal` aborts on the first
 * drop, or when `parent` aborts; `hurt()` says whether a drop was seen. `stop` removes both listeners,
 * so nothing outlives the run.
 */
function watchHurt(
  bot: Bot,
  parent: AbortSignal,
): { signal: AbortSignal; hurt: () => boolean; stop: () => void } {
  const controller = new AbortController();
  let seen = false;
  let last = bot.health;
  const onHealth = (): void => {
    if (bot.health < last) {
      seen = true;
      controller.abort();
    }
    last = bot.health;
  };
  const onParent = (): void => controller.abort();
  bot.on('health', onHealth);
  parent.addEventListener('abort', onParent, { once: true });
  if (parent.aborted) controller.abort();
  return {
    signal: controller.signal,
    hurt: () => seen,
    stop: () => {
      bot.off('health', onHealth);
      parent.removeEventListener('abort', onParent);
    },
  };
}

/** Waits until the handler has ended, at most the grace (scaled by the time scale); clears its timer. */
function handlerWound(ended: Promise<void>, timeScale: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, HANDLER_GRACE_MS * timeScale);
  });
  return Promise.race([ended.catch(() => undefined), grace]).finally(() => clearTimeout(timer));
}

/** Shelter refusals (`no suitable block`) in a row at one spot, per view. */
const refusals = new WeakMap<BodyView, { at: Spot; count: number }>();

/**
 * Notes one dark shelter outcome for the B2 trigger. A refusal at the same spot (within
 * `SAME_REFUSAL_SPOT`) adds to the count, one further away starts a new count, and any other
 * outcome clears it. True on the `REFUSALS_TO_UNSTICK`-th refusal in a row; the count then restarts,
 * so one spot triggers once per run of refusals.
 */
export function noteShelterRefusal(view: BodyView, refused: boolean): boolean {
  if (!refused) {
    refusals.delete(view);
    return false;
  }
  const here = spotOf(view);
  const run = refusals.get(view);
  if (!run || distance(here, run.at) > SAME_REFUSAL_SPOT) {
    refusals.set(view, { at: here, count: 1 });
    return false;
  }
  run.count++;
  if (run.count < REFUSALS_TO_UNSTICK) return false;
  refusals.delete(view);
  return true;
}
