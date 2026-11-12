// The camera rig: mode, view angles and position, advanced once per frame.
// It reads the voxel world and the target position; it sends nothing anywhere.

import type { VoxelWorld } from '../world.ts';
import { collides, type Vec3 } from './collision.ts';
import { FOLLOW_REPICK_SECONDS, followCandidates, pickFollowIndex } from './follow-pick.ts';
import {
  type CameraMode,
  clamp,
  lookPoint,
  MAX_PITCH,
  MAX_RADIUS,
  MIN_RADIUS,
  orbitPosition,
  stepFollow,
  stepFree,
} from './modes.ts';

export interface MoveInput {
  right: number;
  up: number;
  forward: number;
}

export const FREE_SPEED = 12; // blocks per second
export const FOLLOW_OFFSET: Vec3 = { x: 0, y: 3, z: 8 };

export class CameraRig {
  mode: CameraMode = 'orbit';
  yaw = 0;
  pitch = 0.5;
  radius = 24;
  position: Vec3 = { x: 0, y: 0, z: 0 };
  followOffset: Vec3 = { ...FOLLOW_OFFSET };
  /** Follow framing: the chosen candidate, when it was chosen, and the blended offset in use. */
  pickIndex = 0;
  pickTimer = 0;
  shownOffset: Vec3 | null = null;
  move: MoveInput = { right: 0, up: 0, forward: 0 };
  /** One-shot forward distance in blocks (touch pinch in free-fly), consumed by update. */
  impulse = 0;

  setMode(mode: CameraMode): void {
    this.mode = mode;
    if (mode === 'free') {
      // Free-fly starts where the camera is, looking the way it was looking.
      this.move = { right: 0, up: 0, forward: 0 };
    }
  }

  /** Mouse drag or one-finger drag: turns the view (orbit and free) or swings it (follow). */
  look(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -MAX_PITCH, MAX_PITCH);
  }

  /** Wheel or pinch: the orbit radius, or the follow distance. */
  zoom(dRadius: number): void {
    this.radius = clamp(this.radius + dRadius, MIN_RADIUS, MAX_RADIUS);
  }

  /** Touch free-fly: fly forward by `blocks` (negative: back) on the next update. */
  fly(blocks: number): void {
    this.impulse += blocks;
  }

  /** Advances the camera by dt seconds. `target` is the followed agent's feet, or null. */
  update(world: VoxelWorld, target: Vec3 | null, dt: number): Vec3 {
    // A camera that starts in (or is built into) a solid restarts from the orbit position.
    if (target && collides(world, this.position)) {
      this.position = orbitPosition(world, target, this.yaw, this.pitch, this.radius);
    }
    if (this.mode === 'free' || !target) {
      if (this.mode === 'free') {
        this.position = stepFree(
          world,
          this.position,
          this.yaw,
          this.pitch,
          this.move,
          FREE_SPEED,
          dt,
        );
        if (this.impulse !== 0) {
          const f = { right: 0, up: 0, forward: Math.sign(this.impulse) };
          const d = Math.abs(this.impulse);
          this.position = stepFree(world, this.position, this.yaw, this.pitch, f, 1, d);
          this.impulse = 0;
        }
      }
    } else if (this.mode === 'orbit') {
      this.position = orbitPosition(world, target, this.yaw, this.pitch, this.radius);
    } else {
      this.pickTimer -= dt;
      const cands = followCandidates(this.followOffset);
      if (this.pickTimer <= 0) {
        this.pickTimer = FOLLOW_REPICK_SECONDS;
        this.pickIndex = pickFollowIndex(world, lookPoint(target), cands, this.pickIndex);
      }
      const want = cands[this.pickIndex] ?? this.followOffset;
      // Blend the shown offset towards the chosen one; the first frame (or a jump) snaps.
      const k = this.shownOffset ? 1 - Math.exp(-dt * 3) : 1;
      const s = this.shownOffset ?? want;
      this.shownOffset = {
        x: s.x + (want.x - s.x) * k,
        y: s.y + (want.y - s.y) * k,
        z: s.z + (want.z - s.z) * k,
      };
      this.position = stepFollow(world, this.position, target, this.shownOffset);
    }
    return this.position;
  }

  /** The point to lookAt: the agent in follow and orbit, straight ahead in free-fly. */
  lookTarget(target: Vec3 | null): Vec3 {
    if (this.mode !== 'free' && target) return lookPoint(target);
    const cp = Math.cos(this.pitch);
    return {
      x: this.position.x - Math.sin(this.yaw) * cp,
      y: this.position.y - Math.sin(this.pitch),
      z: this.position.z - Math.cos(this.yaw) * cp,
    };
  }

  /** True when the camera box overlaps a solid (should never hold after update). */
  inside(world: VoxelWorld): boolean {
    return collides(world, this.position);
  }
}
