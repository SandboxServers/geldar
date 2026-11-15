import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { ownAir } from '../body/air.ts';
import {
  type BlockReader,
  findBreathingColumn,
  steerBlocked,
} from '../body/reflexes/hazard-escape.ts';
import { WET_CELLS } from './water-rules.ts';

/**
 * Air (0-20) at or below which a deliberate swim surfaces: held above the reflex line
 * (`DROWNING_AIR`, 8), so a normal swim never trips `hazard_escape` (decision 0194 a, b).
 */
export const SURFACE_AIR = 12;

/** Air at or below which a goto swim stops, with the head still in water (decision 0194 a, b). */
export const ABORT_AIR = 10;

/** The failure text of a swim stopped at `ABORT_AIR`: a fact with the air value, no advice (0154, 0194 d). */
export function swimStopText(air: number): string {
  return `swim stopped at air ${air} with your head in the water`;
}

/** What a swim did, for the result line (decision 0194 d). Facts only. */
export interface SwimTally {
  blocksSwum: number;
  surfaces: number;
}

/**
 * The fact a completed goto adds to its note when it swam (decision 0194 d): blocks swum and times
 * it came up for air. Undefined when the head never was in water. Facts only, no advice (0154).
 */
export function swimNote(tally: SwimTally): string | undefined {
  if (tally.blocksSwum === 0 && tally.surfaces === 0) return undefined;
  return `swam ${Math.round(tally.blocksSwum)} blocks, came up for air ${tally.surfaces} times`;
}

export interface SwimOptions {
  /** Called once when the air is at or below `ABORT_AIR` with the head in water. */
  onAbort: (air: number) => void;
}

export interface SwimController {
  readonly tally: SwimTally;
  /** Removes the tick handler, releases the controls it held, and returns the tally. */
  stop(): SwimTally;
}

/** Feet-level height of the head cell (eyes are 1.62 above the feet). */
const EYE_HEIGHT = 1.62;

/**
 * Watches the Body's own air on every physics tick while a goto swims. Air counts only with the
 * head in water, so a surface swim loses nothing. At `SURFACE_AIR` or less it holds jump, or
 * steers to a breathing column when a block is over the head. At `ABORT_AIR` or less it calls
 * `onAbort` once. The reflex in `hazard-escape.ts` stays the failsafe at 8.
 */
export function startSwim(bot: Bot, options: SwimOptions): SwimController {
  const tally: SwimTally = { blocksSwum: 0, surfaces: 0 };
  const read: BlockReader = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
  let wasWet = false;
  let aborted = false;
  let stopped = false;
  let held = false;
  let last: Vec3 | null = null;

  const setControl = (name: 'jump' | 'forward', on: boolean): void => {
    bot.setControlState(name, on);
    held = true;
  };
  const release = (): void => {
    if (!held) return;
    held = false;
    bot.setControlState('jump', false);
    bot.setControlState('forward', false);
  };

  const tick = (): void => {
    if (stopped) return;
    const here = bot.entity.position;
    const head = read(Math.floor(here.x), Math.floor(here.y + EYE_HEIGHT), Math.floor(here.z));
    const wet = head !== null && WET_CELLS.has(head.name);
    if (wet && last) tally.blocksSwum += Math.hypot(here.x - last.x, here.z - last.z);
    if (wasWet && !wet) tally.surfaces += 1;
    wasWet = wet;
    last = here.clone();
    if (!wet) {
      release();
      return;
    }
    const air = ownAir(bot);
    if (air <= ABORT_AIR && !aborted) {
      aborted = true;
      options.onAbort(air);
      // onAbort ends the walk, which calls stop(): nothing below may hold a control after that.
      if (stopped) return;
    }
    if (air > SURFACE_AIR) {
      release();
      return;
    }
    const ceiling = read(Math.floor(here.x), Math.floor(here.y + 1.85), Math.floor(here.z));
    const column = ceiling?.boundingBox === 'block' ? findBreathingColumn(read, here) : null;
    if (column) {
      const centre = new Vec3(column.x + 0.5, here.y, column.z + 0.5);
      void bot.lookAt(centre, true);
      setControl('jump', false);
      setControl('forward', !steerBlocked(bot, centre));
    } else {
      setControl('forward', false);
      setControl('jump', true);
    }
  };

  bot.on('physicsTick', tick);
  return {
    tally,
    stop(): SwimTally {
      stopped = true;
      bot.off('physicsTick', tick);
      release();
      return tally;
    },
  };
}
