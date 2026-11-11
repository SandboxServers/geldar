// Camera modes: the target math. Every result goes through moveWithCollision.
// Yaw and pitch are radians; yaw 0 puts the camera on +z of the centre (as scene.ts does).

import type { VoxelWorld } from '../world.ts';
import { moveWithCollision, type Vec3 } from './collision.ts';

export type CameraMode = 'follow' | 'orbit' | 'free';

/** Height of the point the camera looks at above an agent's feet. */
export const EYE_HEIGHT = 1.6;

export const MIN_RADIUS = 2;
export const MAX_RADIUS = 128;
export const MAX_PITCH = 1.5;

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The look-at point for a target agent (feet position in, eye position out). */
export function lookPoint(target: Vec3): Vec3 {
  return { x: target.x, y: target.y + EYE_HEIGHT, z: target.z };
}

/** Follow: where the camera wants to be, a fixed offset from the target's look point. */
export function followGoal(target: Vec3, offset: Vec3): Vec3 {
  const c = lookPoint(target);
  return { x: c.x + offset.x, y: c.y + offset.y, z: c.z + offset.z };
}

/** Follow: moves the camera from `cam` towards the goal, stopping at walls. */
export function stepFollow(world: VoxelWorld, cam: Vec3, target: Vec3, offset: Vec3): Vec3 {
  const g = followGoal(target, offset);
  return moveWithCollision(world, cam, { x: g.x - cam.x, y: g.y - cam.y, z: g.z - cam.z });
}

/** Orbit: the unobstructed point at `radius` from the centre along (yaw, pitch). */
export function orbitGoal(centre: Vec3, yaw: number, pitch: number, radius: number): Vec3 {
  const cp = Math.cos(pitch);
  return {
    x: centre.x + radius * cp * Math.sin(yaw),
    y: centre.y + radius * Math.sin(pitch),
    z: centre.z + radius * cp * Math.cos(yaw),
  };
}

/**
 * Orbit: casts from the look point out to the goal and stops at the first wall, so the radius
 * shrinks against a wall. It is recomputed from the wanted radius each call, so it recovers.
 */
export function orbitPosition(
  world: VoxelWorld,
  target: Vec3,
  yaw: number,
  pitch: number,
  radius: number,
): Vec3 {
  const c = lookPoint(target);
  const g = orbitGoal(c, yaw, pitch, radius);
  return moveAlongRay(world, c, g);
}

function moveAlongRay(world: VoxelWorld, from: Vec3, to: Vec3): Vec3 {
  // Step the ray in increments so a diagonal cast stops at the first solid, not per axis.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / 0.2));
  let p = { ...from };
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const q = { x: from.x + dx * t, y: from.y + dy * t, z: from.z + dz * t };
    const moved = moveWithCollision(world, p, { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z });
    const blocked = Math.hypot(moved.x - q.x, moved.y - q.y, moved.z - q.z) > 1e-6;
    p = moved;
    if (blocked) break;
  }
  return p;
}

/** Free-fly: converts input (right, up, forward in the camera's frame) to a world delta. */
export function freeDelta(
  yaw: number,
  pitch: number,
  input: { right: number; up: number; forward: number },
  speed: number,
  dt: number,
): Vec3 {
  // The camera looks from its position towards (-sin yaw, ., -cos yaw) at pitch 0.
  const cp = Math.cos(pitch);
  const fwd = { x: -Math.sin(yaw) * cp, y: -Math.sin(pitch), z: -Math.cos(yaw) * cp };
  const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  const k = speed * dt;
  return {
    x: (fwd.x * input.forward + right.x * input.right) * k,
    y: (fwd.y * input.forward + input.up) * k,
    z: (fwd.z * input.forward + right.z * input.right) * k,
  };
}

export function stepFree(
  world: VoxelWorld,
  cam: Vec3,
  yaw: number,
  pitch: number,
  input: { right: number; up: number; forward: number },
  speed: number,
  dt: number,
): Vec3 {
  return moveWithCollision(world, cam, freeDelta(yaw, pitch, input, speed, dt));
}
