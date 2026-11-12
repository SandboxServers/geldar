/**
 * The `heard_sound` event (PX-4, decision 0154 ruling 3, PROVISIONAL vocabulary 0143). A sound the Body hears
 * within 24 blocks leaves as a sound kind, a world-fixed compass point and a distance band. No coordinates
 * leave the Golem. Shape: contract/schemas/heard-sound-event.schema.json.
 */
import { validateHeardSoundEvent } from '@geldar/contract';
import type { Bot } from 'mineflayer';

/** A sound farther than this many blocks is not heard. */
export const HEARING_RADIUS = 24;
/** Distances up to this many blocks read as `near`. */
export const NEAR_MAX = 8;
/** Distances up to this many blocks read as `mid`; beyond it, up to the radius, `far`. */
export const MID_MAX = 16;
/** At most one event per sound kind in this many milliseconds. */
export const SOUND_LIMIT_MS = 10_000;

export type SoundKind = 'hiss' | 'bow' | 'groan' | 'growl' | 'explosion' | 'thunder' | 'digging';
export type SoundBand = 'near' | 'mid' | 'far';
export type CompassPoint = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export interface HeardSound {
  type: 'heard_sound';
  sound: SoundKind;
  dir: CompassPoint;
  band: SoundBand;
}

/** Minecraft sound names the Body maps to a kind. Any other sound is not reported. */
const SOUND_NAMES: ReadonlyMap<string, SoundKind> = new Map([
  ['entity.creeper.primed', 'hiss'],
  ['entity.skeleton.shoot', 'bow'],
  ['entity.zombie.ambient', 'groan'],
  ['entity.wolf.growl', 'growl'],
  ['entity.generic.explode', 'explosion'],
  ['entity.lightning_bolt.thunder', 'thunder'],
  ['block.stone.break', 'digging'],
]);

const POINTS: readonly CompassPoint[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** The kind for a Minecraft sound name, or null when the name is not one the Body reports. */
export function soundKindOf(name: unknown): SoundKind | null {
  return typeof name === 'string' ? (SOUND_NAMES.get(name) ?? null) : null;
}

/**
 * The world-fixed point of a horizontal offset: north is -z, south is +z, east is +x, west is -x. Not the
 * facing. A zero offset reads as north.
 */
export function pointOf(dx: number, dz: number): CompassPoint {
  const index = Math.round(Math.atan2(dx, -dz) / (Math.PI / 4));
  return POINTS[((index % 8) + 8) % 8] ?? 'n';
}

/** The distance band of a distance in blocks, or null beyond the hearing radius. */
export function bandOf(distance: number): SoundBand | null {
  if (distance <= NEAR_MAX) return 'near';
  if (distance <= MID_MAX) return 'mid';
  if (distance <= HEARING_RADIUS) return 'far';
  return null;
}

/**
 * Passes each heard sound to `report` as a `HeardSound`. A sound is dropped when its name is unknown, its
 * position is missing, it is beyond the radius, or the same kind was reported less than `SOUND_LIMIT_MS`
 * ago (`now` is in milliseconds). Returns the detach function, which stops all reporting.
 */
export function watchSounds(
  bot: Bot,
  report: (sound: HeardSound) => void,
  now: () => number = Date.now,
): () => void {
  const lastReported = new Map<SoundKind, number>();
  let closed = false;
  const onSound = (name: string, position: Point3 | null | undefined): void => {
    if (closed) return;
    const self = bot.entity;
    if (self === undefined || position === null || position === undefined) return;
    const kind = soundKindOf(name);
    if (kind === null) return;
    const dx = position.x - self.position.x;
    const dy = position.y - self.position.y;
    const dz = position.z - self.position.z;
    const band = bandOf(Math.hypot(dx, dy, dz));
    if (band === null) return;
    const at = now();
    const last = lastReported.get(kind);
    if (last !== undefined && at - last < SOUND_LIMIT_MS) return;
    const event: HeardSound = { type: 'heard_sound', sound: kind, dir: pointOf(dx, dz), band };
    if (!validateHeardSoundEvent(event)) return;
    lastReported.set(kind, at);
    report(event);
  };
  bot.on('soundEffectHeard', onSound);
  return () => {
    closed = true;
    bot.off('soundEffectHeard', onSound);
    lastReported.clear();
  };
}
