import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editSignHandler } from './edit-sign.ts';
import { recordOwnPlacement } from './own-placements.ts';
import { moveNear } from './pathing.ts';
import { setOwnerLookup, setOwnerPrefetch } from './protected-blocks.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

/** Bounding box of each block the fake knows: `empty` cells are passable, `block` cells are solid. */
const BOXES: Record<string, 'block' | 'empty'> = {
  air: 'empty',
  oak_sign: 'empty',
  oak_planks: 'block',
  stone: 'block',
};

const SIGN = { x: 2, y: 63, z: 2 };

interface FakeOptions {
  /** The block at the sign cell (default an oak sign). */
  block?: string;
  /** Which waxed key the block entity carries, if any. */
  waxed?: 'is_waxed' | 'isWaxed';
  /** Item in the hand at the start. */
  held?: string;
  /** Item names in the inventory. */
  items?: string[];
  /** When unequip leaves the hand as it was (the item cannot be put away). */
  stuckHand?: boolean;
  /** Whether a click makes the server send `open_sign_entity`; default true. */
  opens?: boolean;
  /** The `isFrontText` the open packet carries; default true. */
  opensFront?: boolean;
  /** Whether updateSign changes the sign text; default true. */
  accepts?: boolean;
  /** When set, updateSign emits this `error` (as mineflayer does for bad input) and sends nothing. */
  signError?: string;
  /** Ticks after the click before the open packet arrives; unset means it is sent during the click. */
  opensAfterWaits?: number;
  /** Runs inside the click, before the packet is sent. */
  onClick?: () => void;
  /** The sign text on the front and back, before the edit. */
  text?: [string, string];
  /** Every hotbar and inventory slot is full: unequip tosses the held stack (mineflayer's fallback). */
  inventoryFull?: boolean;
  /** Whether the bot starts out sneaking. */
  sneaking?: boolean;
  /** Real milliseconds each tick takes, so wall-clock waits are visible to the test. */
  tickMs?: number;
  /** When set, unequip rejects with this message (the hand is left as it was). */
  unequipError?: string;
}

function key(p: Vec3): string {
  return `${p.x},${p.y},${p.z}`;
}

/** A fake bot with a world, a hand, an inventory, a raw client and the calls an edit makes. */
function fakeBot(options: FakeOptions = {}) {
  const world = new Map<string, string>([
    [key(new Vec3(SIGN.x, SIGN.y, SIGN.z)), options.block ?? 'oak_sign'],
  ]);
  const texts: [string, string] = [...(options.text ?? ['', ''])];
  const client = new EventEmitter();
  const events = new EventEmitter();
  const order: string[] = [];
  const sent: Array<{ text: string; back: boolean }> = [];
  const listenersAtClick: number[] = [];
  let pendingOpen = 0;
  const emitOpen = (): void => {
    client.emit('open_sign_entity', { location: SIGN, isFrontText: options.opensFront ?? true });
  };
  let held: { name: string; count: number } | null = options.held
    ? { name: options.held, count: 1 }
    : null;
  const stored: string[] = [...(options.items ?? [])];
  const slots = Array.from({ length: 46 }, (_, index) =>
    options.inventoryFull && index >= 9 && index < 45 ? { name: 'cobblestone' } : null,
  );
  const controls: Record<string, boolean> = { sneak: options.sneaking ?? false };
  const bot = {
    username: 'ag_self_01',
    entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0 },
    entities: {},
    _client: client,
    get heldItem() {
      return held;
    },
    registry: {
      blocksByName: Object.fromEntries(
        Object.entries(BOXES).map(([name, boundingBox]) => [name, { boundingBox }]),
      ),
    },
    inventory: {
      slots,
      items: () => stored.map((name) => ({ name, count: 1 })),
    },
    getControlState: (name: string) => controls[name] ?? false,
    setControlState: vi.fn((name: string, on: boolean) => {
      controls[name] = on;
    }),
    unequip: vi.fn(async () => {
      order.push('unequip');
      if (options.unequipError) throw new Error(options.unequipError);
      if (options.stuckHand || !held) return;
      // Mineflayer puts the stack in a free slot, or tosses it when there is none.
      if (options.inventoryFull) order.push('toss');
      else stored.push(held.name);
      held = null;
    }),
    equip: vi.fn(async (stack: { name: string; count: number }) => {
      order.push(`equip:${stack.name}`);
      held = stack;
    }),
    lookAt: vi.fn(async () => {
      order.push('look');
    }),
    waitForTicks: vi.fn(async (ticks: number) => {
      if (options.tickMs) await new Promise((resolve) => setTimeout(resolve, options.tickMs));
      if (ticks === 2) order.push('wait2');
      if (pendingOpen > 0 && --pendingOpen === 0) emitOpen();
    }),
    activateBlock: vi.fn(async () => {
      order.push('activate');
      listenersAtClick.push(client.listenerCount('open_sign_entity'));
      options.onClick?.();
      if (options.opensAfterWaits !== undefined) pendingOpen = options.opensAfterWaits;
      else if (options.opens !== false) emitOpen();
    }),
    updateSign: vi.fn((_block: unknown, text: string, back = false) => {
      order.push('update');
      sent.push({ text, back });
      if (options.signError) {
        order.push(events.listenerCount('error') > 0 ? 'error-caught' : 'error-unhandled');
        events.emit('error', new Error(options.signError));
        return;
      }
      if (options.accepts === false) return;
      if (back) texts[1] = text;
      else texts[0] = text;
    }),
    on: (name: string, listener: (...args: unknown[]) => void) => events.on(name, listener),
    off: (name: string, listener: (...args: unknown[]) => void) => events.off(name, listener),
    blockAt: (p: Vec3) => {
      const name = world.get(key(p)) ?? 'air';
      const isSign = key(p) === key(new Vec3(SIGN.x, SIGN.y, SIGN.z));
      const blockEntity = isSign && options.waxed ? { [options.waxed]: 1 } : {};
      return {
        name,
        position: p,
        boundingBox: BOXES[name] ?? 'empty',
        shapes: [],
        blockEntity,
        getSignText: () => (isSign ? [texts[0], texts[1]] : ['', '']),
      };
    },
  };
  return { bot: bot as unknown as Bot, fake: bot, order, sent, client, listenersAtClick };
}

/** Runs the `edit_sign` handler at the sign with a fresh signal and a scale that makes waits short. */
function edit(bot: Bot, text = 'Wheat for sale', signal = new AbortController().signal, at = SIGN) {
  return editSignHandler(true).run(
    { bot, signal, timeScale: 0.001 },
    { do: 'edit_sign', at, text },
  );
}

afterEach(() => {
  setOwnerLookup(null);
  setOwnerPrefetch(null);
});

describe('edit_sign refusals', () => {
  it('refuses text with nothing left after cleaning, before any click', async () => {
    const { bot, order } = fakeBot();
    const outcome = await edit(bot, ' \n\t ');
    expect(outcome).toMatchObject({ status: 'failed', reason: 'invalid_args' });
    expect(order).toEqual([]);
  });

  it('refuses a block that is not a sign', async () => {
    const { bot, order } = fakeBot({ block: 'oak_planks' });
    const outcome = await edit(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible' });
    expect(JSON.stringify(outcome)).toContain('that block is not a sign');
    expect(order).toEqual([]);
  });

  it('refuses a sign another player recorded as theirs', async () => {
    setOwnerLookup(() => ({ known: true, owner: 'ag_other_02' }));
    const { bot, order } = fakeBot();
    const outcome = await edit(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible' });
    expect(JSON.stringify(outcome)).toContain("that block is someone else's work");
    expect(order).toEqual([]);
  });

  it('refuses a sign recorded under the system owner geldar-system', async () => {
    setOwnerLookup(() => ({ known: true, owner: 'geldar-system' }));
    const { bot, order } = fakeBot();
    const outcome = await edit(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible' });
    expect(JSON.stringify(outcome)).toContain("that block is someone else's work");
    expect(order).toEqual([]);
  });

  it('reads the owner after the prefetch, so a cold cache cannot allow a grave sign', async () => {
    let warmed = false;
    setOwnerPrefetch(async () => {
      warmed = true;
    });
    setOwnerLookup(() => (warmed ? { known: true, owner: 'geldar-system' } : { known: false }));
    const { bot, order } = fakeBot();
    const outcome = await edit(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible' });
    expect(JSON.stringify(outcome)).toContain("that block is someone else's work");
    expect(order).toEqual([]);
  });

  it('allows a sign with no recorded owner', async () => {
    setOwnerLookup(() => ({ known: false }));
    const { bot, order } = fakeBot({ opens: false });
    await edit(bot);
    expect(order).toContain('activate');
  });

  it.each(['is_waxed', 'isWaxed'] as const)(
    'refuses a waxed sign (%s) without a click',
    async (waxed) => {
      const { bot, order, fake } = fakeBot({ waxed });
      const outcome = await edit(bot);
      expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible' });
      expect(JSON.stringify(outcome)).toContain('that sign is waxed');
      expect(order).toEqual([]);
      expect(fake.updateSign).not.toHaveBeenCalled();
    },
  );
});

describe('edit_sign click', () => {
  it('empties the hand before the click', async () => {
    const { bot, order, fake } = fakeBot({ held: 'honeycomb' });
    await edit(bot);
    expect(fake.unequip).toHaveBeenCalledWith('hand');
    expect(order.indexOf('unequip')).toBeLessThan(order.indexOf('activate'));
    // The item goes back in the hand once the edit is over.
    expect(bot.heldItem?.name).toBe('honeycomb');
  });

  it('lets an unequip error reach the caller instead of swallowing it, and sends no click', async () => {
    const { bot, order } = fakeBot({ held: 'honeycomb', unequipError: 'window is open' });
    await expect(edit(bot)).rejects.toThrow('window is open');
    expect(order).not.toContain('activate');
    expect(order).not.toContain('update');
  });

  it('does not unequip when the inventory has no room, and uses the stick instead', async () => {
    const { bot, order, fake } = fakeBot({
      held: 'honeycomb',
      inventoryFull: true,
      items: ['stick'],
    });
    const outcome = await edit(bot);
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(fake.unequip).not.toHaveBeenCalled();
    expect(order).not.toContain('toss');
    expect(order.indexOf('equip:stick')).toBeLessThan(order.indexOf('activate'));
  });

  it('refuses with the no-room text when the inventory is full and there is no stick', async () => {
    const { bot, order, fake } = fakeBot({ held: 'honeycomb', inventoryFull: true });
    const outcome = await edit(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(JSON.stringify(outcome)).toContain('no room in the inventory to empty the hand');
    expect(fake.unequip).not.toHaveBeenCalled();
    expect(order).not.toContain('toss');
    expect(order).not.toContain('activate');
    expect(bot.heldItem?.name).toBe('honeycomb');
  });

  it('stops sneaking before the click', async () => {
    const { bot, fake } = fakeBot({ sneaking: true });
    await edit(bot);
    expect(fake.setControlState).toHaveBeenCalledWith('sneak', false);
    expect(bot.getControlState('sneak')).toBe(false);
  });

  it('does not empty the hand when the walk is aborted after it ends', async () => {
    const controller = new AbortController();
    const { bot, fake } = fakeBot({ held: 'honeycomb' });
    fake.entity.position = new Vec3(20.5, 64, 20.5);
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      fake.entity.position = new Vec3(0.5, 64, 0.5);
      controller.abort();
      return { ok: true, distance: 0 } as Awaited<ReturnType<typeof moveNear>>;
    });
    const outcome = await edit(bot, 'Wheat for sale', controller.signal);
    expect(outcome.status).toBe('cancelled');
    expect(fake.unequip).not.toHaveBeenCalled();
    expect(bot.heldItem?.name).toBe('honeycomb');
  });

  it('walks to a sign out of reach before it clears the hand', async () => {
    vi.mocked(moveNear).mockClear();
    const { bot, fake } = fakeBot({ held: 'honeycomb' });
    fake.entity.position = new Vec3(20.5, 64, 20.5);
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      fake.entity.position = new Vec3(0.5, 64, 0.5);
      return { ok: true, distance: 0 } as Awaited<ReturnType<typeof moveNear>>;
    });
    const outcome = await edit(bot);
    expect(moveNear).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ status: 'completed' });
  });

  it('scales the open wait by the time scale', async () => {
    const { bot } = fakeBot({ opens: false, tickMs: 1 });
    const started = Date.now();
    const outcome = await edit(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'no_effect' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('equips a stick when the hand cannot be emptied', async () => {
    const { bot, order } = fakeBot({
      held: 'ink_sac',
      stuckHand: true,
      items: ['stick'],
      opens: false,
    });
    await edit(bot);
    expect(order).toContain('equip:stick');
    expect(order.indexOf('equip:stick')).toBeLessThan(order.indexOf('activate'));
  });

  it('refuses when the hand cannot be emptied and there is no stick', async () => {
    const { bot, order } = fakeBot({ held: 'ink_sac', stuckHand: true });
    const outcome = await edit(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(order).not.toContain('activate');
  });

  it('looks at the sign before the click, then waits two ticks', async () => {
    const { bot, order } = fakeBot();
    await edit(bot);
    expect(order.slice(0, 3)).toEqual(['look', 'wait2', 'activate']);
  });

  it('arms the open wait before the click and removes it afterwards', async () => {
    const { bot, listenersAtClick, client } = fakeBot();
    await edit(bot);
    expect(listenersAtClick).toEqual([1]);
    expect(client.listenerCount('open_sign_entity')).toBe(0);
  });

  it('writes on the back side when the open packet names the back', async () => {
    const { bot, sent } = fakeBot({ opensFront: false });
    await edit(bot, 'Back text');
    expect(sent).toEqual([{ text: 'Back text', back: true }]);
  });

  it('writes on the front side when the open packet names the front', async () => {
    const { bot, sent } = fakeBot({ opensFront: true });
    await edit(bot, 'Front text');
    expect(sent).toEqual([{ text: 'Front text', back: false }]);
  });

  it('wraps the text to four lines of fifteen before sending it', async () => {
    const { bot, sent } = fakeBot();
    await edit(bot, 'Fresh eggs and milk today at the farm');
    expect(sent[0]?.text).toBe('Fresh eggs and\nmilk today at\nthe farm');
  });
});

describe('edit_sign readback', () => {
  it('completes with the wrapped lines when the text reads back', async () => {
    const { bot } = fakeBot();
    const outcome = await edit(bot, 'Wheat for sale');
    expect(outcome).toMatchObject({ status: 'completed', detail: { text: ['Wheat for sale'] } });
  });

  it('waits for an open packet that arrives a few ticks after the click', async () => {
    const { bot, sent } = fakeBot({ opensAfterWaits: 3 });
    const outcome = await edit(bot, 'Late open');
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(sent).toEqual([{ text: 'Late open', back: false }]);
  });

  it('reports no_effect when the text reads back unchanged', async () => {
    const { bot } = fakeBot({ accepts: false, text: ['Old', ''] });
    const outcome = await edit(bot, 'Wheat for sale');
    expect(outcome).toMatchObject({ status: 'failed', reason: 'no_effect' });
    expect(JSON.stringify(outcome)).toContain('the sign did not change');
  });

  it('reports no_effect when the text sent is the text already on the sign', async () => {
    const { bot, sent } = fakeBot({ text: ['Wheat for sale', ''] });
    const outcome = await edit(bot, 'Wheat for sale');
    expect(sent).toHaveLength(1);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'no_effect' });
    expect(JSON.stringify(outcome)).toContain('the sign did not change');
  });

  it('reports the client error as failed without throwing', async () => {
    const { bot, order } = fakeBot({ signError: 'too many lines for sign text' });
    const outcome = await edit(bot, 'Wheat for sale');
    expect(outcome).toMatchObject({ status: 'failed', reason: 'internal' });
    expect(order).toContain('error-caught');
  });

  it('reports no_effect when the sign never opens for editing', async () => {
    const { bot, fake } = fakeBot({ opens: false });
    const outcome = await edit(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'no_effect' });
    expect(JSON.stringify(outcome)).toContain('the sign did not open for editing');
    expect(fake.updateSign).not.toHaveBeenCalled();
  });

  it('returns cancelled when the signal aborts during the click', async () => {
    const controller = new AbortController();
    const { bot, fake, client } = fakeBot({
      opens: false,
      onClick: () => controller.abort(),
    });
    const outcome = await edit(bot, 'Wheat for sale', controller.signal);
    expect(outcome.status).toBe('cancelled');
    expect(fake.updateSign).not.toHaveBeenCalled();
    expect(client.listenerCount('open_sign_entity')).toBe(0);
  });

  it('returns cancelled when the signal is already aborted', async () => {
    const { bot, order } = fakeBot();
    const controller = new AbortController();
    controller.abort();
    const outcome = await edit(bot, 'Wheat for sale', controller.signal);
    expect(outcome.status).toBe('cancelled');
    expect(order).not.toContain('activate');
  });
});

describe('edit_sign own placements', () => {
  // Kept last: the recorded placement at this cell stays in the module for the rest of the file.
  it('allows a sign the bot placed itself, even if the lookup names another owner', async () => {
    const { bot, fake } = fakeBot({ opens: false });
    setOwnerLookup(() => ({ known: true, owner: 'ag_other_02' }));
    recordOwnPlacement(bot, SIGN, 'oak_sign');
    const outcome = await edit(bot);
    expect(JSON.stringify(outcome)).not.toContain("someone else's work");
    expect(fake.activateBlock).toHaveBeenCalledTimes(1);
  });
});

describe('edit_sign shard flag', () => {
  it('refuses the verb while the flag is off, before any walk, ownership or click', async () => {
    vi.mocked(moveNear).mockClear();
    const { bot, order, fake } = fakeBot({ held: 'honeycomb' });
    fake.entity.position = new Vec3(20.5, 64, 20.5);
    const outcome = await editSignHandler(false).run(
      { bot, signal: new AbortController().signal, timeScale: 0.001 },
      { do: 'edit_sign', at: SIGN, text: 'Wheat for sale' },
    );
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible' });
    expect(JSON.stringify(outcome)).toContain('that block cannot be edited yet');
    expect(moveNear).not.toHaveBeenCalled();
    expect(order).toEqual([]);
    expect(fake.updateSign).not.toHaveBeenCalled();
  });

  it('runs the normal path when the flag is on', async () => {
    const { bot, sent } = fakeBot();
    const outcome = await edit(bot, 'Wheat for sale');
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(sent).toHaveLength(1);
  });
});
