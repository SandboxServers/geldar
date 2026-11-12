import type { McpPlayerEvent, Snapshot } from '@geldar/contract';
import type { SimEvent } from '@geldar/mcp-mock';

/** Consecutive failures of one goal before a result states the fact. */
export const REPEAT_THRESHOLD = 3;
/** The most goals one life tracks, and the most submitted targets kept per verb. */
const MAX_GOALS = 8;
const MAX_PENDING = 12;
/** A move past this many blocks from the anchor clears the streaks. */
export const MOVE_RESET_BLOCKS = 3;

export interface Place {
  x: number;
  y: number;
  z: number;
}

interface Goal {
  verb: string;
  target: string;
  count: number;
  reason: string | undefined;
}

interface LifeState {
  lastSeq: number;
  pending: Map<string, string[]>;
  goals: Map<string, Goal>;
  anchor: Place | undefined;
  anchorMs: number;
  lastSleep: string | undefined;
}

const SAFE_WORD = /^[A-Za-z0-9_]{1,64}$/;

/** What an action aims at, as a short fixed-shape word or coordinates; empty when it names none. */
function targetOf(action: unknown): string {
  if (typeof action !== 'object' || action === null) return '';
  const a = action as Record<string, unknown>;
  for (const key of ['target', 'block', 'item', 'at'] as const) {
    const v = a[key];
    if (typeof v === 'string' && SAFE_WORD.test(v)) return v;
    if (typeof v === 'object' && v !== null) {
      const p = v as Record<string, unknown>;
      if ([p.x, p.y, p.z].every((n) => typeof n === 'number' && Number.isFinite(n))) {
        return `${Math.trunc(p.x as number)},${Math.trunc(p.y as number)},${Math.trunc(p.z as number)}`;
      }
    }
  }
  return '';
}

function farFrom(a: Place, b: Place): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > MOVE_RESET_BLOCKS;
}

/** The fields of a snapshot this tracker reads. */
export function placeOf(snapshot: Snapshot): Place | undefined {
  const self = (snapshot as unknown as { self?: { position?: Place } }).self;
  const p = self?.position;
  return p === undefined ? undefined : { x: p.x, y: p.y, z: p.z };
}

/** A string that is equal for equal position, health and inventory (the sleep comparison). */
export function stateSignature(snapshot: Snapshot): string {
  const self = (snapshot as unknown as { self?: Record<string, unknown> }).self ?? {};
  const p = placeOf(snapshot);
  const where = p === undefined ? '' : `${Math.trunc(p.x)},${Math.trunc(p.y)},${Math.trunc(p.z)}`;
  return JSON.stringify([where, self.health, self.inventory]);
}

/**
 * Per-life memory of repeated failures. The act tool records what was asked; the wait and sleep tools
 * feed it the outcome events and the position. It holds at most MAX_GOALS goals per life, drops them
 * on any success or a move of more than MOVE_RESET_BLOCKS, and states facts about the world only.
 */
export class FailureTracker {
  private readonly lives = new Map<string, LifeState>();

  private state(lifeId: string): LifeState {
    let s = this.lives.get(lifeId);
    if (s === undefined) {
      s = {
        lastSeq: 0,
        pending: new Map(),
        goals: new Map(),
        anchor: undefined,
        anchorMs: 0,
        lastSleep: undefined,
      };
      this.lives.set(lifeId, s);
    }
    return s;
  }

  /** Remembers the targets of the actions the Body accepted, per verb, oldest first. */
  submitted(lifeId: string, actions: readonly unknown[]): void {
    const s = this.state(lifeId);
    for (const action of actions) {
      const verb = (action as { do?: unknown } | null)?.do;
      if (typeof verb !== 'string') continue;
      const queue = s.pending.get(verb) ?? [];
      queue.push(targetOf(action));
      if (queue.length > MAX_PENDING) queue.shift();
      s.pending.set(verb, queue);
    }
  }

  /** Reads the outcome events after the last one seen, then the position; returns the plain facts. */
  observe(
    lifeId: string,
    events: readonly SimEvent[],
    place: Place | undefined,
    nowMs: number,
  ): string[] {
    const s = this.state(lifeId);
    for (const e of events) {
      if (e.seq <= s.lastSeq) continue;
      s.lastSeq = e.seq;
      if (e.kind === 'action') {
        s.goals.clear();
        if (e.intent !== true && e.name !== undefined) s.pending.get(e.name)?.shift();
      } else if (e.kind === 'action_failed' && e.name !== undefined) {
        const target = e.intent === true ? '' : (s.pending.get(e.name)?.shift() ?? '');
        this.fail(s, e.name, target, (e as { reason?: string }).reason);
      }
    }
    if (place !== undefined) {
      if (s.anchor === undefined || farFrom(s.anchor, place)) {
        if (s.anchor !== undefined) s.goals.clear();
        s.anchor = place;
        s.anchorMs = nowMs;
      }
    }
    return this.facts(s, nowMs);
  }

  private fail(s: LifeState, verb: string, target: string, reason: string | undefined): void {
    const key = `${verb}\u0000${target}`;
    const goal = s.goals.get(key) ?? { verb, target, count: 0, reason };
    goal.count++;
    goal.reason = reason ?? goal.reason;
    s.goals.delete(key);
    s.goals.set(key, goal);
    while (s.goals.size > MAX_GOALS) {
      const oldest = s.goals.keys().next().value;
      if (oldest === undefined) break;
      s.goals.delete(oldest);
    }
  }

  private facts(s: LifeState, nowMs: number): string[] {
    const minutes = s.anchor === undefined ? 0 : Math.floor((nowMs - s.anchorMs) / 60_000);
    const lines: string[] = [];
    for (const g of s.goals.values()) {
      if (g.count < REPEAT_THRESHOLD) continue;
      const what = g.target === '' ? g.verb : `${g.verb} ${g.target}`;
      const why = g.reason === undefined ? '' : ` (${g.reason.replaceAll('_', ' ')})`;
      const stay = minutes >= 1 ? `; position unchanged for ${minutes} minutes` : '';
      lines.push(`${what} has failed ${g.count} times in a row${why}${stay}.`);
    }
    return lines;
  }

  /**
   * True when position, health and inventory equal those at the previous sleep. Records the
   * snapshot for the next call either way.
   */
  sameAsLastSleep(lifeId: string, snapshot: Snapshot): boolean {
    const s = this.state(lifeId);
    const signature = stateSignature(snapshot);
    const same = s.lastSleep === signature;
    s.lastSleep = signature;
    return same;
  }
}

/** The facts as player events; each is the fixed `action_failed` type with a world-fact text. */
export function factEvents(facts: readonly string[], seq: number, tick: number): McpPlayerEvent[] {
  return facts.map((text) => ({ seq: Math.max(1, seq), type: 'action_failed', tick, text }));
}
