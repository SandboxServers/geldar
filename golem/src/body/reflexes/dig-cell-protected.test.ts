import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import type { ReflexContext } from '../reflex.ts';
import { digCellWhy } from './dig-cell.ts';

describe('a reflex dig never takes someone else’s built block (0164, review N8)', () => {
  it('refuses to dig cobblestone that the Body did not place', async () => {
    const cell = new Vec3(0, 64, 0);
    const block = { name: 'cobblestone', boundingBox: 'block', diggable: true, position: cell };
    const dig = vi.fn(async () => undefined);
    const bot = {
      blockAt: () => block,
      dig,
      entity: { position: new Vec3(0, 64, 0), height: 1.62 },
    };
    const ctx = { bot, signal: new AbortController().signal } as unknown as ReflexContext;
    const result = await digCellWhy(ctx, cell);
    expect(dig).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});
