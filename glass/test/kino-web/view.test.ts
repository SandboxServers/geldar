// K13: see-through foliage policy, the depth-ghost agent, follow candidate selection and blending.

import { describe, expect, it } from 'vitest';
import { GHOST_OPACITY } from '../../web/kino/agent-ghost.ts';
import { followCandidates, pickFollowIndex } from '../../web/kino/camera/follow-pick.ts';
import { CameraRig } from '../../web/kino/camera/rig.ts';
import {
  distanceToSegment,
  FADE_CAMERA_RADIUS,
  FADE_FRAGMENT_BODY,
  FADE_LINE_RADIUS,
  FADE_OPACITY,
  seeThroughOpacity,
} from '../../web/kino/fade.ts';
import { softOf } from '../../web/kino/mesher.ts';
import { encodePaletteIndices } from '../../web/kino/palette.ts';
import { VoxelWorld } from '../../web/kino/world.ts';

const AIR = 'minecraft:air';
const LEAVES = 'minecraft:oak_leaves[persistent=true]';

function airWorld(): VoxelWorld {
  const w = new VoxelWorld();
  for (let cx = -1; cx <= 1; cx++)
    for (let sy = -1; sy <= 1; sy++)
      for (let cz = -1; cz <= 1; cz++)
        w.applySection({
          type: 'chunk_section',
          chunk_x: cx,
          chunk_z: cz,
          section_y: sy,
          palette: [AIR],
          bits: 1,
          data: encodePaletteIndices(new Uint16Array(4096), 1),
        });
  return w;
}

/** A wall of leaves behind the agent (towards +z, where the default follow camera sits). */
function leafWallBehind(): VoxelWorld {
  const w = airWorld();
  for (let x = 2; x <= 14; x++)
    for (let y = 2; y <= 15; y++)
      for (let z = 9; z <= 10; z++)
        w.applyUpdate({ type: 'block_update', pos: { x, y, z }, state: LEAVES });
  return w;
}

const origin = { x: 0, y: 0, z: 0 };
const cam = { x: 0, y: 0, z: 10 };
const agent = { x: 0, y: 0, z: 0 };

describe('see-through rule', () => {
  it('fades within the camera radius and within the line radius', () => {
    expect(seeThroughOpacity({ x: 0, y: 0, z: 9 }, cam, null)).toBe(FADE_OPACITY);
    // 2 blocks off the line, mid-way, 5 from the camera and from the agent
    expect(seeThroughOpacity({ x: FADE_LINE_RADIUS - 1, y: 0, z: 5 }, cam, agent)).toBe(
      FADE_OPACITY,
    );
  });
  it('leaves everything else opaque, and ignores the line without an agent', () => {
    expect(seeThroughOpacity({ x: FADE_LINE_RADIUS + 1, y: 0, z: 5 }, cam, agent)).toBe(1);
    expect(seeThroughOpacity({ x: 0, y: 0, z: 5 }, cam, null)).toBe(1);
    expect(seeThroughOpacity({ x: 0, y: 0, z: 10 - FADE_CAMERA_RADIUS - 0.01 }, cam, null)).toBe(1);
  });
  it('keeps 25-35 percent of pixels', () => {
    expect(FADE_OPACITY).toBeGreaterThanOrEqual(0.25);
    expect(FADE_OPACITY).toBeLessThanOrEqual(0.35);
  });
  it('measures the distance to a segment on both ends and the middle', () => {
    expect(distanceToSegment({ x: 0, y: 0, z: -3 }, origin, cam)).toBeCloseTo(3);
    expect(distanceToSegment({ x: 0, y: 0, z: 14 }, origin, cam)).toBeCloseTo(4);
    expect(distanceToSegment({ x: 2, y: 0, z: 5 }, origin, cam)).toBeCloseTo(2);
    expect(distanceToSegment({ x: 2, y: 0, z: 5 }, origin, origin)).toBeCloseTo(Math.hypot(2, 5));
  });
  it('marks leaves 1, other see-through 0.5, opaque 0, and the shader uses the same constants', () => {
    expect(softOf(LEAVES)).toBe(1);
    expect(softOf('minecraft:glass')).toBe(0.5);
    expect(softOf('minecraft:stone')).toBe(0);
    expect(FADE_FRAGMENT_BODY).toContain(`camD < ${FADE_CAMERA_RADIUS.toFixed(3)}`);
    expect(FADE_FRAGMENT_BODY).toContain(`lineD < ${FADE_LINE_RADIUS.toFixed(3)}`);
    expect(FADE_FRAGMENT_BODY).toContain(`dither >= ${FADE_OPACITY.toFixed(3)}`);
  });
});

describe('agent ghost', () => {
  it('gives an agent marker a translucent copy that ignores depth, hidden when the camera is next to it', async () => {
    const { KinoScene } = await import('../../web/kino/scene.ts');
    const { FeedState } = await import('../../web/kino/feed.ts');
    const state = new FeedState();
    const view = new KinoScene(state, () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }));
    view.update(
      state.apply({
        type: 'entity_positions',
        entities: [
          { id: 'e1', type: 'minecraft:player', agent_id: 'a', x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
        ],
      }),
    );
    const ghost = view.markerOf('e1')?.getObjectByName('ghost') as unknown as {
      material: { depthTest: boolean; transparent: boolean; opacity: number };
      children: unknown[];
      renderOrder: number;
      visible: boolean;
    };
    // K15: the ghost draws only where the figure is occluded (depth GREATER), not over unoccluded pixels.
    expect((ghost.material as unknown as { depthFunc: number }).depthFunc).toBe(6); // three's GreaterDepth
    expect(ghost.material.transparent).toBe(true);
    expect(ghost.material.opacity).toBe(GHOST_OPACITY);
    expect(ghost.children.length).toBe(2);
    expect(ghost.renderOrder).toBeGreaterThan(0);
    view.setFadeFocus({ x: 0, y: 1, z: 8 }, { x: 0, y: 1, z: 0 });
    expect(ghost.visible).toBe(true);
    view.setFadeFocus({ x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: 0 });
    expect(ghost.visible).toBe(false);
  });
});
describe('follow candidates', () => {
  const look = { x: 8, y: 6.6, z: 4 };
  it('offers behind, left, right and higher options', () => {
    const c = followCandidates({ x: 0, y: 3, z: 8 });
    expect(c[0]).toEqual({ x: 0, y: 3, z: 8 });
    expect(c[1]?.x).toBeGreaterThan(5);
    expect(c[2]?.x).toBeLessThan(-5);
    expect(c.some((o) => o.y > 3 + 4)).toBe(true);
  });
  it('keeps the current candidate when the view is clear', () => {
    const c = followCandidates({ x: 0, y: 3, z: 8 });
    expect(pickFollowIndex(airWorld(), look, c, 0)).toBe(0);
    expect(pickFollowIndex(airWorld(), look, c, 2)).toBe(2);
  });
  it('leaves a candidate whose line crosses a leaf wall for a clearer one', () => {
    const c = followCandidates({ x: 0, y: 3, z: 8 });
    const idx = pickFollowIndex(leafWallBehind(), look, c, 0);
    expect(idx).not.toBe(0);
  });
  it('does not switch for a margin smaller than FOLLOW_SWITCH_MARGIN', () => {
    const w = airWorld();
    w.applyUpdate({ type: 'block_update', pos: { x: 8, y: 8, z: 7 }, state: LEAVES });
    const c = followCandidates({ x: 0, y: 3, z: 8 });
    expect(pickFollowIndex(w, look, c, 0)).toBe(0);
  });
  it('abandons a candidate that is inside a solid', () => {
    const w = airWorld();
    for (let x = 6; x <= 10; x++)
      for (let y = 8; y <= 12; y++)
        for (let z = 10; z <= 14; z++)
          w.applyUpdate({ type: 'block_update', pos: { x, y, z }, state: 'minecraft:stone' });
    const c = followCandidates({ x: 0, y: 3, z: 8 });
    expect(pickFollowIndex(w, look, c, 0)).not.toBe(0);
  });
});

describe('rig follow framing', () => {
  it('moves to a clear side and blends instead of jumping', () => {
    const w = leafWallBehind();
    const rig = new CameraRig();
    rig.setMode('follow');
    const target = { x: 8, y: 5, z: 4 };
    rig.update(w, target, 0.016);
    const first = { ...(rig.shownOffset as { x: number; y: number; z: number }) };
    expect(rig.pickIndex).not.toBe(0);
    // the first frame snaps to the pick; a later switch must blend
    rig.pickIndex = 0;
    rig.pickTimer = 10;
    const before = { ...first };
    rig.update(w, target, 0.016);
    const after = rig.shownOffset as { x: number; y: number; z: number };
    const want = followCandidates(rig.followOffset)[0] as { x: number; y: number; z: number };
    const full = Math.hypot(want.x - before.x, want.y - before.y, want.z - before.z);
    const moved = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(full * 0.2);
  });
});
