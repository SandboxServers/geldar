import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
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
  /** Runs after each non-sync click is written (the number of clicks so far). */
  onClick?: (n: number) => void;
}

/**
 * A fake server and client. The server runs accepted clicks silently, answers a stale stateId and
 * every sync click with the full window, and the client view only changes when window_items lands.
 */
function rig(chest: Cell[], opts: Options = {}) {
  const server: Cell[] = Array.from({ length: SIZE }, (_, i) => chest[i] ?? null);
  let cursor: Cell = null;
  let serverState = 5;
  let clicks = 0;
  let syncs = 0;
  const log: string[] = [];
  const emitter = new EventEmitter();
  const container = {
    id: 7,
    slots: Array.from({ length: SIZE }, () => null) as Cell[],
    selectedItem: null as Cell,
    inventoryStart: CHEST,
    inventoryEnd: SIZE,
  };
  const deliver = (): void => {
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
    if (opts.latencyMs) setTimeout(land, opts.latencyMs);
    else land();
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
      if (p.mode === 5) {
        log.push('sync');
        syncs += 1;
        if (opts.muteAfterSyncs !== undefined && syncs > opts.muteAfterSyncs) return;
        deliver();
        return;
      }
      clicks += 1;
      log.push(`click:${p.slot}:${p.mouseButton}:${p.stateId}`);
      const stale = p.stateId !== serverState;
      if (stale) deliver();
      else if (clicks !== opts.ignoreClick) apply(p.slot as number, p.mouseButton as number);
      opts.onClick?.(clicks);
    },
  };
  const bot = {
    _client: client,
    registry: { items: { 1: { stackSize: STACK } } },
  } as unknown as Bot;
  const controller = new AbortController();
  const ctx: ActionContext = { bot, signal: controller.signal, timeScale: 0.01 };
  return {
    ctx,
    controller,
    container: container as unknown as Container,
    server,
    log,
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

  it('reports failure when the server stops answering', async () => {
    const r = rig([{ type: 1, count: 10 }], { muteAfterSyncs: 1 });
    const end = await transferItems(r.ctx, r.container, 'withdraw', 1, 4);
    expect(end.error).not.toBeNull();
    expect(end.aborted).toBe(false);
  });
});
