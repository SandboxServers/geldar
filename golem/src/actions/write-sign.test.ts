import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { completed, failed } from './outcome.ts';
import type { ActionContext } from './registry.ts';
import { writeSignAction } from './write-sign.ts';

const placeRun = vi.hoisted(() => vi.fn());
vi.mock('./place.ts', () => ({ placeAction: { run: placeRun } }));

function context(items: string[], signal = new AbortController().signal) {
  const updates: string[] = [];
  const sign = { name: 'oak_sign' };
  const bot = {
    inventory: { items: () => items.map((name) => ({ name })) },
    entity: { position: new Vec3(0.5, 64, 0.5) },
    blockAt: (p: Vec3) =>
      p.equals(new Vec3(1, 64, 0)) ? sign : { name: 'stone', boundingBox: 'block' },
    waitForTicks: async () => {},
    updateSign: (_block: unknown, text: string) => updates.push(text),
  };
  return { ctx: { bot, signal, timeScale: 1 } as unknown as ActionContext, updates };
}

describe('write_sign', () => {
  it('places a held sign and writes the cleaned, wrapped text', async () => {
    placeRun.mockResolvedValueOnce(completed({ at: { x: 1, y: 64, z: 0 } }));
    const { ctx, updates } = context(['stone', 'oak_sign']);
    const out = await writeSignAction.run(ctx, {
      do: 'write_sign',
      text: '§cHello\u0000 brave new world',
    });
    expect(out.status).toBe('completed');
    expect(updates).toEqual(['Hello brave new\nworld']);
    expect(placeRun.mock.calls[0]?.[1]).toMatchObject({ block: 'oak_sign' });
  });

  it('refuses empty text and a missing sign before any placement', async () => {
    placeRun.mockClear();
    const empty = await writeSignAction.run(context(['oak_sign']).ctx, {
      do: 'write_sign',
      text: ' \u0007 ',
    });
    expect(empty).toMatchObject({ status: 'failed', reason: 'invalid_args' });
    const none = await writeSignAction.run(context(['stone']).ctx, {
      do: 'write_sign',
      text: 'hi',
    });
    expect(none).toMatchObject({ status: 'failed', reason: 'missing_materials' });
    expect(placeRun).not.toHaveBeenCalled();
  });

  it('says the sign is not there, as a fact with no advice, when the placed sign is gone', async () => {
    const { ctx, updates } = context(['oak_sign']);
    (ctx.bot as unknown as { blockAt: () => unknown }).blockAt = () => ({
      name: 'stone',
      boundingBox: 'block',
    });
    placeRun.mockResolvedValueOnce(completed({ at: { x: 1, y: 64, z: 0 } }));
    const gone = await writeSignAction.run(ctx, { do: 'write_sign', text: 'hi' });
    expect(gone).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'the sign is not there any more',
    });
    expect(updates).toEqual([]);
  });

  it('returns the placement failure and writes nothing when aborted', async () => {
    placeRun.mockResolvedValueOnce(failed('blocked', 'no space'));
    const refused = await writeSignAction.run(context(['oak_sign']).ctx, {
      do: 'write_sign',
      text: 'hi',
    });
    expect(refused).toMatchObject({ status: 'failed', reason: 'blocked' });

    placeRun.mockResolvedValueOnce(completed({ at: { x: 1, y: 64, z: 0 } }));
    const controller = new AbortController();
    controller.abort();
    const { ctx, updates } = context(['oak_sign'], controller.signal);
    expect((await writeSignAction.run(ctx, { do: 'write_sign', text: 'hi' })).status).toBe(
      'cancelled',
    );
    expect(updates).toEqual([]);
  });
});
