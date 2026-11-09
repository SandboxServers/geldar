import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { afterEach, describe, expect, it } from 'vitest';
import type { Container } from './bot-types.ts';
import { transferItems } from './container-transfer.ts';
import type { ActionContext } from './registry.ts';

type Cell = { type: number; count: number } | null;
const CHEST = 27;
const SIZE = 63;
const STACK = 64;

interface Options {
  /** Milliseconds before the server's window_items reaches the client. */
  latencyMs?: number;
  /** 1-based index of a window click the server silently ignores (a lost click). */
  ignoreClick?: number;
  /** After this many answered syncs the server stops answering. */
  muteAfterSyncs?: number;
  /** 1-based index of a sync whose answer is held back this many ms (later answers queue behind it). */
  lateSync?: { n: number; ms: number };
  /** 1-based index of a click that finds the server's stateId bumped (the client view is stale). */
  bumpAtClick?: number;
  /** 1-based index of a click after which the server closes the window. */
  closeAtClick?: number;
  /** From this 1-based click on, the server silently ignores every click. */
  ignoreFrom?: number;
  /** A stack the server already has on the cursor when the window opens. */
  startCursor?: Cell;
  /** Runs after each non-sync click is written (the number of clicks so far). */
  onClick?: (n: number) => void;
}

/** Every emitter a test rig made: no transfer may leave a listener behind. */
const emitters: EventEmitter[] = [];

afterEach(() => {
  for (const e of emitters) {
    for (const event of ['window_items', 'set_slot', 'close_window']) {
      expect(e.listenerCount(event), event).toBe(0);
    }
  }
  emitters.length = 0;
});

/**
 * A fake server and client. The server runs accepted clicks silently, answers a stale stateId and
 * every sync click with the full window, and the client view only changes when window_items lands.
 */
function rig(chest: Cell[], opts: Options = {}) {
  const server: Cell[] = Array.from({ length: SIZE }, (_, i) => chest[i] ?? null);
  let cursor: Cell = opts.startCursor ?? null;
  let serverState = 5;
  let clicks = 0;
  let syncs = 0;
  const log: string[] = [];
  const emitter = new EventEmitter();
  emitters.push(emitter);
  const writes: Record<string, unknown>[] = [];
  const container = {
    id: 7,
    slots: Array.from({ length: SIZE }, () => null) as Cell[],
    selectedItem: (opts.startCursor ?? null) as Cell,
    inventoryStart: CHEST,
    inventoryEnd: SIZE,
  };
  let lastLand = 0;
  let inFlight = 0;
  const deliver = (extra = 0): void => {
    const items = server.map((c) => (c ? { ...c } : null));
    const carried = cursor ? { ...cursor } : null;
    serverState += 1;
    const state = serverState;
    const land = (): void => {
      log.push('items');
      // The library's own handler runs first, then the packet reaches the other listeners.
      container.slots = items;
      container.selectedItem = carried;
      emitter.emit('window_items', { windowId: 7, stateId: state });
    };
    const delay = (opts.latencyMs ?? 0) + extra;
    if (delay === 0 && inFlight === 0) {
      land();
      return;
    }
    // The server answers in order: a held-back answer holds every later one.
    const at = Math.max(Date.now() + delay, lastLand + 1);
    lastLand = at;
    inFlight += 1;
    setTimeout(() => {
      inFlight -= 1;
      land();
    }, at - Date.now());
  };
  const apply = (slot: number, button: number): void => {
    const here = server[slot] ?? null;
    if (!cursor) {
      if (!here) return;
      const take = button === 0 ? here.count : Math.ceil(here.count / 2);
      cursor = { ...here, count: take };
      server[slot] = take === here.count ? null : { ...here, count: here.count - take };
      return;
    }
    const put = button === 0 ? cursor.count : 1;
    if (!here) {
      server[slot] = { ...cursor, count: put };
    } else if (here.type === cursor.type) {
      const moved = Math.min(put, STACK - here.count);
      server[slot] = { ...here, count: here.count + moved };
      cursor = cursor.count - moved > 0 ? { ...cursor, count: cursor.count - moved } : null;
      return;
    } else {
      server[slot] = cursor;
      cursor = here;
      return;
    }
    cursor = cursor.count - put > 0 ? { ...cursor, count: cursor.count - put } : null;
  };
  const client = {
    on: (event: string, fn: (p: unknown) => void) => emitter.on(event, fn),
    removeListener: (event: string, fn: (p: unknown) => void) => emitter.removeListener(event, fn),
    write: (name: string, p: Record<string, unknown>) => {
      expect(name).toBe('window_click');
      writes.push(p);
      if (p.mode === 5) {
        log.push('sync');
        syncs += 1;
        if (opts.muteAfterSyncs !== undefined && syncs > opts.muteAfterSyncs) return;
        deliver(opts.lateSync?.n === syncs ? opts.lateSync.ms : 0);
        return;
      }
      clicks += 1;
      if (clicks === opts.bumpAtClick) serverState += 1;
      log.push(`click:${p.slot}:${p.mouseButton}:${p.stateId}`);
      const stale = p.stateId !== serverState;
      // Vanilla still runs a stale click, then sends the full window on top of the sync's answer.
      const ignored = clicks === opts.ignoreClick || clicks >= (opts.ignoreFrom ?? Infinity);
      if (!ignored) apply(p.slot as number, p.mouseButton as number);
      if (stale) deliver();
      if (clicks === opts.closeAtClick) {
        setTimeout(() => emitter.emit('close_window', { windowId: 7 }), 5);
      }
      opts.onClick?.(clicks);
    },
  };
  const bot = {
    _client: client,
    registry: { items: { 1: { stackSize: STACK } } },
  } as unknown as Bot & { currentWindow?: unknown };
  const controller = new AbortController();
  const ctx: ActionContext = { bot, signal: controller.signal, timeScale: 0.01 };
  return {
    ctx,
    bot,
    controller,
    container: container as unknown as Container,
    server,
    log,
    writes,
    emitter,
    cursor: () => cursor,
  };
}

const total = (cells: Cell[], from: number, to: number): number =>
  cells.slice(from, to).reduce((sum, c) => sum + (c?.count ?? 0), 0);

describe('transferItems', () => {
  it('withdraws N of M and leaves the cursor empty', async () => {
    const r = rig([{ type: 1, count: 10 }]);
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 4);
    expect(end).toEqual({ error: null, aborted: false });
    expect(r.server[0]).toEqual({ type: 1, count: 6 });
    expect(total(r.server, CHEST, SIZE)).toBe(4);
    expect(r.cursor()).toBeNull();
    // Pick up, four right clicks, put the rest back.
    expect(r.log.filter((l) => l.startsWith('click')).length).toBe(6);
  });

  it('withdraws a whole stack with two clicks', async () => {
    const r = rig([{ type: 1, count: 10 }]);
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 10);
    expect(end.error).toBeNull();
    expect(r.server[0]).toBeNull();
    expect(total(r.server, CHEST, SIZE)).toBe(10);
    expect(r.log.filter((l) => l.startsWith('click')).length).toBe(2);
  });

  it('deposits N and fills an existing stack first', async () => {
    const cells: Cell[] = Array.from({ length: SIZE }, () => null);
    cells[3] = { type: 1, count: 20 };
    cells[CHEST + 2] = { type: 1, count: 10 };
    const r = rig(cells);
    const end = await transferItems(r.ctx, r.container, 'deposit', 1, 4);
    expect(end.error).toBeNull();
    expect(r.server[3]).toEqual({ type: 1, count: 24 });
    expect(r.server[CHEST + 2]).toEqual({ type: 1, count: 6 });
    expect(r.cursor()).toBeNull();
  });

  it('reports a full destination with what moved and an empty cursor', async () => {
    const cells: Cell[] = Array.from({ length: SIZE }, (_, i) =>
      i >= CHEST ? { type: 2, count: 1 } : null,
    );
    cells[0] = { type: 1, count: 10 };
    const r = rig(cells);
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 4);
    expect(end.error).toMatch(/full/);
    expect(r.server[0]).toEqual({ type: 1, count: 10 });
    expect(r.cursor()).toBeNull();
  });

  it('sends no click until the previous click barrier has landed (late confirmation)', async () => {
    const r = rig([{ type: 1, count: 10 }], { latencyMs: 15 });
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 4);
    expect(end.error).toBeNull();
    const seq = r.log.filter((l) => l === 'sync' || l === 'items' || l.startsWith('click'));
    // After the opening sync, every click is followed by its sync and the answer before the next click.
    expect(seq.slice(0, 3)).toEqual(['sync', 'items', expect.stringMatching(/^click/)]);
    for (let i = 0; i < seq.length; i++) {
      if (seq[i]?.startsWith('click')) expect(seq.slice(i + 1, i + 3)).toEqual(['sync', 'items']);
    }
    expect(r.server[0]).toEqual({ type: 1, count: 6 });
  });

  it('puts the cursor back when the signal aborts mid-sequence', async () => {
    const holder: { abort?: () => void } = {};
    const r = rig([{ type: 1, count: 10 }], { onClick: (n) => n === 2 && holder.abort?.() });
    holder.abort = () => r.controller.abort();
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 4);
    expect(end).toEqual({ error: null, aborted: true });
    expect(r.cursor()).toBeNull();
    expect(total(r.server, 0, SIZE)).toBe(10);
  });

  it('stops on a lost click, restores the cursor and does not claim success', async () => {
    const r = rig([{ type: 1, count: 10 }], { ignoreClick: 2 });
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 4);
    expect(end.error).not.toBeNull();
    expect(r.cursor()).toBeNull();
    expect(total(r.server, 0, SIZE)).toBe(10);
  });

  it('survives a late sync answer: the owed answer is swallowed, not taken for the next barrier', async () => {
    const r = rig([{ type: 1, count: 10 }], { lateSync: { n: 2, ms: 40 } });
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 4);
    expect(end).toEqual({ error: null, aborted: false });
    expect(r.server[0]).toEqual({ type: 1, count: 6 });
    expect(total(r.server, CHEST, SIZE)).toBe(4);
    expect(r.cursor()).toBeNull();
    expect(r.emitter.listenerCount('window_items')).toBe(0);
  });

  it('handles a stale stateId click that the server runs and answers twice', async () => {
    const r = rig([{ type: 1, count: 10 }], { bumpAtClick: 2 });
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 4);
    expect(end).toEqual({ error: null, aborted: false });
    expect(total(r.server, CHEST, SIZE)).toBe(4);
    expect(r.cursor()).toBeNull();
    expect(r.emitter.listenerCount('window_items')).toBe(0);
  });

  it('fails at once when the server closes the window, without restore waits', async () => {
    const r = rig([{ type: 1, count: 10 }], { muteAfterSyncs: 1, closeAtClick: 1 });
    const started = Date.now();
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 4);
    expect(end).toEqual({ error: 'the server closed the window', aborted: false });
    // The opening sync and the pickup's sync only: no second barrier, no restore click.
    expect(r.log.filter((l) => l === 'sync').length).toBe(2);
    expect(r.log.filter((l) => l.startsWith('click')).length).toBe(1);
    expect(Date.now() - started).toBeLessThan(25);
    expect(r.emitter.listenerCount('window_items')).toBe(0);
    expect(r.emitter.listenerCount('close_window')).toBe(0);
  });

  it('does not write a click once the bot has no window open', async () => {
    const holder: { gone?: () => void } = {};
    const r = rig([{ type: 1, count: 10 }], { onClick: () => holder.gone?.() });
    holder.gone = () => {
      r.bot.currentWindow = null;
    };
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 4);
    expect(end.error).toBe('the server closed the window');
    expect(r.log.filter((l) => l.startsWith('click')).length).toBe(1);
  });

  it('leaves a stray cursor stack alone and places nothing', async () => {
    const r = rig([{ type: 1, count: 10 }], { startCursor: { type: 1, count: 3 } });
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 4);
    expect(end).toEqual({ error: 'cursor not empty', aborted: false });
    expect(r.log.filter((l) => l.startsWith('click')).length).toBe(0);
    expect(r.cursor()).toEqual({ type: 1, count: 3 });
    expect(r.server[0]).toEqual({ type: 1, count: 10 });
  });

  it('places into a stack with room using one left click, not one right click per item', async () => {
    const cells: Cell[] = Array.from({ length: SIZE }, () => null);
    cells[0] = { type: 1, count: 64 };
    cells[CHEST] = { type: 1, count: 32 };
    const r = rig(cells);
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 64);
    expect(end.error).toBeNull();
    expect(r.server[CHEST]).toEqual({ type: 1, count: 64 });
    expect(r.server[CHEST + 1]).toEqual({ type: 1, count: 32 });
    expect(r.server[0]).toBeNull();
    // Pick up, fill the stack of 32, put the other 32 in an empty slot.
    expect(r.log.filter((l) => l.startsWith('click')).length).toBe(3);
  });

  it('writes the click and sync packets in the pc/26.1 wire shape', async () => {
    const r = rig([{ type: 1, count: 10 }]);
    await transferItems(r.ctx, r.container, 'withdraw', 1, 10);
    const stack = (n: number) => ({ itemId: 1, itemCount: n, components: [], removeComponents: [] });
    const clicks = r.writes.filter((w) => w.mode === 0);
    expect(clicks[0]).toEqual({
      windowId: 7,
      stateId: 6,
      slot: 0,
      mouseButton: 0,
      mode: 0,
      changedSlots: [{ location: 0, item: null }],
      cursorItem: stack(10),
    });
    expect(clicks[1]).toMatchObject({
      slot: CHEST,
      changedSlots: [{ location: CHEST, item: stack(10) }],
      cursorItem: null,
    });
    const syncs = r.writes.filter((w) => w.mode === 5);
    expect(syncs[0]).toEqual({
      windowId: 7,
      stateId: -1,
      slot: -999,
      mouseButton: 2,
      mode: 5,
      changedSlots: [],
      cursorItem: null,
    });
    expect(syncs[1]?.cursorItem).toEqual(stack(10));
  });

  it('reports it when the cursor stack cannot be put back', async () => {
    const r = rig([{ type: 1, count: 10 }], { ignoreFrom: 2 });
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 4);
    expect(end).toEqual({ error: 'could not put the cursor stack back', aborted: false });
    expect(r.cursor()).toEqual({ type: 1, count: 10 });
  });

  it('tops up a partial same-type stack in the destination before an empty slot', async () => {
    const cells: Cell[] = Array.from({ length: SIZE }, () => null);
    cells[0] = { type: 1, count: 20 };
    cells[CHEST] = { type: 1, count: 60 };
    const r = rig(cells);
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 20);
    expect(end.error).toBeNull();
    expect(r.server[CHEST]).toEqual({ type: 1, count: 64 });
    expect(r.server[CHEST + 1]).toEqual({ type: 1, count: 16 });
    expect(r.server[0]).toBeNull();
    expect(r.cursor()).toBeNull();
  });

  it('never swaps with a different-type stack in the destination', async () => {
    const cells: Cell[] = Array.from({ length: SIZE }, () => null);
    cells[0] = { type: 1, count: 5 };
    cells[CHEST] = { type: 2, count: 9 };
    const r = rig(cells);
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 5);
    expect(end.error).toBeNull();
    expect(r.server[CHEST]).toEqual({ type: 2, count: 9 });
    expect(r.server[CHEST + 1]).toEqual({ type: 1, count: 5 });
  });

  it('takes only the asked amount from a bigger source stack on a deposit', async () => {
    const cells: Cell[] = Array.from({ length: SIZE }, () => null);
    cells[CHEST + 4] = { type: 1, count: 50 };
    const r = rig(cells);
    const end = await transferItems(r.ctx, r.container, 'deposit', 1, 7);
    expect(end.error).toBeNull();
    expect(r.server[CHEST + 4]).toEqual({ type: 1, count: 43 });
    expect(r.server[0]).toEqual({ type: 1, count: 7 });
    expect(r.cursor()).toBeNull();
  });

  it('reports failure when the server stops answering', async () => {
    const r = rig([{ type: 1, count: 10 }], { muteAfterSyncs: 1 });
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 4);
    expect(end.error).not.toBeNull();
    expect(end.aborted).toBe(false);
  });
});
