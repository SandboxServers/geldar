import type { Bot } from 'mineflayer';

/**
 * The blocks this Body placed itself (decision 0164, review F10). Its own work is not someone else's,
 * so `goto` and the escape ladder may dig it, even when its type is built material (its own
 * cobblestone scaffold). Held in memory, per bot. A record ends when the block at its cell changes to
 * something else (a `blockUpdate`): a dug or replaced block is no longer the bot's work.
 */

/** A cell as the world gives it. */
export interface Cell {
  x: number;
  y: number;
  z: number;
}

/** The records per bot: a cell key to the block name the bot placed there. */
const records = new WeakMap<object, Map<string, string>>();
/** The bots whose `blockUpdate` is already watched. */
const watched = new WeakSet<object>();

const keyOf = (cell: Cell): string => `${cell.x},${cell.y},${cell.z}`;

/** Watches the bot's block updates once: a cell that changes to another block ends its record. */
function watch(bot: Bot): void {
  if (watched.has(bot)) return;
  watched.add(bot);
  const emitter = bot as unknown as {
    on?: (event: string, fn: (...args: unknown[]) => void) => void;
  };
  emitter.on?.('blockUpdate', (_old: unknown, now: unknown) => {
    const block = now as { name?: string; position?: Cell } | null;
    if (!block?.position) return;
    const table = records.get(bot);
    const key = keyOf(block.position);
    const placed = table?.get(key);
    if (table && placed !== undefined && block.name !== placed) table.delete(key);
  });
}

/** Records that this bot placed `name` at `cell`. */
export function recordOwnPlacement(bot: Bot, cell: Cell, name: string): void {
  watch(bot);
  let table = records.get(bot);
  if (!table) {
    table = new Map();
    records.set(bot, table);
  }
  table.set(keyOf(cell), name);
}

/** True while the block at `cell` is still the one this bot placed there. */
export function isOwnPlacement(bot: Bot, cell: Cell): boolean {
  return records.get(bot)?.has(keyOf(cell)) ?? false;
}

/** The cell a placement lands in: the reference block's cell plus the face's offset, or null. */
export function placedCell(reference: unknown, face: unknown): Cell | null {
  const pos = (reference as { position?: Cell } | null | undefined)?.position;
  const dir = face as Cell | null | undefined;
  if (!pos || !dir) return null;
  return { x: pos.x + dir.x, y: pos.y + dir.y, z: pos.z + dir.z };
}
