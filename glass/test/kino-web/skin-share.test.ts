import { Window } from 'happy-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedState } from '../../web/kino/feed.ts';
import { KinoScene } from '../../web/kino/scene.ts';
import { clearSharedSkins, sharedSkin } from '../../web/kino/skin-figure.ts';

// Two KinoScenes on one page, each showing agents with a skin. The fetch and the decode are stubbed; the
// 2D context is a stand-in (happy-dom has none). A revert to a per-scene load makes these fail.

let win: Window;
const uv = () => ({ u0: 0, v0: 0, u1: 1, v1: 1 });
const ctx = {
  drawImage: () => undefined,
  fillRect: () => undefined,
  fillText: () => undefined,
  getImageData: () => ({ data: [0, 0, 0, 255] }),
};

beforeAll(() => {
  win = new Window({ url: 'https://glass.example.test/kino/' });
  const g = globalThis as Record<string, unknown>;
  g.document = win.document;
  g.HTMLElement = win.HTMLElement;
  vi.spyOn(win.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
});

afterAll(async () => {
  const g = globalThis as Record<string, unknown>;
  delete g.document;
  delete g.HTMLElement;
  await win.happyDOM.close();
});

/** Stubs fetch (counting calls) and createImageBitmap (counting decodes). */
function stubNetwork(status = 200, width = 64, height = 64) {
  const fetched: string[] = [];
  let decodes = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return {
      ok: status === 200,
      status,
      headers: new Headers({ 'content-type': 'image/png' }),
      blob: async () => new Blob([new Uint8Array(12)], { type: 'image/png' }),
    };
  });
  vi.stubGlobal('createImageBitmap', async () => {
    decodes += 1;
    return { width, height, close() {} };
  });
  return { fetched, decodes: () => decodes };
}

function agentEntity(id: string, agent: string) {
  return {
    id,
    type: 'minecraft:player',
    agent_id: agent,
    x: 0,
    y: 64,
    z: 0,
    pitch: 0,
    yaw: 0,
  };
}

/** Lets the skin promise and its then-callback run. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setTimeout(r, 0));
};

function sceneWith(agents: string[]) {
  const state = new FeedState();
  const scene = new KinoScene(state, uv);
  const entities = agents.map((a, i) => agentEntity(`e${i}`, a));
  scene.update(state.apply({ type: 'entity_positions', entities }, Date.now()));
  return scene;
}

const figures = (scene: KinoScene) => {
  let n = 0;
  scene.scene.traverse((o) => {
    if (o.name === 'figure') n += 1;
  });
  return n;
};

beforeEach(() => {
  clearSharedSkins();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.spyOn(win.HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
});

describe('shared skins across monitors', () => {
  it('two scenes showing the same agent fetch and decode it once, and both attach the figure', async () => {
    const net = stubNetwork();
    const a = sceneWith(['ag_same']);
    const b = sceneWith(['ag_same']);
    await settle();
    expect(net.fetched).toHaveLength(1);
    expect(net.decodes()).toBe(1);
    expect(figures(a)).toBe(1);
    expect(figures(b)).toBe(1);
  });

  it('two scenes showing different agents each load their own skin and attach the figure', async () => {
    const net = stubNetwork();
    const a = sceneWith(['ag_one']);
    const b = sceneWith(['ag_two']);
    await settle();
    expect(net.fetched).toHaveLength(2);
    expect(figures(a)).toBe(1);
    expect(figures(b)).toBe(1);
  });

  it('a failed load is reported once: a console warning naming the agent and the status, on each scene', async () => {
    stubNetwork(404);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const notes: (string | null)[][] = [[], []];
    const a = sceneWith(['ag_gone']);
    const b = sceneWith(['ag_gone']);
    a.onSkinNote = (n) => notes[0]?.push(n);
    b.onSkinNote = (n) => notes[1]?.push(n);
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('ag_gone');
    expect(String(warn.mock.calls[0]?.[0])).toContain('HTTP 404');
    expect(notes[0]).toEqual(['skin not loaded: HTTP 404']);
    expect(notes[1]).toEqual(['skin not loaded: HTTP 404']);
    expect(figures(a)).toBe(0);
    const load = await sharedSkin('ag_gone', 'unused');
    expect('reason' in load && load.reason).toBe('HTTP 404');
  });

  it('a bitmap of the wrong size is a visible failure with its dimensions', async () => {
    stubNetwork(200, 16, 16);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const load = await sharedSkin('ag_small', 'https://x.test/skin.png');
    expect('reason' in load && load.reason).toBe('bad skin size');
    expect(String(warn.mock.calls[0]?.[0])).toContain('16x16');
  });

  it('a scene that is disposed before its skin loads is not told about the load', async () => {
    stubNetwork(404);
    const calls: (string | null)[] = [];
    const a = sceneWith(['ag_late']);
    a.onSkinNote = (n) => calls.push(n);
    a.dispose();
    await settle();
    expect(calls).toEqual([]);
  });
});
