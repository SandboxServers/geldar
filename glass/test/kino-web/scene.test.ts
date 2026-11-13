import { describe, expect, it } from 'vitest';
import { devFeed } from '../../web/kino/dev-feed.ts';
import { FeedState } from '../../web/kino/feed.ts';
import { KinoScene } from '../../web/kino/scene.ts';

const uv = () => ({ u0: 0, v0: 0, u1: 1, v1: 1 });

function play() {
  const state = new FeedState();
  const view = new KinoScene(state, uv);
  for (const m of devFeed()) view.update(state.apply(m));
  return { state, view };
}

describe('KinoScene with the mocked feed', () => {
  it('meshes each section and places markers', () => {
    const { view } = play();
    expect(view.sectionKeys().sort()).toEqual(['0,0,0', '1,0,0']);
    expect(view.markerIds().sort()).toEqual(['e1', 'e2']);
    const agent = view.markerOf('e1');
    expect(agent?.position.toArray()).toEqual([4.5, 1.9, 4.5]);
    expect(agent?.userData.agent).toBe(true);
    expect(view.markerOf('e2')?.userData.agent).toBe(false);
  });

  it('applies block_update to the mesh (the log adds faces)', () => {
    const { view } = play();
    const mesh = view.sectionMesh('0,0,0');
    const faces = (mesh?.geometry.getIndex()?.count ?? 0) / 6;
    // tops 255 (the log covers one), bottoms 256, west edge 16 (x=15 meets the loaded chunk 1),
    // north and south edges 32, plus the log's 5 free faces. Without the update it is 560.
    expect(faces).toBe(255 + 256 + 16 + 32 + 5);
  });

  it('removes a marker that leaves the feed', () => {
    const { state, view } = play();
    // A page without them is not a removal; only silence is (see entities.test.ts).
    view.update(state.apply({ type: 'entity_positions', entities: [] }, Date.now() + 60_000));
    expect(view.markerIds()).toEqual([]);
  });

  it('orbits around the focus point', () => {
    const { view } = play();
    const before = view.camera.position.clone();
    view.orbit(1, 0);
    const after = view.camera.position;
    expect(after.distanceTo(before)).toBeGreaterThan(1);
    // radius is unchanged by yaw
    const centre = { x: 4.5, y: 1, z: 4.5 };
    const r = (p: { x: number; y: number; z: number }) =>
      Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z);
    expect(r(after)).toBeCloseTo(r(before), 5);
    view.orbit(0, 0, -1000);
    expect(r(view.camera.position)).toBeCloseTo(2, 5);
  });
});

describe('KinoScene.dispose (decision 0161: a monitor drops its scene on each retune)', () => {
  it('frees the scene geometries and keeps the shared material of the caller', () => {
    const { state, view } = play();
    // The caller's material (in production the texture atlas, shared by every monitor).
    const base = (view as unknown as { base: { addEventListener(t: string, f: () => void): void } })
      .base;
    const freed: string[] = [];
    base.addEventListener('dispose', () => freed.push('base'));
    expect(state.world.keys().length).toBeGreaterThan(0);
    const geometry = view.sectionMesh('0,0,0')?.geometry;
    let geometryFreed = false;
    geometry?.addEventListener('dispose', () => {
      geometryFreed = true;
    });
    view.dispose();
    expect(geometryFreed).toBe(true);
    expect(freed).toEqual([]);
    expect(view.scene.children).toHaveLength(0);
    expect(view.sectionKeys()).toEqual([]);
  });
});
