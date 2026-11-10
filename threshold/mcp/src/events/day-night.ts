/** The four phases of a Minecraft day, as the snapshot names them (the contract's day_night enum). */
export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

/** Game ticks in one day. */
export const TICKS_PER_DAY = 24000;

/** Where each phase starts within the day, in ticks. Matches the mock's timeOfDay. */
const PHASE_STARTS: readonly { phase: DayPhase; tick: number }[] = [
  { phase: 'dawn', tick: 0 },
  { phase: 'day', tick: 1000 },
  { phase: 'dusk', tick: 12000 },
  { phase: 'night', tick: 13000 },
];

/** The phase at a tick. */
export function phaseAt(tick: number): DayPhase {
  const t = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
  let current: DayPhase = 'night';
  for (const start of PHASE_STARTS) if (t >= start.tick) current = start.phase;
  return current;
}

/** The `Nats-Msg-Id` of a day_night event: one publish per (shard, day, phase). */
export function dayNightMsgId(shard: string, day: number, phase: DayPhase): string {
  return `daynight:${shard}:${day}:${phase}`;
}

/** A phase change the world clock is predicted to reach. */
export interface PhaseForecast {
  phase: DayPhase;
  /** The world day the change falls in (ticks divided by the day length). */
  day: number;
  /** The tick at which the change happens. */
  tick: number;
  /** When it happens, in clock milliseconds from now. */
  atMs: number;
}

/**
 * Predicts the next `count` phase changes after `tick`, given the last world tick and the ticks per
 * second the shard runs at (`tick_rate` from the shard, spec 5.15.2). Each change is due at
 * `(its tick - tick) / tickRate` seconds from `nowMs`.
 */
export function forecastPhases(
  tick: number,
  tickRate: number,
  nowMs: number,
  count = 4,
): PhaseForecast[] {
  if (!(tickRate > 0)) throw new RangeError('tickRate must be a positive number');
  const out: PhaseForecast[] = [];
  let cursor = tick;
  for (let i = 0; i < count; i++) {
    const dayBase = Math.floor(cursor / TICKS_PER_DAY) * TICKS_PER_DAY;
    let next = PHASE_STARTS.find((s) => dayBase + s.tick > cursor);
    const atTick = next ? dayBase + next.tick : dayBase + TICKS_PER_DAY;
    if (!next) next = PHASE_STARTS[0];
    if (next === undefined) break;
    out.push({
      phase: next.phase,
      day: Math.floor(atTick / TICKS_PER_DAY),
      tick: atTick,
      atMs: nowMs + ((atTick - tick) / tickRate) * 1000,
    });
    cursor = atTick;
  }
  return out;
}
