import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import type { Block } from './bot-types.ts';
import { dig } from './unstick.ts';

type Cells = Map<string, string>;
const cellKey = (c: Vec3): string => `${c.x},${c.y},${c.z}`;

/** A bot standing at (0,64,0) with its head at y 65; `cells` holds the named blocks, the rest is air. */
function fakeBot(cells: Cells) {
  const dug: string[] = [];
  const blockAt = (cell: Vec3): Block | null => {
    const name = cells.get(cellKey(cell)) ?? 'air';
    const boundingBox = name === 'air' ? 'empty' : 'block';
    return { name, boundingBox, diggable: true, hardness: 1.5, position: cell } as unknown as Block;
  };
  const bot = {
    health: 20,
    entity: { position: new Vec3(0.5, 64, 0.5), height: 1.62 },
    blockAt,
    async dig(block: Block) {
      dug.push(block.name);
      cells.delete(cellKey(block.position));
    },
  };
  return { bot: bot as unknown as Bot, dug };
}

const target = new Vec3(1, 65, 0);

describe('unstick dig: the shared dig-safety guard', () => {
  it('digs a stone block beside the head when nothing falls above it (control)', async () => {
    const { bot, dug } = fakeBot(new Map([[cellKey(target), 'stone']]));
    const block = { name: 'stone', position: target } as unknown as Block;
    const ok = await dig(bot, new AbortController().signal, block, target);
    expect(ok).toBe(true);
    expect(dug).toEqual(['stone']);
  });

  it('refuses the dig when a gravel block falls onto the Body from above the target', async () => {
    const cells = new Map([
      [cellKey(target), 'stone'],
      [cellKey(target.offset(0, 1, 0)), 'gravel'],
    ]);
    const { bot, dug } = fakeBot(cells);
    const block = { name: 'stone', position: target } as unknown as Block;
    const ok = await dig(bot, new AbortController().signal, block, target);
    expect(ok).toBe(false);
    expect(dug).toEqual([]);
  });
});
