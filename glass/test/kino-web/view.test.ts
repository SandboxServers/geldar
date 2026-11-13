// K13: see-through foliage policy and the depth-ghost agent. (The chase camera that replaced follow
// candidate selection is tested in camera/lakitu.test.ts, decision 0166.)

import { describe, expect, it } from 'vitest';
import { GHOST_OPACITY } from '../../web/kino/agent-ghost.ts';
import {
  distanceToSegment,
  FADE_CAMERA_RADIUS,
  FADE_FRAGMENT_BODY,
  FADE_LINE_RADIUS,
  FADE_OPACITY,
  seeThroughOpacity,
} from '../../web/kino/fade.ts';
import { softOf } from '../../web/kino/mesher.ts';

const LEAVES = 'minecraft:oak_leaves[persistent=true]';

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
