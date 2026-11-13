// Decision 0161: the Lakitu chase camera, the rig's orbit and free-fly feel, and camera collision that
// passes see-through blocks.

import { describe, expect, it } from 'vitest';
import { blocksCamera, collides, type Vec3 } from '../../../web/kino/camera/collision.ts';
import {
  clearDistance,
  newChase,
  ROTATE_STEP,
  recentreChase,
  rotateChase,
  SWOOP_SECONDS,
  stepChase,
  swoopChase,
  wrapAngle,
  yawBehind,
  ZOOM_LEVELS,
  zoomChase,
} from '../../../web/kino/camera/lakitu.ts';
import { CameraRig } from '../../../web/kino/camera/rig.ts';
import { FeedState } from '../../../web/kino/feed.ts';
import { encodePaletteIndices } from '../../../web/kino/palette.ts';
import { VoxelWorld } from '../../../web/kino/world.ts';

const AIR = 'minecraft:air';
const STONE = 'minecraft:stone';
const LEAVES = 'minecraft:oak_leaves[persistent=true]';

/** All-air sections, chunks and sections -2..2 (blocks -32..47). */
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
          palette: [AIR],
          bits: 1,
          data: encodePaletteIndices(new Uint16Array(4096), 1),
        });
  return w;
}

/** A plane at z = coord, covering x and y from -20 to 30. */
function wallZ(w: VoxelWorld, z: number, state: string): void {
  for (let x = -20; x <= 30; x++)
    for (let y = -20; y <= 30; y++)
      w.applyUpdate({ type: 'block_update', pos: { x, y, z }, state });
}

const AGENT: Vec3 = { x: 0.5, y: 0, z: 0.5 };

/** Runs the chase camera for `seconds` in 1/60 s frames; `at` gives the agent and heading per time. */
function run(
  s: ReturnType<typeof newChase>,
  w: VoxelWorld,
  seconds: number,
  at: (t: number) => { target: Vec3; heading: number | null },
  t0 = 0,
): Vec3 {
  let p: Vec3 = { x: 0, y: 0, z: 0 };
  const dt = 1 / 60;
  for (let t = t0; t < t0 + seconds - 1e-9; t += dt) p = stepChase(s, w, { ...at(t), dt });
  return p;
}

/** The camera's yaw round the agent (orbitGoal convention: 0 is +z). */
const yawAround = (cam: Vec3, agent: Vec3): number => Math.atan2(cam.x - agent.x, cam.z - agent.z);

describe('chase camera: behind the agent', () => {
  it('sits behind an agent facing +z (yaw 0) and behind one facing -x (yaw 90)', () => {
    const w = airWorld();
    const a = run(newChase(), w, 0.5, () => ({ target: AGENT, heading: 0 }));
    expect(a.z).toBeLessThan(AGENT.z - 4);
    expect(Math.abs(a.x - AGENT.x)).toBeLessThan(0.01);
    const b = run(newChase(), w, 0.5, () => ({ target: AGENT, heading: 90 }));
    expect(b.x).toBeGreaterThan(AGENT.x + 4);
    expect(yawBehind(90)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('uses the direction of movement when the feed has no heading', () => {
    const w = airWorld();
    // Walking towards +x at 4 blocks per second: the camera ends up on the -x side.
    const p = run(newChase(), w, 3, (t) => ({ target: { x: t * 4, y: 0, z: 0.5 }, heading: null }));
    expect(p.x).toBeLessThan(3 * 4 - 3);
  });

  it('swings lazily behind a moving agent that turns, and not at all for one turning on the spot', () => {
    const w = airWorld();
    const s = newChase();
    run(s, w, 1, (t) => ({ target: { x: 0.5, y: 0, z: 0.5 + t * 4 }, heading: 0 }));
    const before = s.baseYaw as number;
    // The agent turns to face -x and keeps walking that way.
    const walk = (t: number) => ({ target: { x: 0.5 - (t - 1) * 4, y: 0, z: 4.5 }, heading: 90 });
    run(s, w, 1 / 60, walk, 1);
    const goal = yawBehind(90);
    const firstStep = Math.abs(wrapAngle((s.baseYaw as number) - before));
    expect(firstStep).toBeGreaterThan(0);
    expect(firstStep).toBeLessThan(Math.abs(wrapAngle(goal - before)) * 0.1);
    run(s, w, 3, walk, 1 + 1 / 60);
    expect(Math.abs(wrapAngle((s.baseYaw as number) - goal))).toBeLessThan(0.05);

    const still = newChase();
    run(still, w, 1, () => ({ target: AGENT, heading: 0 }));
    const fixed = still.baseYaw;
    run(still, w, 2, (t) => ({ target: AGENT, heading: Math.sin(t * 5) * 120 }), 1);
    expect(still.baseYaw).toBe(fixed);
  });
});

describe('chase camera: viewer controls (view-only)', () => {
  it('rotates in 45-degree steps, eased rather than jumping', () => {
    const w = airWorld();
    const s = newChase();
    run(s, w, 0.5, () => ({ target: AGENT, heading: 0 }));
    rotateChase(s, 2);
    expect(s.offsetGoal).toBeCloseTo(2 * ROTATE_STEP, 9);
    const one = run(s, w, 1 / 60, () => ({ target: AGENT, heading: 0 }));
    expect(Math.abs(wrapAngle(yawAround(one, AGENT) - Math.PI))).toBeLessThan(ROTATE_STEP);
    const done = run(s, w, 2, () => ({ target: AGENT, heading: 0 }));
    expect(wrapAngle(yawAround(done, AGENT) - (Math.PI + 2 * ROTATE_STEP))).toBeCloseTo(0, 2);
    recentreChase(s);
    const back = run(s, w, 2, () => ({ target: AGENT, heading: 0 }));
    expect(wrapAngle(yawAround(back, AGENT) - Math.PI)).toBeCloseTo(0, 2);
  });

  it('steps through three zoom distances and refuses past either end', () => {
    const w = airWorld();
    const s = newChase();
    const dist = (): number => {
      const p = run(s, w, 2, () => ({ target: AGENT, heading: 0 }));
      return Math.hypot(p.x - AGENT.x, p.z - AGENT.z);
    };
    expect(ZOOM_LEVELS).toHaveLength(3);
    const mid = dist();
    expect(zoomChase(s, -1)).toBe(true);
    const close = dist();
    expect(zoomChase(s, -1)).toBe(false);
    expect(zoomChase(s, 2)).toBe(true);
    const far = dist();
    expect(zoomChase(s, 1)).toBe(false);
    expect(close).toBeLessThan(mid);
    expect(mid).toBeLessThan(far);
  });

  it('swoops in from high and far on a new target, and appears in place under reduced motion', () => {
    const w = airWorld();
    const s = newChase();
    swoopChase(s, false);
    const start = run(s, w, 1 / 60, () => ({ target: AGENT, heading: 0 }));
    const settled = run(s, w, SWOOP_SECONDS + 1, () => ({ target: AGENT, heading: 0 }));
    expect(start.y).toBeGreaterThan(settled.y + 8);
    const calm = newChase();
    swoopChase(calm, true);
    const first = run(calm, w, 1 / 60, () => ({ target: AGENT, heading: 0 }));
    expect(first.y).toBeCloseTo(settled.y, 0);
  });
});

describe('chase camera: walls', () => {
  it('pushes in at once against a stone wall, and eases back out when it is gone', () => {
    const w = airWorld();
    wallZ(w, -3, STONE);
    const s = newChase();
    const p = run(s, w, 0.5, () => ({ target: AGENT, heading: 0 }));
    expect(p.z).toBeGreaterThan(-2);
    expect(collides(w, p)).toBe(false);
    wallZ(w, -3, AIR);
    const next = run(s, w, 1 / 60, () => ({ target: AGENT, heading: 0 }));
    expect(next.z).toBeGreaterThan(-2.5);
    const later = run(s, w, 4, () => ({ target: AGENT, heading: 0 }));
    expect(later.z).toBeLessThan(-5);
  });

  it('is not pushed in by leaves, which the renderer fades instead', () => {
    const w = airWorld();
    wallZ(w, -3, LEAVES);
    const p = run(newChase(), w, 0.5, () => ({ target: AGENT, heading: 0 }));
    expect(p.z).toBeLessThan(-5);
  });

  it('is not swallowed when the agent eyes are in a block (the ray starts once it is clear of them)', () => {
    const w = airWorld();
    // A stone column the agent's eye box sits half inside (a feed position a little off, a thin wall).
    for (let y = -5; y <= 10; y++)
      w.applyUpdate({ type: 'block_update', pos: { x: 0, y, z: 1 }, state: STONE });
    const agent = { x: 0.5, y: 0, z: 1.4 };
    const p = run(newChase(), w, 0.5, () => ({ target: agent, heading: 0 }));
    expect(agent.z - p.z).toBeGreaterThan(5);
    // Fully inside a block, there is nowhere clear to start from: the camera stays at the eyes.
    expect(clearDistance(w, { x: 0.5, y: 1.5, z: 1.5 }, { x: 0.5, y: 1.5, z: 1.5 })).toBe(0);
  });

  it('measures the clear distance up to the first blocking block', () => {
    const w = airWorld();
    wallZ(w, 5, STONE);
    const d = clearDistance(w, { x: 0.5, y: 1.5, z: 0.5 }, { x: 0.5, y: 1.5, z: 10.5 });
    expect(d).toBeGreaterThan(3.5);
    expect(d).toBeLessThan(4.5);
  });
});

describe('camera collision passes see-through blocks and plants (decision 0161)', () => {
  it('stops at opaque cubes and box shapes, not at leaves, glass, water or plants', () => {
    expect(blocksCamera(STONE)).toBe(true);
    expect(blocksCamera('minecraft:oak_stairs[facing=north,half=bottom,shape=straight]')).toBe(
      true,
    );
    expect(blocksCamera(undefined)).toBe(true);
    expect(blocksCamera(LEAVES)).toBe(false);
    expect(blocksCamera('minecraft:glass')).toBe(false);
    expect(blocksCamera('minecraft:water[level=0]')).toBe(false);
    expect(blocksCamera('minecraft:short_grass')).toBe(false);
    expect(blocksCamera('minecraft:poppy')).toBe(false);
    expect(blocksCamera(AIR)).toBe(false);
  });

  it('lets the orbit camera keep its radius through a canopy', () => {
    const w = airWorld();
    wallZ(w, 6, LEAVES);
    const rig = new CameraRig();
    rig.setMode('orbit');
    rig.yaw = 0;
    rig.yawGoal = 0;
    rig.pitch = 0;
    rig.radius = 12;
    const p = rig.update(w, AGENT, 1 / 60);
    expect(p.z - AGENT.z).toBeGreaterThan(11);
  });
});

describe('rig: modes keep the view, orbit drifts, free-fly accelerates', () => {
  it('starts orbit from where the chase camera was, looking the same way', () => {
    const w = airWorld();
    const rig = new CameraRig();
    for (let i = 0; i < 60; i++) rig.update(w, AGENT, 1 / 60, 30);
    const before = { ...rig.position };
    rig.lookTarget(AGENT);
    rig.setMode('orbit');
    const after = rig.update(w, AGENT, 1 / 60);
    expect(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)).toBeLessThan(
      0.05,
    );
  });

  it('drifts round the agent after a few idle seconds, not under reduced motion, and stops on input', () => {
    const w = airWorld();
    const drift = (reduced: boolean): number => {
      const rig = new CameraRig();
      rig.reducedMotion = reduced;
      rig.setMode('orbit');
      for (let i = 0; i < 60 * 8; i++) rig.update(w, AGENT, 1 / 60);
      return rig.yaw;
    };
    expect(drift(false)).toBeGreaterThan(0.2);
    expect(drift(true)).toBe(0);
  });

  it('eases free-fly up to speed instead of starting dead', () => {
    const w = airWorld();
    const rig = new CameraRig();
    rig.position = { x: 0.5, y: 5, z: 0.5 };
    rig.setMode('free');
    rig.move = { right: 0, up: 0, forward: 1 };
    rig.update(w, null, 1 / 60);
    expect(rig.velocity.forward).toBeGreaterThan(0);
    expect(rig.velocity.forward).toBeLessThan(0.3);
    for (let i = 0; i < 60; i++) rig.update(w, null, 1 / 60);
    expect(rig.velocity.forward).toBeGreaterThan(0.95);
  });

  it('steps rotation and zoom in follow through the chase camera', () => {
    const rig = new CameraRig();
    rig.rotateStep(1);
    expect(rig.chase.offsetGoal).toBeCloseTo(ROTATE_STEP, 9);
    rig.zoomStep(1);
    expect(rig.chase.zoom).toBe(2);
    rig.zoom(-50);
    expect(rig.chase.zoom).toBe(1);
  });
});

describe('feed heading', () => {
  it('takes the heading from the followed agent only', () => {
    const f = new FeedState();
    f.apply({
      type: 'hello',
      feed_version: 1,
      world: 'w',
      target_agent_id: 'ag_a',
      view_radius: 2,
    });
    f.apply({
      type: 'entity_positions',
      entities: [
        {
          id: 'e1',
          type: 'minecraft:player',
          agent_id: 'ag_b',
          x: 0,
          y: 0,
          z: 0,
          yaw: 45,
          pitch: 0,
        },
      ],
    });
    expect(f.heading).toBeNull();
    f.apply({
      type: 'entity_positions',
      entities: [
        {
          id: 'e2',
          type: 'minecraft:player',
          agent_id: 'ag_a',
          x: 1,
          y: 0,
          z: 1,
          yaw: -90,
          pitch: 0,
        },
      ],
    });
    expect(f.heading).toBe(-90);
    expect(f.target).toBe('ag_a');
  });
});
