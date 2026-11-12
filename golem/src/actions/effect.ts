import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { type ActionOutcome, failed } from './outcome.ts';

/** What an action measurably did to the body or the world. */
export type Effect = 'moved' | 'changed' | 'no_effect' | 'partial';

/** Blocks the body must move before a goto or unstick counts as having moved. */
const MIN_MOVE = 0.5;
/** A goto whose target is nearer than this to the start has nothing to move for. */
const ALREADY_THERE = 1.5;

/** The state read before and after an action. Absent parts were not readable (a bot without them). */
export interface Snapshot {
  pos: { x: number; y: number; z: number } | null;
  items: Map<string, number> | null;
  /** Block names at the cells the action targets, keyed "x,y,z". */
  blocks: Map<string, string> | null;
}

/** The verbs whose success is checked against a measured effect. */
const CHECKED = new Set(['goto', 'mine', 'place', 'give', 'craft', 'unstick']);

function cells(bot: Bot, action: Action): Vec3[] {
  if (action.do !== 'place') return [];
  if (action.at === 'feet') {
    const feet = bot.entity?.position;
    if (!feet) return [];
    const base = new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z));
    return [base, base.offset(0, -1, 0)];
  }
  return [new Vec3(action.at.x, action.at.y, action.at.z)];
}

/** Reads position, inventory totals and (for place) the target blocks. Never throws. */
export function snapshot(bot: Bot, action: Action): Snapshot {
  const snap: Snapshot = { pos: null, items: null, blocks: null };
  try {
    const p = bot.entity?.position;
    if (p) snap.pos = { x: p.x, y: p.y, z: p.z };
    const list = bot.inventory?.items?.();
    if (list) {
      snap.items = new Map();
      for (const it of list) snap.items.set(it.name, (snap.items.get(it.name) ?? 0) + it.count);
    }
    const at = cells(bot, action);
    if (at.length > 0 && typeof bot.blockAt === 'function') {
      snap.blocks = new Map();
      for (const c of at) snap.blocks.set(`${c.x},${c.y},${c.z}`, bot.blockAt(c)?.name ?? 'none');
    }
  } catch {
    return { pos: null, items: null, blocks: null };
  }
  return snap;
}

function dist(a: NonNullable<Snapshot['pos']>, b: NonNullable<Snapshot['pos']>): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Total items gained (positive) or lost (negative) across all names, or of one name. */
function itemDelta(before: Snapshot, after: Snapshot, name?: string): number | null {
  if (!before.items || !after.items) return null;
  const names =
    name === undefined ? new Set([...before.items.keys(), ...after.items.keys()]) : [name];
  let net = 0;
  let gained = 0;
  for (const n of names) {
    const d = (after.items.get(n) ?? 0) - (before.items.get(n) ?? 0);
    net += d;
    if (d > 0) gained += d;
  }
  return name === undefined ? gained : net;
}

/** The measured effect of a completed action, with the delta and a plain line for the failure message. */
export interface Receipt {
  effect: Effect;
  delta: Record<string, number>;
  /** What was expected and what was measured; set only for `no_effect`. */
  line?: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Judges one action from two snapshots. Undefined when the verb is not checked or nothing was readable. */
export function judge(action: Action, before: Snapshot, after: Snapshot): Receipt | undefined {
  if (!CHECKED.has(action.do)) return undefined;
  const moved = before.pos && after.pos ? round1(dist(before.pos, after.pos)) : null;
  switch (action.do) {
    case 'goto': {
      if (moved === null || typeof action.target === 'string' || !before.pos) return undefined;
      const t = action.target;
      const wanted = round1(dist(before.pos, t));
      if (wanted < ALREADY_THERE) return undefined;
      if (moved < MIN_MOVE) {
        return noEffect(
          { blocks_moved: moved },
          `The goto was expected to move you about ${wanted} blocks; you moved ${moved}.`,
        );
      }
      return { effect: 'moved', delta: { blocks_moved: moved } };
    }
    case 'unstick': {
      if (moved === null) return undefined;
      if (moved < MIN_MOVE) {
        return noEffect(
          { blocks_moved: moved },
          `The unstick was expected to move you; you moved ${moved} blocks.`,
        );
      }
      return { effect: 'moved', delta: { blocks_moved: moved } };
    }
    case 'mine': {
      const gained = itemDelta(before, after);
      if (gained === null) return undefined;
      if (gained <= 0) {
        return noEffect(
          { items_gained: 0 },
          `The mine was expected to gain ${action.count} items; you gained 0.`,
        );
      }
      return {
        effect: gained < action.count ? 'partial' : 'changed',
        delta: { items_gained: gained },
      };
    }
    case 'craft': {
      const gained = itemDelta(before, after, action.item);
      if (gained === null) return undefined;
      if (gained <= 0) {
        return noEffect(
          { items_gained: 0 },
          `The craft was expected to gain ${action.count} ${action.item}; you gained 0.`,
        );
      }
      return {
        effect: gained < action.count ? 'partial' : 'changed',
        delta: { items_gained: gained },
      };
    }
    case 'give': {
      const delta = itemDelta(before, after, action.item);
      if (delta === null) return undefined;
      const lost = -delta;
      if (lost <= 0) {
        return noEffect(
          { items_lost: 0 },
          `The give was expected to hand over ${action.count} ${action.item}; you lost 0.`,
        );
      }
      return { effect: lost < action.count ? 'partial' : 'changed', delta: { items_lost: lost } };
    }
    case 'place': {
      if (!before.blocks || !after.blocks) return undefined;
      const changed = [...before.blocks].some(([k, name]) => after.blocks?.get(k) !== name);
      const lost = -(itemDelta(before, after, action.block) ?? 0);
      if (!changed && lost <= 0) {
        return noEffect(
          { blocks_changed: 0, items_lost: 0 },
          `The place was expected to put ${action.block} in the world; no block changed and you lost 0 ${action.block}.`,
        );
      }
      return {
        effect: 'changed',
        delta: { blocks_changed: changed ? 1 : 0, items_lost: Math.max(lost, 0) },
      };
    }
    default:
      return undefined;
  }
}

function noEffect(delta: Record<string, number>, line: string): Receipt {
  return { effect: 'no_effect', delta, line };
}

/**
 * Applies a receipt to a finished outcome. A completed action with `no_effect` becomes a typed
 * `no_effect` failure; any other completed action gets `effect` and `delta` in its detail.
 */
export function withReceipt(outcome: ActionOutcome, receipt: Receipt | undefined): ActionOutcome {
  if (outcome.status !== 'completed' || !receipt) return outcome;
  if (receipt.effect === 'no_effect') {
    return failed('no_effect', receipt.line ?? 'nothing changed', {
      ...outcome.detail,
      effect: receipt.effect,
      delta: receipt.delta,
    });
  }
  return {
    ...outcome,
    detail: { ...outcome.detail, effect: receipt.effect, delta: receipt.delta },
  };
}
