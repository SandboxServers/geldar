import { Vec3 } from 'vec3';
import type { Position } from './bot-types.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import {
  digSideCell,
  edgeCell,
  entityInCell,
  pillarStep,
  placeAgainst,
  sideDigCell,
} from './pillar.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** Cells a placement may replace: the target cell must hold one of these. */
export const REPLACEABLE = new Set([
  'air',
  'cave_air',
  'void_air',
  'water',
  'short_grass',
  'tall_grass',
  'fern',
  'snow',
]);
/** Farther than this from the target, the bot walks closer first. */
const REACH = 4.5;
/** How close `moveNear` brings the bot to the target. */
const WALK_RANGE = 3;
/** Wall-clock wait for a pillar's bot to land, scaled by `timeScale`. */
const LAND_WAIT_MS = 1000;
/** Wall-clock bound on the step onto a block's edge before a pillar, scaled by `timeScale`. */
const EDGE_WAIT_MS = 1000;
/** Reference candidates for a block at a position, in the order they are tried. */
const NEIGHBOR_OFFSETS: readonly Vec3[] = [
  new Vec3(0, -1, 0),
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
  new Vec3(0, 1, 0),
];
/** The four horizontal steps, in a fixed order. */
const CARDINALS: readonly Vec3[] = [
  new Vec3(1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, -1),
];
/** Fixed failure texts shown to the model: each states what happened, without advice (decision 0154: facts, never advice). */
const MESSAGE = {
  noSpace: 'no free space next to you',
  insideBlock: 'you are inside a block',
  occupied: 'target is occupied',
  notLoaded: 'target is not loaded',
  noReference: 'no solid block to place against',
  noGround: 'no solid block under your feet to build on',
  notGrounded: 'you are not on the ground',
  headroom: 'no headroom for a pillar: the two cells above your head are not clear',
  entityInCell: 'another entity stands where the block goes',
  notRisen: 'you did not rise onto the block',
  refused: 'the server refused the placement',
  unconfirmed: 'the block did not appear at the target',
  timeout: 'the server did not answer the placement',
} as const;
/** The pillar's log goes nowhere here: the ladder owns the stall diagnostics. */
const SILENT = { log: () => undefined, now: () => 0 };

/** Where the block goes: a position, or `'feet'` for the cell the bot's feet are in (decision 0031). */
type Spot = { x: number; y: number; z: number } | 'feet';
type Bot = ActionContext['bot'];

/** Places a block from the inventory, held in the hand, at a position or at the bot's feet. */
export const placeAction: ActionHandler<'place'> = {
  kind: 'place',
  timeoutMs: 30_000,
  run: (ctx, action) => place(ctx, action.block, action.at),
};

/** The index of the first solid candidate, in the order given; null when none is solid. */
export function pickReference(solid: readonly boolean[]): number | null {
  const index = solid.indexOf(true);
  return index === -1 ? null : index;
}

/** True when the cell now holds `block`, or its wall form (a torch placed on a side face). */
export function confirmsPlacement(name: string, block: string): boolean {
  return name === block || name.replace('wall_', '') === block;
}

async function place(ctx: ActionContext, block: string, at: Spot): Promise<ActionOutcome> {
  const { bot } = ctx;
  const stack = bot.inventory.items().find((item) => item.name === block);
  if (!stack) return failed('missing_materials', `no ${block} in the inventory`);
  const boundingBox = bot.registry.blocksByName[block]?.boundingBox;
  if (boundingBox === undefined) return failed('not_possible', `${block} is not a block`);

  const feetCell = floor(bot.entity.position);
  const named = at === 'feet' ? null : new Vec3(at.x, at.y, at.z);
  // A position equal to the feet cell is the feet spot for a solid block (decision 0160).
  const atFeet = named === null || (boundingBox !== 'empty' && named.equals(feetCell));
  let target = named === null || atFeet ? feetCell : named;
  const targetCell = bot.blockAt(target);
  if (!targetCell) return failed('not_possible', MESSAGE.notLoaded);
  if (!REPLACEABLE.has(targetCell.name)) return failed('blocked', MESSAGE.occupied);

  // A solid block at feet is a pillar: the bot jumps and places it in the cell its feet were in
  // (decision 0160). A bed keeps the beside path.
  const pillarAtFeet = atFeet && boundingBox !== 'empty' && !block.endsWith('_bed');
  // A solid block on the bot's own cells moves to the first free cell beside the bot.
  let beside: { target: Vec3; step: Vec3 } | null = null;
  if (!pillarAtFeet && boundingBox !== 'empty' && inBody(bot, target)) {
    beside = freeBeside(bot, floor(bot.entity.position), block.endsWith('_bed'));
    if (!beside) return failed('blocked', MESSAGE.noSpace);
    target = beside.target;
  }

  if (bot.entity.position.distanceTo(target) > REACH) {
    const move = await moveNear(bot, target, WALK_RANGE, {
      signal: ctx.signal,
      timeScale: ctx.timeScale,
    });
    if (!move.ok) return outcomeOfMove(move);
    // A partial walk stopped short. The server drops a placement from out of reach without answering it.
    if (move.partial) {
      return failed('blocked', 'the target is out of reach');
    }
  }
  if (ctx.signal.aborted) return cancelled();

  // The bot's own body is the two cells from its feet up; a colliding block there blocks the placement.
  const body = floor(bot.entity.position);
  for (const dy of [0, 1]) {
    const cell = bot.blockAt(new Vec3(body.x, body.y + dy, body.z));
    if (cell && cell.boundingBox !== 'empty') return failed('blocked', MESSAGE.insideBlock);
  }

  if (pillarAtFeet) return pillarPlace(ctx, stack, block, target);

  // At `feet` the reference is the block below; otherwise the first solid neighbor in order.
  const candidates =
    atFeet && !beside
      ? [target.offset(0, -1, 0)]
      : NEIGHBOR_OFFSETS.map((o) => target.offset(o.x, o.y, o.z));
  const cells = candidates.map((position) => bot.blockAt(position));
  // Every solid neighbour is a reference in turn: one can be out of sight or refused by the server.
  const solidAt = cells.flatMap((cell, i) => (cell?.boundingBox === 'block' ? [i] : []));
  if (pickReference(cells.map((cell) => cell?.boundingBox === 'block')) === null) {
    return failed('blocked', MESSAGE.noReference);
  }

  if (bot.heldItem?.name !== block) {
    await bot.equip(stack, 'hand');
    if (ctx.signal.aborted) return cancelled();
  }

  // A bed's head goes the way the bot faces, so the bot turns toward the cell it moved to.
  if (beside && block.endsWith('_bed')) {
    await bot.look(Math.atan2(-beside.step.x, beside.step.z), 0, true);
    if (ctx.signal.aborted) return cancelled();
  }

  let last: ActionOutcome = failed('blocked', MESSAGE.noReference);
  for (const i of solidAt) {
    if (ctx.signal.aborted) return cancelled();
    const reference = cells[i];
    const referencePos = candidates[i];
    if (!reference || !referencePos) continue;
    const face = new Vec3(
      target.x - referencePos.x,
      target.y - referencePos.y,
      target.z - referencePos.z,
    );
    try {
      await placeAgainst(bot, reference, face);
    } catch (error) {
      const message = errorText(error);
      if (/did not answer the placement|did not fire within timeout/.test(message)) {
        return failed('timeout', MESSAGE.timeout);
      }
      if (/refused to place/.test(message)) {
        last = failed('blocked', MESSAGE.refused);
        continue;
      }
      throw error;
    }
    if (ctx.signal.aborted) return cancelled();

    // Only the target block is checked: a bed placed here also makes a second block.
    const placed = bot.blockAt(target)?.name ?? '';
    if (!confirmsPlacement(placed, block)) {
      last = failed('blocked', MESSAGE.unconfirmed);
      continue;
    }
    return completed({ block, at: spot(target), reference: spot(referencePos) });
  }
  return last;
}

/**
 * Pillars a solid block up into the cell the feet are in: the bot must stand on the ground over a
 * solid block, and completes only when the block is placed there and the bot ends a block higher.
 */
async function pillarPlace(
  ctx: ActionContext,
  stack: unknown,
  block: string,
  feet: Vec3,
): Promise<ActionOutcome> {
  const { bot } = ctx;
  if (!bot.entity.onGround) {
    await waitForLanding(ctx);
    if (ctx.signal.aborted) return cancelled();
    if (!bot.entity.onGround) return failed('blocked', MESSAGE.notGrounded);
  }
  // Over air with solid ground beside the feet: the bot first steps onto that ground's edge cell.
  let cell = feet;
  if (bot.blockAt(feet.offset(0, -1, 0))?.boundingBox !== 'block') {
    const edge = await stepToEdge(ctx, feet);
    if (ctx.signal.aborted) return cancelled();
    if (!edge) return failed('blocked', MESSAGE.noGround);
    cell = edge;
  }
  const refusals: string[] = [];
  let result = await pillarStep(bot, stack, { signal: ctx.signal, sink: SILENT }, refusals);
  // Another ranger's box in the feet cell: step to a free neighbour and pillar there, which re-runs the checks.
  if (!result.ok && result.why === 'entity') {
    const beside = await stepToEdge(ctx, cell);
    if (ctx.signal.aborted) return cancelled();
    if (beside) {
      cell = beside;
      result = await pillarStep(bot, stack, { signal: ctx.signal, sink: SILENT }, refusals);
    } else {
      // No free neighbour (a 1-wide shaft): dig a side cell, step into it, and pillar there.
      const side = sideDigCell(bot, cell);
      const dug =
        side !== null && (await digSideCell(bot, cell, side, { signal: ctx.signal, sink: SILENT }));
      if (ctx.signal.aborted) return cancelled();
      const climb = dug ? await stepToEdge(ctx, cell) : null;
      if (ctx.signal.aborted) return cancelled();
      if (climb) {
        cell = climb;
        result = await pillarStep(bot, stack, { signal: ctx.signal, sink: SILENT }, refusals);
      }
    }
  }
  // Unsafe headroom above the feet cell: step to a neighbour whose own headroom is clear, and pillar there.
  if (!result.ok && result.why === 'headroom') {
    const beside = await stepToEdge(ctx, cell, true);
    if (ctx.signal.aborted) return cancelled();
    if (beside) {
      cell = beside;
      result = await pillarStep(bot, stack, { signal: ctx.signal, sink: SILENT }, refusals);
    }
  }
  const below = cell.offset(0, -1, 0);
  if (result.ok) {
    if (!confirmsPlacement(bot.blockAt(cell)?.name ?? '', block)) {
      return failed('blocked', MESSAGE.unconfirmed);
    }
    return completed({ block, at: spot(cell), reference: spot(below) });
  }
  if (result.why === 'aborted') return cancelled();
  if (result.why === 'headroom') {
    return failed('blocked', refusals[refusals.length - 1] ?? MESSAGE.headroom);
  }
  if (result.why === 'entity') return failed('blocked', MESSAGE.entityInCell);
  if (result.why === 'unplaced') return failed('blocked', unplacedMessage(result.error));
  return failed('blocked', MESSAGE.notRisen);
}

/**
 * Says why the pillar's block did not go down, in our own words: the library's text carries
 * coordinates, ms and event names, which the agent must not see. A refusal names the block still there.
 */
function unplacedMessage(error: string | undefined): string {
  const still = /the block is still ([a-z_]+)/i.exec(error ?? '');
  if (still && /refused to place/i.test(error ?? '')) {
    const name = (still[1] ?? '').replace(/_/g, ' ').slice(0, 80);
    return `the server did not place the block: it is still ${name}`;
  }
  if (/did not answer|did not fire|timed out|timeout/i.test(error ?? '')) {
    return 'the server did not answer the placement';
  }
  return 'the server did not place the block';
}

/** Waits for the bot to land, up to `LAND_WAIT_MS` of wall time; stops early on abort. */
async function waitForLanding(ctx: ActionContext): Promise<void> {
  const deadline = Date.now() + LAND_WAIT_MS * ctx.timeScale;
  while (!ctx.bot.entity.onGround && !ctx.signal.aborted && Date.now() < deadline) {
    await ctx.bot.waitForTicks(1);
  }
}

/**
 * Walks onto the edge cell beside `feet` (see `edgeCell`), to its centre, within `EDGE_WAIT_MS` of
 * wall time. Returns that cell when the bot stands in it on the ground, else null.
 */
async function stepToEdge(
  ctx: ActionContext,
  feet: Vec3,
  needHeadroom = false,
): Promise<Vec3 | null> {
  const { bot, signal, timeScale } = ctx;
  const edge = edgeCell(bot, feet, needHeadroom);
  if (!edge) return null;
  const bound = new AbortController();
  const stop = () => bound.abort();
  const timer = setTimeout(stop, EDGE_WAIT_MS * timeScale);
  signal.addEventListener('abort', stop, { once: true });
  try {
    await moveNear(bot, edge.offset(0.5, 0, 0.5), 0.5, { signal: bound.signal, timeScale });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
  const reached = bot.entity.position.floored();
  return reached.equals(edge) && bot.entity.onGround ? edge : null;
}

/** True when the cell is the bot's feet cell or the cell above it. */
function inBody(bot: Bot, cell: Vec3): boolean {
  const feet = floor(bot.entity.position);
  return cell.equals(feet) || cell.equals(feet.offset(0, 1, 0));
}

/**
 * The first cell beside the bot, in facing order, that is open and has a solid neighbor. A bed
 * also needs the cell one further on, where its second half goes.
 */
function freeBeside(bot: Bot, body: Vec3, bed: boolean): { target: Vec3; step: Vec3 } | null {
  for (const step of stepsFromFacing(bot.entity.yaw)) {
    const cell = body.plus(step);
    if (!isFree(bot, cell)) continue;
    if (bed && !isOpen(bot, cell.plus(step))) continue;
    return { target: cell, step };
  }
  return null;
}

/** The cardinal step the bot faces, then the other three in their fixed order. */
function stepsFromFacing(yaw: number): Vec3[] {
  const dx = -Math.sin(yaw);
  const dz = Math.cos(yaw);
  const facing =
    Math.abs(dx) > Math.abs(dz) ? new Vec3(Math.sign(dx), 0, 0) : new Vec3(0, 0, Math.sign(dz));
  return [facing, ...CARDINALS.filter((step) => !step.equals(facing))];
}

/** True when a block may replace the cell and no entity's box overlaps it. */
function isOpen(bot: Bot, cell: Vec3): boolean {
  const name = bot.blockAt(cell)?.name;
  return name !== undefined && REPLACEABLE.has(name) && !entityInCell(bot, cell);
}

/** True when the cell is open and one of its neighbors is solid to place against. */
function isFree(bot: Bot, cell: Vec3): boolean {
  return (
    isOpen(bot, cell) &&
    NEIGHBOR_OFFSETS.some((o) => bot.blockAt(cell.plus(o))?.boundingBox === 'block')
  );
}

/** The cell a position is in. */
function floor(position: Vec3): Vec3 {
  return new Vec3(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z));
}

/** A plain position for the outcome detail. */
function spot(position: Vec3): Position {
  return { x: position.x, y: position.y, z: position.z };
}
