// Decision 0166, from the PR review: recentring onto the agent's current heading, the swoop's collision,
// headings across +-180 degrees, negative steps, the free-fly turn direction, the view kept across a
// switch from free-fly to orbit, and the camera reading the current entity page only.

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../web/kino/camera/collision.ts';
import {
  newChase,
  ROTATE_STEP,
  recentreChase,
  rotateChase,
  stepChase,
  swoopChase,
  wrapAngle,
  yawBehind,
} from '../../../web/kino/camera/lakitu.ts';
import { CameraRig } from '../../../web/kino/camera/rig.ts';
import { FeedState } from '../../../web/kino/feed.ts';
import { encodePaletteIndices } from '../../../web/kino/palette.ts';
import { VoxelWorld } from '../../../web/kino/world.ts';

const AGENT: Vec3 = { x: 0.5, y: 0, z: 0.5 };

function airWorld(): VoxelWorld {
  const w = new VoxelWorld();
  for (let cx = -2; cx <= 2; cx++)
    for (let sy = -2; sy <= 2; sy++)
      for (let cz = -2; cz <= 2; cz++)
        w.applySection({
          type: 'chunk_section',
          chunk_x: cx,
          chunk_z: cz,
          section_y: sy,
          palette: ['minecraft:air'],
          bits: 1,
          data: encodePaletteIndices(new Uint16Array(4096), 1),
        });
  return w;
}

function run(
  s: ReturnType<typeof newChase>,
  w: VoxelWorld,
  seconds: number,
  at: (t: number) => { target: Vec3; heading: number | null },
): Vec3 {
  let p: Vec3 = { x: 0, y: 0, z: 0 };
  const dt = 1 / 60;
  for (let t = 0; t < seconds - 1e-9; t += dt) p = stepChase(s, w, { ...at(t), dt });
  return p;
}

const yawAround = (cam: Vec3, agent: Vec3): number => Math.atan2(cam.x - agent.x, cam.z - agent.z);

describe('chase recentre', () => {
  it('swings behind the heading the agent turned to while standing still', () => {
    const w = airWorld();
    const s = newChase();
    run(s, w, 1, () => ({ target: AGENT, heading: 0 }));
    // It turns to face -x (yaw 90) on the spot: the lazy swing leaves the camera where it was.
    run(s, w, 2, () => ({ target: AGENT, heading: 90 }));
    expect(Math.abs(wrapAngle((s.baseYaw as number) - yawBehind(0)))).toBeLessThan(1e-9);
    recentreChase(s);
    const p = run(s, w, 2, () => ({ target: AGENT, heading: 90 }));
    expect(wrapAngle(yawAround(p, AGENT) - yawBehind(90))).toBeCloseTo(0, 2);
    expect(p.x).toBeGreaterThan(AGENT.x + 4);
  });

  it('keeps a viewer rotation made after the recentre', () => {
    const w = airWorld();
    const s = newChase();
    run(s, w, 1, () => ({ target: AGENT, heading: 0 }));
    recentreChase(s);
    rotateChase(s, -1);
    const p = run(s, w, 2, () => ({ target: AGENT, heading: 0 }));
    expect(wrapAngle(yawAround(p, AGENT) - (yawBehind(0) - ROTATE_STEP))).toBeCloseTo(0, 2);
  });
});

describe('chase swoop', () => {
  it('stops at a roof instead of flying in through the ground above the agent', () => {
    const w = airWorld();
    for (let x = -20; x <= 30; x++)
      for (let z = -20; z <= 30; z++)
        w.applyUpdate({ type: 'block_update', pos: { x, y: 4, z }, state: 'minecraft:stone' });
    const s = newChase();
    swoopChase(s, false);
    let highest = Number.NEGATIVE_INFINITY;
    run(s, w, 0.5, () => ({ target: AGENT, heading: 0 }));
    for (let i = 0; i < 30; i++) {
      const p = stepChase(s, w, { target: AGENT, heading: 0, dt: 1 / 60 });
      highest = Math.max(highest, p.y);
    }
    expect(s.swoop).toBeGreaterThan(0.3);
    expect(highest).toBeLessThan(4);
  });
});

describe('headings across +-180 degrees and negative steps', () => {
  it('behind a heading of 180 and of -180 is the same place', () => {
    expect(wrapAngle(yawBehind(180) - yawBehind(-180))).toBeCloseTo(0, 9);
    expect(wrapAngle(yawBehind(179) - yawBehind(-179))).toBeCloseTo((2 * Math.PI) / 180, 9);
  });

  it('a walking agent whose heading crosses 180 does not swing the camera the long way round', () => {
    const w = airWorld();
    const s = newChase();
    let z = 0;
    const walk = (heading: number) => (t: number) => {
      z = -t * 4;
      return { target: { x: 0.5, y: 0, z }, heading };
    };
    run(s, w, 2, walk(179));
    const before = s.baseYaw as number;
    const step = run(s, w, 0.2, walk(-179));
    expect(Math.abs(wrapAngle((s.baseYaw as number) - before))).toBeLessThan(0.05);
    expect(step.z).toBeGreaterThan(z + 4);
  });

  it('a negative step turns the chase camera to its left', () => {
    const w = airWorld();
    const s = newChase();
    run(s, w, 1, () => ({ target: AGENT, heading: 0 }));
    rotateChase(s, -1);
    const p = run(s, w, 2, () => ({ target: AGENT, heading: 0 }));
    expect(wrapAngle(yawAround(p, AGENT) - (yawBehind(0) - ROTATE_STEP))).toBeCloseTo(0, 2);
  });
});

describe('the rig on mode changes and free-fly turns', () => {
  const settle = (rig: CameraRig, w: VoxelWorld, seconds: number): Vec3 => {
    let p: Vec3 = rig.position;
    for (let t = 0; t < seconds; t += 1 / 60) {
      p = rig.update(w, AGENT, 1 / 60);
      rig.lookTarget(AGENT);
    }
    return p;
  };

  it('"rotate right" turns the free-fly view to the right, and a negative step to the left', () => {
    const w = airWorld();
    const rig = new CameraRig();
    rig.setMode('free');
    rig.position = { x: 0.5, y: 5, z: 10 };
    rig.yaw = 0;
    rig.yawGoal = 0;
    rig.pitch = 0;
    // Facing -z, the viewer's right is +x.
    rig.rotateStep(1);
    settle(rig, w, 2);
    const right = rig.lookTarget(null);
    expect(right.x).toBeGreaterThan(rig.position.x + 0.5);
    rig.rotateStep(-2);
    settle(rig, w, 2);
    expect(rig.lookTarget(null).x).toBeLessThan(rig.position.x - 0.5);
  });

  it('orbit starts where free-fly left the camera, with that distance as its radius', () => {
    const w = airWorld();
    const rig = new CameraRig();
    rig.setMode('orbit');
    settle(rig, w, 1);
    rig.setMode('free');
    rig.move = { right: 1, up: 0.5, forward: -1 };
    settle(rig, w, 0.7);
    rig.move = { right: 0, up: 0, forward: 0 };
    settle(rig, w, 1);
    const left = { ...rig.position };
    const eye = { x: AGENT.x, y: AGENT.y + 1.6, z: AGENT.z };
    const dist = Math.hypot(left.x - eye.x, left.y - eye.y, left.z - eye.z);
    expect(Math.abs(dist - 24)).toBeGreaterThan(3);
    rig.setMode('orbit');
    expect(rig.radius).toBeCloseTo(dist, 6);
    const next = rig.update(w, AGENT, 1 / 60);
    expect(Math.hypot(next.x - left.x, next.y - left.y, next.z - left.z)).toBeLessThan(0.5);
  });
});

describe('feed focus', () => {
  it('a page without the agent never puts back its stale position after a newer target_moved', () => {
    const f = new FeedState();
    f.apply({
      type: 'hello',
      feed_version: 1,
      world: 'w',
      target_agent_id: 'ag_a',
      view_radius: 2,
    });
    const me = { id: 'e1', type: 'minecraft:player', agent_id: 'ag_a', yaw: 0, pitch: 0 };
    f.apply({ type: 'entity_positions', entities: [{ ...me, x: 1, y: 0, z: 1 }] });
    f.apply({ type: 'target_moved', target_agent_id: 'ag_a', x: 17, y: 0, z: 1 });
    const other = { id: 'e2', type: 'minecraft:player', agent_id: 'ag_b', yaw: 0, pitch: 0 };
    f.apply({ type: 'entity_positions', entities: [{ ...other, x: 5, y: 0, z: 5 }] });
    expect(f.focus).toEqual({ x: 17, y: 0, z: 1 });
  });
});
