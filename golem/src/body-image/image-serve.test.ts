import { describe, expect, it, vi } from 'vitest';
import { flatWorld, partlyLoadedBot, unloadedBot } from './body-image.fakes.ts';
import { IMAGE_CAPTION, type ImageServeDeps, imageReply } from './image-serve.ts';
import { PNG_CAP_BYTES } from './image-size.ts';
import { ImageLimiter, MIN_GAP_MS } from './limiter.ts';
import type { RenderScene } from './reader.ts';
import type { RenderOutcome, RenderPort } from './render-host.ts';

const SMALL = new Uint8Array(10);

function port(outcomes: RenderOutcome[] | ((scene: RenderScene) => RenderOutcome)) {
  const render = vi.fn(
    async (scene: RenderScene): Promise<RenderOutcome> =>
      typeof outcomes === 'function'
        ? outcomes(scene)
        : (outcomes.shift() ?? { ok: true, png: SMALL }),
  );
  const fake: { busy: boolean; render: RenderPort['render'] & ReturnType<typeof vi.fn> } = {
    busy: false,
    render,
  };
  return fake;
}

function deps(over: Partial<ImageServeDeps> & { now?: () => number } = {}) {
  const world = flatWorld();
  let t = 0;
  const base = {
    bot: world.bot,
    render: port([]),
    limiter: new ImageLimiter(over.now ?? (() => t)),
  };
  return { ...base, ...over, clock: (ms: number) => (t = ms) };
}

const parse = (body: string) => JSON.parse(body) as Record<string, unknown>;

describe('imageReply: the success reply', () => {
  it('returns the PNG as base64 with the fixed caption', async () => {
    const d = deps({ render: port([{ ok: true, png: Uint8Array.of(137, 80, 78, 71) }]) });
    expect(parse(await imageReply(d, ''))).toEqual({
      png: Buffer.from([137, 80, 78, 71]).toString('base64'),
      caption: IMAGE_CAPTION,
    });
  });

  it('clamps the size asked: oversize to 640x360, a bad size to the default, odd kept', async () => {
    const seen: RenderScene[] = [];
    const d = deps({
      render: port((s) => {
        seen.push(s);
        return { ok: true, png: SMALL };
      }),
    });
    await imageReply(d, JSON.stringify({ width: 9999, height: 7 }));
    expect([seen[0]?.width, seen[0]?.height]).toEqual([640, 32]);
    d.clock(MIN_GAP_MS);
    await imageReply(d, JSON.stringify({ width: 321, height: 'tall' }));
    expect([seen[1]?.width, seen[1]?.height]).toEqual([321, 180]);
  });
});

describe('imageReply: typed refusals, never internal', () => {
  it('busy: refused without taking budget', async () => {
    const d = deps();
    const port = d.render as { busy: boolean };
    port.busy = true;
    expect(parse(await imageReply(d, ''))).toEqual({ error: 'view_unavailable', detail: 'busy' });
    expect(d.render.render).not.toHaveBeenCalled();
    port.busy = false;
    expect(parse(await imageReply(d, ''))).toHaveProperty('png');
  });

  it('an unloaded eye cell is chunks_not_loaded, and the limiter is not touched', async () => {
    const d = deps();
    const world = flatWorld();
    const unloaded = { ...d, bot: unloadedBot(world) };
    expect(parse(await imageReply(unloaded, ''))).toEqual({
      error: 'view_unavailable',
      detail: 'chunks_not_loaded',
    });
    expect(parse(await imageReply(d, ''))).toHaveProperty('png');
  });

  it('the 2nd image within 5 s is rate_limited and does not render', async () => {
    const d = deps();
    await imageReply(d, '');
    d.clock(MIN_GAP_MS - 1);
    expect(parse(await imageReply(d, ''))).toEqual({
      error: 'view_unavailable',
      detail: 'rate_limited',
    });
    expect(d.render.render).toHaveBeenCalledTimes(1);
  });

  it('a render that times out is render_timeout; a crash is render_failed', async () => {
    const timeout = deps({ render: port([{ ok: false, reason: 'timeout' }]) });
    expect(parse(await imageReply(timeout, ''))).toEqual({
      error: 'view_unavailable',
      detail: 'render_timeout',
    });
    const crash = deps({ render: port([{ ok: false, reason: 'crashed' }]) });
    expect(parse(await imageReply(crash, ''))).toEqual({
      error: 'view_unavailable',
      detail: 'render_failed',
    });
  });

  it('a render that throws is refused as render_failed, never a bare error', async () => {
    const d = deps();
    d.render.render = vi.fn(async () => {
      throw new Error('boom');
    });
    expect(parse(await imageReply(d, ''))).toEqual({
      error: 'view_unavailable',
      detail: 'render_failed',
    });
  });
});

describe('imageReply: the PNG cap', () => {
  it('a render over the cap at the requested size is re-rendered at the default size', async () => {
    const big = new Uint8Array(PNG_CAP_BYTES + 1);
    const seen: RenderScene[] = [];
    const d = deps({
      render: port((s) => {
        seen.push(s);
        return { ok: true, png: s.width === 640 ? big : SMALL };
      }),
    });
    expect(parse(await imageReply(d, JSON.stringify({ width: 640, height: 360 })))).toHaveProperty(
      'png',
    );
    expect(seen.map((s) => [s.width, s.height])).toEqual([
      [640, 360],
      [320, 180],
    ]);
  });

  it('a default-size render over the cap is render_failed', async () => {
    const d = deps({ render: port([{ ok: true, png: new Uint8Array(PNG_CAP_BYTES + 1) }]) });
    expect(parse(await imageReply(d, ''))).toEqual({
      error: 'view_unavailable',
      detail: 'render_failed',
    });
  });
});

describe('imageReply: the unloaded part of a partly loaded view', () => {
  it('still renders when the eye is loaded and far cells are not', async () => {
    const world = flatWorld();
    const d = { ...deps(), bot: partlyLoadedBot(world, 3) };
    expect(parse(await imageReply(d, ''))).toHaveProperty('png');
  });
});
