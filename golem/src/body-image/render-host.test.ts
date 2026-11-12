import { describe, expect, it } from 'vitest';
import type { RenderScene } from './reader.ts';
import { RenderHost } from './render-host.ts';
import { copyBlockBox } from './snapshot.ts';

const CRASH = new URL('./crash-worker.fixture.ts', import.meta.url);
const HANG = new URL('./hang-worker.fixture.ts', import.meta.url);
const PNG_SIGNATURE = [137, 80, 78, 71];

function scene(yaw = 0): RenderScene {
  const snapshot = copyBlockBox((_x, y) => (y < 60 ? 'stone' : 'air'), { x: 0.5, y: 64, z: 0.5 });
  return {
    snapshot,
    eye: { x: 0.5, y: 65.62, z: 0.5 },
    yaw,
    pitch: 0,
    entities: [],
    width: 64,
    height: 36,
  };
}

describe('RenderHost: the worker thread renders', () => {
  it('renders a real scene in the worker and returns a PNG', async () => {
    const host = new RenderHost();
    const outcome = await host.render(scene());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(Array.from(outcome.png.slice(0, 4))).toEqual(PNG_SIGNATURE);
    await host.close();
  });
});

describe('RenderHost: busy, timeout, crash and close', () => {
  it('refuses a second render while one runs, as busy, without queueing it', async () => {
    const host = new RenderHost();
    const first = host.render(scene());
    expect(host.busy).toBe(true);
    expect(await host.render(scene())).toEqual({ ok: false, reason: 'busy' });
    expect((await first).ok).toBe(true);
    expect(host.busy).toBe(false);
    await host.close();
  });

  it('a render that runs past the timeout is a timeout, and the host is free again', async () => {
    const host = new RenderHost({ script: HANG, timeoutMs: 50 });
    expect(await host.render(scene())).toEqual({ ok: false, reason: 'timeout' });
    expect(host.busy).toBe(false);
    await host.close();
  });

  it('a worker that crashes fails its render as crashed, and the next render works (restart)', async () => {
    const host = new RenderHost({ script: CRASH });
    expect(await host.render(scene(1234))).toEqual({ ok: false, reason: 'crashed' });
    const next = await host.render(scene(0));
    expect(next.ok).toBe(true);
    if (next.ok) expect(Array.from(next.png)).toEqual(PNG_SIGNATURE);
    await host.close();
  });

  it('after close, a render fails and does not spawn a worker', async () => {
    const host = new RenderHost();
    await host.close();
    expect(await host.render(scene())).toEqual({ ok: false, reason: 'failed' });
  });
});
