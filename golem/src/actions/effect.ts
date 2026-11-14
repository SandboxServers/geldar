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
/** The food level at which eating is refused. */
const FULL_FOOD = 20;

/** The state read before and after an action. Absent parts were not readable (a bot without them). */
export interface Snapshot {
  pos: { x: number; y: number; z: number } | null;
  items: Map<string, number> | null;
  /** Block names at the cells the action targets, keyed "x,y,z". */
  blocks: Map<string, string> | null;
  /** Food level, or null when the bot has none. */
  food: number | null;
  /** Whether the bot is in a bed, or null when unreadable. */
  sleeping: boolean | null;
  /** For attack: every live entity with the target's name, by id. Null for other verbs. */
  targets: Map<number, { health: number | null }> | null;
}

/** The verbs whose success is checked against a measured effect. */
const CHECKED = new Set([
  'goto',
  'mine',
  'place',
  'give',
  'craft',
  'unstick',
  'eat',
  'attack',
  'deposit',
  'withdraw',
  'open',
  'write_sign',
  'sleep',
]);

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

function emptySnapshot(): Snapshot {
  return { pos: null, items: null, blocks: null, food: null, sleeping: null, targets: null };
}

/** The live entities that answer to the target name, with their health when they report it. */
function targetsOf(bot: Bot, name: string): Map<number, { health: number | null }> | null {
  if (!bot.entities || !bot.entity) return null;
  const out = new Map<number, { health: number | null }>();
  for (const e of Object.values(bot.entities)) {
    if (e === bot.entity || e.isValid === false) continue;
    if (e.name !== name && e.username !== name) continue;
    const health = (e as { health?: unknown }).health;
    out.set(e.id, { health: typeof health === 'number' ? health : null });
  }
  return out;
}

/** Reads position, inventory totals and (for place) the target blocks. Never throws. */
export function snapshot(bot: Bot, action: Action): Snapshot {
  const snap = emptySnapshot();
  try {
    const p = bot.entity?.position;
    if (p) snap.pos = { x: p.x, y: p.y, z: p.z };
    const list = bot.inventory?.items?.();
    if (list) {
      snap.items = new Map();
      for (const it of list) snap.items.set(it.name, (snap.items.get(it.name) ?? 0) + it.count);
    }
    if (typeof bot.food === 'number') snap.food = bot.food;
    if (typeof bot.isSleeping === 'boolean') snap.sleeping = bot.isSleeping;
    if (action.do === 'attack') snap.targets = targetsOf(bot, action.target);
    const at = cells(bot, action);
    if (at.length > 0 && typeof bot.blockAt === 'function') {
      snap.blocks = new Map();
      for (const c of at) snap.blocks.set(`${c.x},${c.y},${c.z}`, bot.blockAt(c)?.name ?? 'none');
    }
  } catch {
    return emptySnapshot();
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
export function judge(
  action: Action,
  before: Snapshot,
  after: Snapshot,
  detail: Record<string, unknown> = {},
): Receipt | undefined {
  if (!CHECKED.has(action.do)) return undefined;
  const moved = before.pos && after.pos ? round1(dist(before.pos, after.pos)) : null;
  switch (action.do) {
    case 'goto': {
      if (moved === null || typeof action.target === 'string' || !before.pos) return undefined;
      const t = action.target;
      // The walker aims at the cell centre (goto.ts), so the expected distance is measured to it too.
      const wanted = round1(dist(before.pos, { x: t.x + 0.5, y: t.y, z: t.z + 0.5 }));
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
      return judgeMore(action, before, after, detail);
  }
}

/** Net count lost across all item names. */
function lostTotal(before: Snapshot, after: Snapshot): number | null {
  if (!before.items || !after.items) return null;
  let lost = 0;
  for (const [n, c] of before.items) lost += Math.max(0, c - (after.items.get(n) ?? 0));
  return lost;
}

function judgeMore(
  action: Action,
  before: Snapshot,
  after: Snapshot,
  detail: Record<string, unknown>,
): Receipt | undefined {
  switch (action.do) {
    case 'eat': {
      // Nothing to judge when the body is full already: a no-op there is legitimate.
      if (before.food === null || after.food === null || before.food >= FULL_FOOD) return undefined;
      const lost = lostTotal(before, after);
      const rose = after.food - before.food;
      if (rose <= 0 && (lost ?? 0) <= 0) {
        return noEffect(
          { food_gained: 0, items_lost: 0 },
          'The eat was expected to raise your food level or use up food; neither changed.',
        );
      }
      return {
        effect: 'changed',
        delta: { food_gained: Math.max(rose, 0), items_lost: lost ?? 0 },
      };
    }
    case 'attack': {
      if (!before.targets || !after.targets || before.targets.size === 0) return undefined;
      // The target removed or hurt counts; a target that died during the swings is gone, which is fine.
      for (const [id, was] of before.targets) {
        const now = after.targets.get(id);
        if (!now || (was.health !== null && now.health !== null && now.health < was.health)) {
          return { effect: 'changed', delta: { target_gone: now ? 0 : 1 } };
        }
      }
      return noEffect(
        { target_gone: 0 },
        `The attack was expected to hurt or remove ${action.target}; it is still there, unhurt.`,
      );
    }
    case 'deposit': {
      const delta = itemDelta(before, after, action.item);
      if (delta === null) return undefined;
      if (delta >= 0) {
        return noEffect(
          { items_lost: 0 },
          `The deposit was expected to move ${action.count} ${action.item} into the container; you lost 0.`,
        );
      }
      return {
        effect: -delta < action.count ? 'partial' : 'changed',
        delta: { items_lost: -delta },
      };
    }
    case 'withdraw': {
      const delta = itemDelta(before, after, action.item);
      if (delta === null) return undefined;
      if (delta <= 0) {
        return noEffect(
          { items_gained: 0 },
          `The withdraw was expected to take ${action.count} ${action.item} from the container; you gained 0.`,
        );
      }
      return {
        effect: delta < action.count ? 'partial' : 'changed',
        delta: { items_gained: delta },
      };
    }
    case 'open': {
      // The handler reports the window's contents only when a window opened.
      if (Array.isArray(detail.contents))
        return { effect: 'changed', delta: { windows_opened: 1 } };
      return noEffect(
        { windows_opened: 0 },
        'The open was expected to open a container window; none opened.',
      );
    }
    case 'write_sign': {
      const lost = lostTotal(before, after);
      const lines = Array.isArray(detail.lines) ? detail.lines.length : 0;
      if (lost === null) return undefined;
      if (lost <= 0 || lines === 0) {
        return noEffect(
          { signs_written: 0 },
          'The write_sign was expected to place a sign with your text; no sign was used up.',
        );
      }
      return { effect: 'changed', delta: { signs_written: 1 } };
    }
    case 'sleep': {
      // Already in bed before the action: nothing to enter.
      if (before.sleeping !== false || after.sleeping === null) return undefined;
      if (!after.sleeping) {
        return noEffect(
          { slept: 0 },
          'The sleep was expected to put you in a bed; you are not asleep.',
        );
      }
      return { effect: 'changed', delta: { slept: 1 } };
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
