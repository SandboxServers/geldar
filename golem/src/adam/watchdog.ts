/**
 * The wedge watchdog for Adam's Body. A Body can stay up while its bot makes no progress: the world
 * tick does not advance and the position does not change, so the Mind's `view` and `see` keep
 * answering "waking" and no action lands. The watchdog samples the Body on a timer; when nothing has
 * changed for `limitMs` it logs `body_watchdog` and ends the run (`fail`), which the supervisor
 * restarts through its ordinary `body_restart` path: same life, same position, next generation.
 *
 * The stall needed before the n-th restart in the window doubles (limit, 2x, 4x), and at most
 * `maxRestarts` restarts happen per `windowMs`. At the cap the watchdog does not restart; it logs
 * `body_unavailable` with the typed reason `wedged` once per stall, and goes on watching.
 */
import type { RunningAdamBody } from './adam-body.ts';

/** What one look at the Body shows. A null tick means the world clock is not known. */
export interface WatchSample {
  tick: number | null;
  position: string | null;
}

export interface WatchdogOptions {
  /** How long without a change counts as wedged. Default 60 000 ms. */
  limitMs?: number;
  /** Restarts allowed per window. Default 3. */
  maxRestarts?: number;
  /** The window for the cap, in ms. Default 600 000 (10 minutes). */
  windowMs?: number;
  /** How often the Body is sampled, in ms. Default 5000. */
  pollMs?: number;
  now?: () => number;
  /** Starts a repeating timer and returns its cancel function; default `setInterval`. */
  every?: (fire: () => void, ms: number) => () => void;
  /** Reads the Body; default reads the runtime view. */
  sample?: (body: RunningAdamBody) => WatchSample;
  log: (line: Record<string, unknown>) => void;
}

/** Reads the tick and feet position from the Body's view; either is null when unreadable. */
export function sampleBody(body: RunningAdamBody): WatchSample {
  const view = body.body.runtime.view;
  let position: string | null = null;
  try {
    const p = view.position;
    position = `${p.x},${p.y},${p.z}`;
  } catch {
    position = null;
  }
  return { tick: view.tick ?? null, position };
}

const defaultEvery = (fire: () => void, ms: number): (() => void) => {
  const timer = setInterval(fire, ms);
  timer.unref();
  return () => clearInterval(timer);
};

/** Holds the restart history across runs; `attach` watches one run. */
export class BodyWatchdog {
  private readonly restarts: number[] = [];
  private readonly o: Required<Omit<WatchdogOptions, 'sample' | 'every' | 'now'>> &
    Pick<WatchdogOptions, 'sample' | 'every' | 'now'>;

  constructor(options: WatchdogOptions) {
    this.o = {
      limitMs: options.limitMs ?? 60_000,
      maxRestarts: options.maxRestarts ?? 3,
      windowMs: options.windowMs ?? 600_000,
      pollMs: options.pollMs ?? 5_000,
      log: options.log,
      ...(options.sample === undefined ? {} : { sample: options.sample }),
      ...(options.every === undefined ? {} : { every: options.every }),
      ...(options.now === undefined ? {} : { now: options.now }),
    };
  }

  /** Watches `body` until the returned detach is called; `onWedge(reason)` ends the run. */
  attach(body: RunningAdamBody, onWedge: (reason: string) => void): () => void {
    const now = this.o.now ?? Date.now;
    const read = this.o.sample ?? sampleBody;
    let last = read(body);
    let since = now();
    let capLogged = false;
    const check = (): void => {
      const t = now();
      const s = read(body);
      if (s.tick !== null && (s.tick !== last.tick || s.position !== last.position)) {
        last = s;
        since = t;
        capLogged = false;
        return;
      }
      last = s;
      const stalledMs = t - since;
      if (stalledMs < this.o.limitMs) return;
      while (this.restarts.length > 0 && t - (this.restarts[0] as number) >= this.o.windowMs) {
        this.restarts.shift();
      }
      const state = {
        life_id: body.lifeId,
        body_generation: body.generation,
        state: s.tick === null ? 'unavailable' : 'waking',
        stalled_ms: stalledMs,
        tick: s.tick,
        restarts_in_window: this.restarts.length,
      };
      if (this.restarts.length >= this.o.maxRestarts) {
        if (capLogged) return;
        capLogged = true;
        this.o.log({ event: 'body_watchdog', ...state, action: 'capped' });
        this.o.log({ event: 'body_unavailable', reason: 'wedged', life_id: body.lifeId });
        return;
      }
      // Exponential: the n-th restart in the window waits for a stall of limit * 2^n.
      if (stalledMs < this.o.limitMs * 2 ** this.restarts.length) return;
      this.restarts.push(t);
      this.o.log({ event: 'body_watchdog', ...state, action: 'restart' });
      onWedge('wedged: no tick or position change');
    };
    return (this.o.every ?? defaultEvery)(check, this.o.pollMs);
  }
}
