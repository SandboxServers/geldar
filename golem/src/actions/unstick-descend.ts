/**
 * The `dig_descend` rung (decision 0333): a high ledge with no safe drop is dug down through its own floor,
 * one block a step. Each step digs the block under the feet, so the Body falls one block into the shaft it
 * made, and the column is checked again before every dig. The rung stops as soon as a walk of
 * `WALKABLE_DROP` blocks or less is open (decision 0183), at the call's time budget, or at the first refusal.
 */
import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import type { Block } from './bot-types.ts';
import { prefetchOwners, protectedReason, refusedByName } from './protected-blocks.ts';
import { DEFAULT_DIAG_SINK } from './stall-diag.ts';
import { handBreakable } from './unstick-cells.ts';
import { EIGHT, fallDamage, HARMFUL, isSoft, planMoves, scanDrop } from './unstick-plan.ts';
import { DIG_BUDGET_S, digSeconds, timeLeftS } from './unstick-up.ts';

/** The most blocks one high_ledge call digs down. A ledge is about ten blocks; the rung never digs deeper than this. */
export const MAX_DESCEND_DIGS = 12;
/** Health the Body keeps after a descent (the controlled dig-down margin of unstick.ts). */
const DESCENT_MARGIN = 2;
/** A walk this shallow (or a level step) is open: the rung stops there and the walk rung takes it. */
export const WALKABLE_DROP = 3;
/** A hostile mob this close (in blocks) stops the descent. */
const HOSTILE_RANGE = 8;
/** Ticks (at timeScale 1) the Body may take to land after one dig: a 3-block fall takes about 9 ticks. */
const FALL_MAX_TICKS = 20;
/** Vertical speed (blocks a tick) under which a landed Body counts as at rest. */
const LANDED_SPEED = 0.01;
/** The lowest block row of the world. */
const WORLD_BOTTOM = -64;
/** Blocks that fall when the block under them is gone. */
const FALLS_IF_UNSUPPORTED = /(sand|gravel|concrete_powder)$/;
/** Blocks the Body must not land on (or in) from the dig: the harmful set of unstick plus the sticky, soft and flame blocks. */
const UNSAFE_LANDING = new Set([
  ...HARMFUL,
  'campfire',
  'soul_campfire',
  'powder_snow',
  'cobweb',
  'slime_block',
  'honey_block',
  'hay_block',
  'water',
]);
/** Block names that are open air: the fall passes through them. */
const AIR_NAMES = new Set(['air', 'cave_air', 'void_air']);
/** The four horizontal sides of a cell. */
const SIDES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** Why one dig is refused. Each refusal is logged once by reason (operator log only). */
export const REFUSAL_TEXT = {
  lava: 'lava is by the dig or in the fall',
  water: 'water is by the dig or in the fall',
  void: 'the fall would reach a void',
  unloaded: 'a cell the dig reads is not loaded',
  ownership: "the block is someone else's work",
  hostile: `a hostile mob is within ${HOSTILE_RANGE} blocks`,
  gravel: 'gravel or sand is above the head',
  undiggable: 'the block cannot be dug by hand',
  fall: 'the fall would leave the Body under its health margin, or no landing is within three blocks',
  landing: 'the fall would land on a block that is not safe to stand on',
  'cap reached': "this call's dig budget is spent",
} as const;
export type Refusal = keyof typeof REFUSAL_TEXT;
/** The stop when the Body has not landed within the fall bound after a dig (a stop, not a refusal). */
export const NOT_LANDED_TEXT = 'the Body had not landed within the fall bound';

/** What the rung did: how many blocks it dug, whether a walk is open now, and a fact about the stop. */
export interface DescendResult {
  dug: number;
  walkable: boolean;
  stopped: string;
}

export interface DescendDeps {
  bot: Bot;
  signal: AbortSignal;
  /** The call's start time (ms), which the time budget counts from. */
  started: number;
  /** Digs one block with unstick's `dig` (protection checked, abort honoured). */
  digOne: (block: Block, at: Vec3) => Promise<boolean>;
  /** The most blocks this call may dig: the call's own budget for an ordinary run; default `MAX_DESCEND_DIGS`. */
  maxDigs?: number;
  /** The call's time scale (as `unstick` uses it for its deadline): scales the fall bound. Default 1. */
  timeScale?: number;
}

/** Digs the floor under the feet one block at a time until a walk of `WALKABLE_DROP` or less is open. */
export async function digDescend(deps: DescendDeps): Promise<DescendResult> {
  const { bot, signal, started, digOne } = deps;
  const maxDigs = deps.maxDigs ?? MAX_DESCEND_DIGS;
  let dug = 0;
  for (;;) {
    if (signal.aborted) return { dug, walkable: false, stopped: 'the call was stopped' };
    const feet = bot.entity.position.floored();
    if (openWalk(bot, feet)) {
      return { dug, walkable: true, stopped: `a walk of ${WALKABLE_DROP} blocks or less is open` };
    }
    if (dug >= maxDigs) return refuse('cap reached', dug);
    const refusal = await refusalAt(bot, feet, signal);
    if (refusal !== null) return refuse(refusal, dug);
    const floor = feet.offset(0, -1, 0);
    const block = bot.blockAt(floor) as Block;
    const cost = digSeconds(bot, block);
    if (cost > DIG_BUDGET_S || cost > timeLeftS(started)) {
      return { dug, walkable: false, stopped: 'the time budget is spent' };
    }
    if (!(await digOne(block, floor))) {
      return { dug, walkable: false, stopped: 'the dig did not complete' };
    }
    dug++;
    if (!(await waitForLanding(bot, signal, deps.timeScale ?? 1))) {
      const stopped = signal.aborted ? 'the call was stopped' : NOT_LANDED_TEXT;
      return { dug, walkable: false, stopped };
    }
    const after = bot.entity.position.floored();
    if (after.y >= feet.y) return { dug, walkable: false, stopped: 'the Body did not fall' };
    const remaining = remainingDrop(bot, after);
    DEFAULT_DIAG_SINK.log(
      JSON.stringify({ event: 'unstick_descend_step', block: block.name, remaining, step: dug }),
    );
  }
}

/**
 * Waits for the Body to land after a dig: at least one tick (the fall starts on the next physics tick), then one
 * tick at a time until it is on the ground, up to the bound. False when it has not landed in time or the call
 * was stopped. A tick in the air is never read as a refusal: the caller only looks at the cell after this.
 */
async function waitForLanding(bot: Bot, signal: AbortSignal, timeScale: number): Promise<boolean> {
  const bound = Math.ceil(FALL_MAX_TICKS * timeScale);
  for (let ticks = 1; ; ticks++) {
    await bot.waitForTicks(1);
    if (landed(bot)) return true;
    if (ticks >= bound || signal.aborted) return false;
  }
}

/** True when the Body stands on a block with no fall speed left. */
function landed(bot: Bot): boolean {
  return bot.entity.onGround === true && Math.abs(bot.entity.velocity?.y ?? 0) < LANDED_SPEED;
}

/** The shallowest drop from the feet to a landing, over the eight directions (capped by `scanDrop`). */
function remainingDrop(bot: Bot, feet: Vec3): number {
  return Math.min(
    ...EIGHT.map(
      (dir) => scanDrop((cell) => bot.blockAt(cell), feet.plus(dir).offset(0, -1, 0)).blocks,
    ),
  );
}

/** True when a walk (level, a step up, or a drop of `WALKABLE_DROP` or less) is open from the feet. */
function openWalk(bot: Bot, feet: Vec3): boolean {
  const moves = planMoves((cell) => bot.blockAt(cell), feet, bot.health ?? 20);
  return moves.some((move) => move.drop <= WALKABLE_DROP);
}

/** Logs the refusal by reason (operator only) and returns the stop it causes. */
function refuse(reason: Refusal, dug: number): DescendResult {
  DEFAULT_DIAG_SINK.log(JSON.stringify({ event: 'unstick_descend_refused', reason }));
  return { dug, walkable: false, stopped: REFUSAL_TEXT[reason] };
}

/** The first refusal for the dig under the feet, or null when the dig may go ahead. */
async function refusalAt(bot: Bot, feet: Vec3, signal: AbortSignal): Promise<Refusal | null> {
  const floor = feet.offset(0, -1, 0);
  const block = bot.blockAt(floor) as Block | null;
  if (block === null) return 'unloaded';
  if (hostileWithin(bot, feet)) return 'hostile';
  if (FALLS_IF_UNSUPPORTED.test(bot.blockAt(feet.offset(0, 2, 0))?.name ?? '')) return 'gravel';
  const column = columnRefusal(bot, feet);
  if (column !== null) return column;
  // The Body falls through the dug cell onto the first block below it. That landing must be solid and safe
  // to stand on, within WALKABLE_DROP blocks of the floor (the fall is the landing's depth), and the fall
  // must leave the health margin.
  const landing = landingBelow(bot, floor);
  if (landing === null) return 'fall';
  if (!landing.solid || UNSAFE_LANDING.has(landing.name)) return 'landing';
  if (fallDamage(landing.depth) > (bot.health ?? 20) - DESCENT_MARGIN) return 'fall';
  const digable = isSoft(block) || (handBreakable(block) && !refusedByName(block.name));
  if (block.boundingBox === 'empty' || !digable) return 'undiggable';
  await prefetchOwners([floor], signal);
  return protectedReason(bot, block, floor) === null ? null : 'ownership';
}

/**
 * The first block that is not air, 1 to `WALKABLE_DROP` cells below the dug floor, with its depth below the
 * floor (the fall in blocks) and whether it is solid. Null when every one of those cells is air or unloaded.
 */
function landingBelow(
  bot: Bot,
  floor: Vec3,
): { depth: number; name: string; solid: boolean } | null {
  for (let depth = 1; depth <= WALKABLE_DROP; depth++) {
    const block = bot.blockAt(floor.offset(0, -depth, 0)) as Block | null;
    if (block === null) return null;
    if (!AIR_NAMES.has(block.name)) {
      return { depth, name: block.name, solid: block.boundingBox !== 'empty' };
    }
  }
  return null;
}

/**
 * The fall column: lava beside the feet (the cell the Body stands on), then the dug cell and every cell
 * below it down to the first solid block. Each cell is checked for lava, water, a void and an unloaded
 * read, and so are its four sides (liquid beside a soft block counts too).
 */
function columnRefusal(bot: Bot, feet: Vec3): Refusal | null {
  for (const [dx, dy, dz] of SIDES) {
    if (bot.blockAt(feet.offset(dx, dy, dz))?.name === 'lava') return 'lava';
  }
  for (let depth = 0; ; depth++) {
    const cell = feet.offset(0, -1 - depth, 0);
    if (cell.y < WORLD_BOTTOM) return 'void';
    const block = bot.blockAt(cell) as Block | null;
    if (block === null) return 'unloaded';
    if (block.name === 'lava') return 'lava';
    if (block.name === 'water') return 'water';
    for (const [dx, dy, dz] of SIDES) {
      const side = bot.blockAt(cell.offset(dx, dy, dz)) as Block | null;
      if (side === null) return 'unloaded';
      if (side.name === 'lava') return 'lava';
      if (side.name === 'water') return 'water';
    }
    if (depth > 0 && block.boundingBox !== 'empty') return null;
  }
}

/** True when a hostile mob is within `HOSTILE_RANGE` blocks of the feet. */
function hostileWithin(bot: Bot, feet: Vec3): boolean {
  return Object.values(bot.entities ?? {}).some(
    (entity) => entity.type === 'hostile' && entity.position.distanceTo(feet) <= HOSTILE_RANGE,
  );
}
