import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { lightAtHead } from '../../body/light.ts';
import { healthTrend } from '../health-trend.ts';

/** Light and regeneration for `self` (PX-3b). */

/** Raw light from this level up reads as bright. */
export const BRIGHT_FROM = 12;
/** Raw light from this level up (and below BRIGHT_FROM) reads as dim; below it, dark. */
export const DIM_FROM = 4;

/** Hunger below this stops natural regeneration (vanilla FoodData: regeneration needs food 18 or more). */
export const REGEN_MIN_HUNGER = 18;

/** The fixed regeneration rule, shown only while hunger is below REGEN_MIN_HUNGER. Facts, no advice. */
export const REGEN_HINT =
  'Health does not regenerate naturally while hunger is low. Hunger falls over time.';

/** The light word for a raw 0 to 15 level. */
export function lightWord(level: number): 'bright' | 'dim' | 'dark' {
  if (level >= BRIGHT_FROM) return 'bright';
  if (level >= DIM_FROM) return 'dim';
  return 'dark';
}

/**
 * `light`, `health_trend` and `regen_hint` for `self`. Nothing is returned before the Body has an
 * entity; `light` is absent when the head cell is not known.
 */
export function lightRegen(bot: Bot): Partial<Snapshot['self']> {
  if (!bot.entity) return {};
  const out: Partial<Snapshot['self']> = { health_trend: healthTrend(bot) };
  const level = lightAtHead(bot);
  if (level !== null) out.light = lightWord(level);
  if (typeof bot.food === 'number' && bot.food < REGEN_MIN_HUNGER) out.regen_hint = REGEN_HINT;
  return out;
}
