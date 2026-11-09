import type { Container } from './bot-types.ts';
import type { ActionContext } from './registry.ts';

/**
 * Item transfers between a chest window and the player's inventory, done with explicit clicks.
 *
 * Mineflayer's `withdraw` and `deposit` do not wait for the server on a chest click (its click
 * confirmation is keyed to one stateId shared by every window), so the next click acts on a client
 * view the server may not have caught up with, and a whole stack can be lost on the cursor. Here every
 * click is followed by a sync click (stateId -1), which the server always answers with the full
 * window: that answer is the barrier. The click is predicted on a model of the slots and the cursor,
 * and the window after the barrier must equal the model, else the transfer stops and puts the cursor
 * back. An accepted click gets no reply of its own, so waiting for a per-click packet would hang.
 */

/** A stack in a slot or on the cursor. */
interface Stack {
  type: number;
  count: number;
}

/** A slot: a stack, or null when empty. */
type Cell = Stack | null;

/** The predicted client view: every slot of the window and the cursor. */
interface Model {
  slots: Cell[];
  cursor: Cell;
}

/** Which way the items move. */
export type TransferDirection = 'withdraw' | 'deposit';

/** How a transfer ended: an error text when it stopped short, and whether the signal aborted it. */
export interface TransferEnd {
  error: string | null;
  aborted: boolean;
}

/** The protocol client methods used here: Mineflayer's `bot._client`. */
interface TransferClient {
  on(event: string, listener: (packet: unknown) => void): unknown;
  removeListener(event: string, listener: (packet: unknown) => void): unknown;
  write(name: string, params: Record<string, unknown>): void;
}

/** The `window_items` and `set_slot` fields read here. */
interface WindowPacket {
  windowId: number;
  stateId: number;
}

/** Wall-clock wait for the barrier after one click, scaled by `timeScale`. */
const BARRIER_WAIT_MS = 3_000;
/** How many times the cursor restore retries a click that did not land. */
const RESTORE_TRIES = 3;
/** Stack size used when the registry does not know the item. */
const DEFAULT_STACK = 64;

/** Everything one transfer shares: the window, the client, the stateId and the predicted view. */
interface Session {
  ctx: ActionContext;
  client: TransferClient;
  container: Container;
  windowId: number;
  stateId: number;
  model: Model;
  /** The slot the stack on the cursor came from. */
  origin: number;
  /** Set when the window stopped matching the prediction. */
  fault: string | null;
  /** Set while the cursor is put back, when the signal no longer stops the clicks. */
  restoring: boolean;
}

/** The protocol's hashed form of a stack. Items with components would need real hashes. */
function hashed(cell: Cell): Record<string, unknown> | null {
  if (!cell) return null;
  return { itemId: cell.type, itemCount: cell.count, components: [], removeComponents: [] };
}

/** The window's own view as a model. */
function readModel(container: Container): Model {
  const cell = (item: { type: number; count: number } | null | undefined): Cell =>
    item ? { type: item.type, count: item.count } : null;
  const slots: Cell[] = [];
  for (let i = 0; i < container.slots.length; i++) slots.push(cell(container.slots[i]));
  return { slots, cursor: cell(container.selectedItem) };
}

/** True when two cells hold the same stack. */
function sameCell(a: Cell, b: Cell): boolean {
  if (a === null || b === null) return a === b;
  return a.type === b.type && a.count === b.count;
}

/** The index of the first slot that differs between the model and the window, or -1. */
function firstMismatch(a: Model, b: Model): number {
  if (!sameCell(a.cursor, b.cursor)) return -2;
  const n = Math.max(a.slots.length, b.slots.length);
  for (let i = 0; i < n; i++) if (!sameCell(a.slots[i] ?? null, b.slots[i] ?? null)) return i;
  return -1;
}

/** The stack limit of an item. */
function stackLimit(s: Session, type: number): number {
  return s.ctx.bot.registry.items[type]?.stackSize ?? DEFAULT_STACK;
}

/** Applies a left (0) or right (1) click on a slot to the model, as the server would. */
function applyClick(s: Session, slot: number, button: 0 | 1): void {
  const { slots } = s.model;
  const cursor = s.model.cursor;
  const here = slots[slot] ?? null;
  if (!cursor) {
    if (!here) return;
    const take = button === 0 ? here.count : Math.ceil(here.count / 2);
    s.model.cursor = { type: here.type, count: take };
    slots[slot] = take === here.count ? null : { type: here.type, count: here.count - take };
    return;
  }
  const put = button === 0 ? cursor.count : 1;
  if (!here) {
    slots[slot] = { type: cursor.type, count: put };
  } else if (here.type === cursor.type) {
    const moved = Math.min(put, stackLimit(s, here.type) - here.count);
    slots[slot] = { type: here.type, count: here.count + moved };
    s.model.cursor =
      cursor.count - moved > 0 ? { type: cursor.type, count: cursor.count - moved } : null;
    return;
  } else {
    slots[slot] = cursor;
    s.model.cursor = here;
    return;
  }
  s.model.cursor = cursor.count - put > 0 ? { type: cursor.type, count: cursor.count - put } : null;
}

/**
 * Writes the sync click and waits for the window's full answer. Returns false when the answer did not
 * come within the bounded wait. The listener is armed before the write: a reply may be synchronous.
 */
function barrier(s: Session): Promise<boolean> {
  return new Promise((resolve) => {
    const { client, windowId } = s;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onItems = (packet: unknown): void => {
      if ((packet as WindowPacket).windowId !== windowId) return;
      clearTimeout(timer);
      client.removeListener('window_items', onItems);
      resolve(true);
    };
    client.on('window_items', onItems);
    timer = setTimeout(() => {
      client.removeListener('window_items', onItems);
      resolve(false);
    }, BARRIER_WAIT_MS * s.ctx.timeScale);
    client.write('window_click', {
      windowId,
      stateId: -1,
      slot: -999,
      mouseButton: 2,
      mode: 5,
      changedSlots: [],
      cursorItem: hashed(s.model.cursor),
    });
  });
}

/**
 * One click: predict it, send it with the window's stateId, wait for the barrier, and require the
 * window to equal the prediction. On a mismatch the model becomes the window's truth and `fault` is set.
 */
async function click(s: Session, slot: number, button: 0 | 1): Promise<boolean> {
  if (!s.restoring && s.ctx.signal.aborted) {
    s.fault = 'aborted';
    return false;
  }
  const before = s.model.slots.slice();
  applyClick(s, slot, button);
  const changedSlots: { location: number; item: Record<string, unknown> | null }[] = [];
  for (let i = 0; i < s.model.slots.length; i++) {
    if (!sameCell(before[i] ?? null, s.model.slots[i] ?? null)) {
      changedSlots.push({ location: i, item: hashed(s.model.slots[i] ?? null) });
    }
  }
  s.client.write('window_click', {
    windowId: s.windowId,
    stateId: s.stateId,
    slot,
    mouseButton: button,
    mode: 0,
    changedSlots,
    cursorItem: hashed(s.model.cursor),
  });
  const answered = await barrier(s);
  const actual = readModel(s.container);
  if (!answered) {
    s.model = actual;
    s.fault = 'server did not confirm a transfer click';
    return false;
  }
  if (firstMismatch(s.model, actual) !== -1) {
    s.model = actual;
    s.fault = 'window does not match the predicted click';
    return false;
  }
  return true;
}

/** True when a slot can take the cursor's stack whole. */
function takesCursor(s: Session, slot: number): boolean {
  const cursor = s.model.cursor;
  const here = s.model.slots[slot] ?? null;
  if (!cursor) return false;
  if (!here) return true;
  return here.type === cursor.type && here.count + cursor.count <= stackLimit(s, here.type);
}

/**
 * Puts the cursor back: first its origin slot, else any slot of the window that takes it whole. It
 * ignores the signal, so an abort still leaves the cursor empty. Bounded: it gives up after a few tries.
 */
async function restoreCursor(s: Session): Promise<void> {
  s.restoring = true;
  for (let attempt = 0; attempt < RESTORE_TRIES && s.model.cursor; attempt++) {
    let target = takesCursor(s, s.origin) ? s.origin : -1;
    for (let i = 0; target < 0 && i < s.model.slots.length; i++) {
      if (takesCursor(s, i)) target = i;
    }
    if (target < 0) return;
    await click(s, target, 0);
  }
}

/** The slots of the window in a range holding the item, or fitting it. */
function slotsIn(s: Session, start: number, end: number, test: (c: Cell) => boolean): number[] {
  const found: number[] = [];
  for (let i = start; i < end; i++) if (test(s.model.slots[i] ?? null)) found.push(i);
  return found;
}

/**
 * Moves up to `count` of an item from one slot range to the other. Returns null when all moved, an
 * error text otherwise, or 'aborted'. Each stack is picked up whole, placed in the destinations
 * (a left click for the whole cursor, else one right click per item), and the rest put back.
 */
async function moveStacks(
  s: Session,
  itemId: number,
  count: number,
  from: [number, number],
  to: [number, number],
): Promise<string | null> {
  let left = count;
  const limit = stackLimit(s, itemId);
  while (left > 0) {
    if (s.ctx.signal.aborted) return 'aborted';
    const source = slotsIn(s, from[0], from[1], (c) => c?.type === itemId)[0];
    if (source === undefined) return 'not enough items in the source';
    // Same-type stacks with room first, then empty slots, so stacks fill before new ones start.
    const room = (slot: number): number => {
      const c = s.model.slots[slot] ?? null;
      return c ? limit - c.count : limit;
    };
    const targets = [
      ...slotsIn(s, to[0], to[1], (c) => c?.type === itemId && c.count < limit),
      ...slotsIn(s, to[0], to[1], (c) => c === null),
    ];
    const capacity = targets.reduce((sum, slot) => sum + room(slot), 0);
    if (capacity === 0) return 'destination full';
    const stack = s.model.slots[source] as Stack;
    const take = Math.min(left, stack.count, capacity);
    s.origin = source;
    if (!(await click(s, source, 0))) return s.fault;
    let toPlace = take;
    for (const slot of targets) {
      if (toPlace === 0) break;
      const p = Math.min(room(slot), toPlace);
      if (p === (s.model.cursor?.count ?? 0)) {
        if (!(await click(s, slot, 0))) return s.fault;
      } else {
        for (let i = 0; i < p; i++) if (!(await click(s, slot, 1))) return s.fault;
      }
      toPlace -= p;
    }
    if (s.model.cursor && !(await click(s, source, 0))) return s.fault;
    left -= take;
  }
  return null;
}

/**
 * Moves `count` of an item between the open chest window and the player's inventory with predicted,
 * barrier-confirmed clicks. The cursor is empty when this returns: on an abort, a timeout or a
 * mismatch it is put back, and when that fails the result carries an error. The caller judges the
 * moved count from the window.
 */
export async function transferItems(
  ctx: ActionContext,
  container: Container,
  direction: TransferDirection,
  itemId: number,
  count: number,
): Promise<TransferEnd> {
  const client = ctx.bot._client as unknown as TransferClient | undefined;
  if (!client) return { error: 'no protocol client', aborted: false };
  const s: Session = {
    ctx,
    client,
    container,
    windowId: container.id,
    stateId: -1,
    model: readModel(container),
    origin: 0,
    fault: null,
    restoring: false,
  };
  const track = (packet: unknown): void => {
    const p = packet as WindowPacket;
    if (p.windowId === s.windowId) s.stateId = p.stateId;
  };
  client.on('window_items', track);
  client.on('set_slot', track);
  try {
    // The window's stateId is only known from a packet: learn it before the first click.
    if (!(await barrier(s))) return { error: 'server did not confirm the window', aborted: false };
    s.model = readModel(container);
    const chest: [number, number] = [0, container.inventoryStart];
    const inventory: [number, number] = [container.inventoryStart, container.inventoryEnd];
    const [from, to] = direction === 'withdraw' ? [chest, inventory] : [inventory, chest];
    const ended = s.model.cursor
      ? 'cursor not empty'
      : await moveStacks(s, itemId, count, from, to);
    await restoreCursor(s);
    if (s.model.cursor) return { error: 'could not put the cursor stack back', aborted: false };
    if (ended === 'aborted') return { error: null, aborted: true };
    return { error: ended, aborted: false };
  } finally {
    client.removeListener('window_items', track);
    client.removeListener('set_slot', track);
  }
}
