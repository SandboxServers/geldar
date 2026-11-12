/**
 * The `hurt` event the Body reports when it takes damage (PX-1, decision 0143, PROVISIONAL). It carries
 * no coordinates. `bearing` is where the attacker stood relative to the Body's facing, never compass.
 * Shape: contract/schemas/hurt-event.schema.json.
 */

export const HURT_SOURCES = [
  'melee',
  'arrow',
  'explosion',
  'fall',
  'fire',
  'lava',
  'drowning',
  'starvation',
  'other',
] as const;
export type HurtSource = (typeof HURT_SOURCES)[number];
export type HurtBearing = 'front' | 'left' | 'right' | 'behind';

export interface HurtEvent {
  type: 'hurt';
  source: HurtSource;
  bearing?: HurtBearing;
  amount: number;
}

/** What the Body knows at a hurt: the cause code, who hit it (if known), its pose and the damage. */
export interface HurtInput {
  /** The damage cause code the plugin or the Body reports (for example `ENTITY_ATTACK`). */
  cause: string | undefined;
  /** The attacker's horizontal position, or null when it is not known. */
  attacker: { x: number; z: number } | null;
  /** The Body's position and yaw in radians (Minecraft yaw: 0 faces +z, pi/2 faces -x). */
  self: { x: number; z: number; yaw: number };
  /** Health the Body had before the damage. The amount is capped at this. */
  healthBefore: number;
  /** The raw damage in health points, before rounding. */
  rawDamage: number;
}

const CAUSE_SOURCE: Readonly<Record<string, HurtSource>> = {
  ENTITY_ATTACK: 'melee',
  ENTITY_SWEEP_ATTACK: 'melee',
  PROJECTILE: 'arrow',
  ENTITY_EXPLOSION: 'explosion',
  BLOCK_EXPLOSION: 'explosion',
  FALL: 'fall',
  FIRE: 'fire',
  FIRE_TICK: 'fire',
  LAVA: 'lava',
  DROWNING: 'drowning',
  STARVATION: 'starvation',
};

/** Sources an attacker can cause. An attack with no known attacker reads as `other`. */
const ATTACK_SOURCES: readonly HurtSource[] = ['melee', 'arrow', 'explosion'];

/** The source for a damage cause code; an unknown code is `other`. */
export function sourceOf(cause: string | undefined): HurtSource {
  if (cause === undefined || !Object.hasOwn(CAUSE_SOURCE, cause)) return 'other';
  return CAUSE_SOURCE[cause] ?? 'other';
}

/**
 * Where `attacker` stands relative to the Body's facing. The forward and right unit vectors come from
 * the yaw: forward is (-sin, cos), right is (-cos, -sin). The larger of the two components decides the
 * side; a tie goes to front or behind.
 */
export function bearingOf(
  self: { x: number; z: number; yaw: number },
  attacker: { x: number; z: number },
): HurtBearing {
  const dx = attacker.x - self.x;
  const dz = attacker.z - self.z;
  const forward = dx * -Math.sin(self.yaw) + dz * Math.cos(self.yaw);
  const right = dx * -Math.cos(self.yaw) + dz * -Math.sin(self.yaw);
  // The yaw is in radians, as the Body's bot reports it.
  if (Math.abs(forward) >= Math.abs(right)) return forward >= 0 ? 'front' : 'behind';
  return right >= 0 ? 'right' : 'left';
}

/**
 * The hurt event for one damage, or null when nothing was lost (a zero amount is never emitted). The
 * amount is the raw damage rounded and capped at the health the Body had. An attack with no known
 * attacker is `other` with no bearing. Never throws on a missing attacker.
 */
export function hurtEvent(input: HurtInput): HurtEvent | null {
  if (!Number.isFinite(input.rawDamage) || !Number.isFinite(input.healthBefore)) return null;
  const amount = Math.min(Math.round(input.rawDamage), Math.floor(input.healthBefore));
  if (amount <= 0) return null;
  const sourced = sourceOf(input.cause);
  const attacker = input.attacker;
  const source = attacker === null && ATTACK_SOURCES.includes(sourced) ? 'other' : sourced;
  const event: HurtEvent = { type: 'hurt', source, amount };
  if (attacker !== null) event.bearing = bearingOf(input.self, attacker);
  return event;
}

/**
 * Reports hurts while the Body is open. Once `close()` runs (the bot ended), a hurt is not built and
 * not passed on: a late damage tick after the end is dropped.
 */
export class HurtReporter {
  private open = true;
  private readonly sink: (hurt: HurtEvent, tick: number) => void;

  constructor(sink: (hurt: HurtEvent, tick: number) => void) {
    this.sink = sink;
  }

  report(input: HurtInput, tick: number): HurtEvent | null {
    if (!this.open) return null;
    const hurt = hurtEvent(input);
    if (hurt !== null) this.sink(hurt, tick);
    return hurt;
  }

  close(): void {
    this.open = false;
  }
}
