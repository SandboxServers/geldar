// The camera rig: mode, view angles and position, advanced once per frame (decision 0161).
//   follow: the Lakitu chase camera (lakitu.ts).
//   orbit:  a collision-bound circle round the agent, eased, drifting slowly when left alone.
//   free:   collision-bound free-fly with acceleration.
// It reads the voxel world and the target position; it sends nothing anywhere.

import type { VoxelWorld } from '../world.ts';
import { collides, type Vec3 } from './collision.ts';
import {
  type ChaseState,
  dragChase,
  newChase,
  ROTATE_STEP,
  recentreChase,
  rotateChase,
  stepChase,
  swoopChase,
  zoomChase,
} from './lakitu.ts';
import {
  type CameraMode,
  clamp,
  lookPoint,
  MAX_PITCH,
  MAX_RADIUS,
  MIN_RADIUS,
  orbitPosition,
  stepFree,
} from './modes.ts';

export interface MoveInput {
  right: number;
  up: number;
  forward: number;
}

export const FREE_SPEED = 12; // blocks per second
/** Free-fly acceleration (per second, exponential): about a fifth of a second to full speed. */
export const FREE_ACCEL = 8;
/** Orbit: idle seconds before the turntable drift starts, and its speed in radians per second. */
export const ORBIT_DRIFT_AFTER = 5;
export const ORBIT_DRIFT_SPEED = 0.12;
const ORBIT_EASE = 8;
/** Each zoom step scales the orbit radius by this. */
const ORBIT_ZOOM_STEP = 0.75;

export class CameraRig {
  mode: CameraMode = 'follow';
  /** Orbit and free-fly view angles: shown and wanted (a stepped rotation eases to the goal). */
  yaw = 0;
  pitch = 0.5;
  yawGoal = 0;
  radius = 24;
  position: Vec3 = { x: 0, y: 0, z: 0 };
  chase: ChaseState = newChase();
  move: MoveInput = { right: 0, up: 0, forward: 0 };
  /** Free-fly velocity in input units (-1..1 per axis), eased towards `move`. */
  velocity: MoveInput = { right: 0, up: 0, forward: 0 };
  /** One-shot forward distance in blocks (touch pinch in free-fly), consumed by update. */
  impulse = 0;
  /** Seconds since the last viewer input (orbit drift). */
  idle = 0;
  /** No swoops and no drift (prefers-reduced-motion). */
  reducedMotion = false;

  setMode(mode: CameraMode): void {
    // Orbit and free-fly start from the view on screen: same place, looking the same way.
    if (mode !== this.mode && mode !== 'follow' && this.lastLook) this.adoptView(this.lastLook);
    this.mode = mode;
    this.idle = 0;
    if (mode === 'free') {
      // Free-fly starts where the camera is, looking the way it was looking.
      this.move = { right: 0, up: 0, forward: 0 };
      this.velocity = { right: 0, up: 0, forward: 0 };
    }
  }

  /** The last point lookTarget returned, so a mode change keeps the view. */
  private lastLook: Vec3 | null = null;

  /** Sets yaw, pitch and radius so that the orbit or free view matches a camera at `position` looking at `look`. */
  private adoptView(look: Vec3): void {
    const dx = this.position.x - look.x;
    const dy = this.position.y - look.y;
    const dz = this.position.z - look.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) return;
    this.yaw = Math.atan2(dx, dz);
    this.yawGoal = this.yaw;
    this.pitch = clamp(Math.asin(dy / d), -MAX_PITCH, MAX_PITCH);
    if (this.mode !== 'free') this.radius = clamp(d, MIN_RADIUS, MAX_RADIUS);
  }

  /** A new target: the chase camera swoops in. */
  retarget(): void {
    swoopChase(this.chase, this.reducedMotion);
  }

  /** Mouse drag or one-finger drag: turns the view (all modes). */
  look(dYaw: number, dPitch: number): void {
    this.idle = 0;
    if (this.mode === 'follow') {
      dragChase(this.chase, dYaw);
      return;
    }
    this.yaw += dYaw;
    this.yawGoal = this.yaw;
    this.pitch = clamp(this.pitch + dPitch, -MAX_PITCH, MAX_PITCH);
  }

  /** Wheel or pinch: the orbit radius, continuously. In follow, a wheel notch steps the zoom level. */
  zoom(dRadius: number): void {
    this.idle = 0;
    if (this.mode === 'follow') {
      if (dRadius !== 0) zoomChase(this.chase, Math.sign(dRadius));
      return;
    }
    this.radius = clamp(this.radius + dRadius, MIN_RADIUS, MAX_RADIUS);
  }

  /** The C-button rotation: 45 degrees round the agent per step (positive: to the camera's right). */
  rotateStep(steps: number): void {
    this.idle = 0;
    if (this.mode === 'follow') rotateChase(this.chase, steps);
    else this.yawGoal += steps * ROTATE_STEP;
  }

  /** Stepped zoom: a level in follow, a quarter of the radius in orbit, a short hop in free-fly. */
  zoomStep(steps: number): void {
    this.idle = 0;
    if (this.mode === 'follow') zoomChase(this.chase, steps);
    else if (this.mode === 'orbit')
      this.radius = clamp(this.radius * ORBIT_ZOOM_STEP ** -steps, MIN_RADIUS, MAX_RADIUS);
    else this.fly(-steps * 4);
  }

  /** Back behind the agent (follow), or level the view (orbit and free). */
  recentre(): void {
    this.idle = 0;
    if (this.mode === 'follow') recentreChase(this.chase);
    else this.pitch = 0.5;
  }

  /** Touch free-fly: fly forward by `blocks` (negative: back) on the next update. */
  fly(blocks: number): void {
    this.impulse += blocks;
  }

  /**
   * Advances the camera by dt seconds. `target` is the followed agent's feet, or null; `heading` is
   * its Minecraft yaw in degrees when the feed has its entity.
   */
  update(world: VoxelWorld, target: Vec3 | null, dt: number, heading: number | null = null): Vec3 {
    this.idle += dt;
    if (this.mode === 'follow' && target) {
      this.position = stepChase(this.chase, world, { target, heading, dt });
      return this.position;
    }
    // A camera that starts in (or is built into) a solid restarts from the orbit position.
    if (target && collides(world, this.position)) {
      this.position = orbitPosition(world, target, this.yaw, this.pitch, this.radius);
    }
    if (this.mode === 'orbit' && target) {
      if (!this.reducedMotion && this.idle > ORBIT_DRIFT_AFTER)
        this.yawGoal += ORBIT_DRIFT_SPEED * dt;
      this.yaw += (this.yawGoal - this.yaw) * (1 - Math.exp(-dt * ORBIT_EASE));
      this.position = orbitPosition(world, target, this.yaw, this.pitch, this.radius);
    } else if (this.mode === 'free') {
      this.yaw += (this.yawGoal - this.yaw) * (1 - Math.exp(-dt * ORBIT_EASE));
      const k = 1 - Math.exp(-dt * FREE_ACCEL);
      const v = this.velocity;
      v.right += (this.move.right - v.right) * k;
      v.up += (this.move.up - v.up) * k;
      v.forward += (this.move.forward - v.forward) * k;
      this.position = stepFree(world, this.position, this.yaw, this.pitch, v, FREE_SPEED, dt);
      if (this.impulse !== 0) {
        const f = { right: 0, up: 0, forward: Math.sign(this.impulse) };
        const d = Math.abs(this.impulse);
        this.position = stepFree(world, this.position, this.yaw, this.pitch, f, 1, d);
        this.impulse = 0;
      }
    }
    return this.position;
  }

  /** The point to lookAt: the agent in follow and orbit, straight ahead in free-fly. */
  lookTarget(target: Vec3 | null): Vec3 {
    this.lastLook = this.mode !== 'free' && target ? lookPoint(target) : this.ahead();
    return this.lastLook;
  }

  private ahead(): Vec3 {
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
