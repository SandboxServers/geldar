import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseItems, TestControl } from './test-control.ts';

/** A fake command source that records every string and answers with the reply it is given. */
function fakeControl(reply = 'ok') {
  const sent: string[] = [];
  const control = new TestControl({
    command: async (cmd: string) => {
      sent.push(cmd);
      return reply;
    },
  });
  return { control, sent };
}

describe('TestControl', () => {
  it('builds the tp command from validated arguments', async () => {
    const { control, sent } = fakeControl();
    await control.tp('GolemSmoke', 1, 2, 3);
    expect(sent).toEqual(['tp GolemSmoke 1 2 3']);
  });

  it('rejects player names with spaces, separators, or the wrong length', async () => {
    const { control, sent } = fakeControl();
    for (const name of ['a b', 'x;y', 'ab', 'a'.repeat(17)]) {
      expect(() => control.kill(name)).toThrow(RangeError);
    }
    expect(sent).toEqual([]);
  });

  it('rejects item ids with uppercase or separators', () => {
    const { control } = fakeControl();
    expect(() => control.give('GolemSmoke', 'Stone', 1)).toThrow(RangeError);
    expect(() => control.give('GolemSmoke', 'stone;kill', 1)).toThrow(RangeError);
    expect(() => control.give('GolemSmoke', 'stone', 6401)).toThrow(RangeError);
  });

  it('rejects coordinates out of range', () => {
    const { control } = fakeControl();
    expect(() => control.setblock(0, 321, 0, 'stone')).toThrow(RangeError);
    expect(() => control.setblock(30_000_001, 0, 0, 'stone')).toThrow(RangeError);
    expect(() => control.setblock(0, 0, 0.5, 'stone')).toThrow(RangeError);
  });

  it('fills a 20,181-block box in one command', async () => {
    const { control, sent } = fakeControl('Successfully filled 20181 blocks');
    await control.fill({ x: 0, y: 200, z: 0 }, { x: 30, y: 220, z: 30 }, 'air');
    expect(sent).toEqual(['fill 0 200 0 30 220 30 air']);
  });

  it('splits a 39,401-block box into two y-slabs', async () => {
    const { control, sent } = fakeControl('ok');
    await control.fill({ x: 0, y: 200, z: 0 }, { x: 30, y: 240, z: 30 }, 'air');
    expect(sent).toEqual(['fill 0 200 0 30 233 30 air', 'fill 0 234 0 30 240 30 air']);
  });

  it('parses a two-entry chest reply in either field order', () => {
    const a =
      '[{Slot: 0b, id: "minecraft:cobblestone", count: 10}, {id: "minecraft:stick", Slot: 1b, count: 3}]';
    const totals = parseItems(`The block has the following block data: ${a}`);
    expect([...totals]).toEqual([
      ['cobblestone', 10],
      ['stick', 3],
    ]);
  });

  it('returns an empty map for "Found no elements" and an empty list', () => {
    expect(parseItems('Found no elements').size).toBe(0);
    expect(parseItems('[]').size).toBe(0);
  });

  it('chestItems sends the data get command and parses the reply', async () => {
    const { control, sent } = fakeControl('[{Slot: 0b, id: "minecraft:dirt", count: 2}]');
    const items = await control.chestItems(1, 2, 3);
    expect(sent).toEqual(['data get block 1 2 3 Items']);
    expect(items.get('dirt')).toBe(2);
  });

  it('keeps RCON and test control out of src/actions', async () => {
    const dir = join(import.meta.dirname, 'actions');
    const files = await readdir(dir).catch(() => [] as string[]);
    for (const file of files) {
      const text = await readFile(join(dir, file), 'utf8');
      expect(text, file).not.toMatch(/rcon|test-control/i);
    }
  });
});
