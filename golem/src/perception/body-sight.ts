import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import { canSeePoint, type SightOptions } from './notable-blocks.ts';

/** Where an entity's eyes are, as a share of its height (a standing player: 1.62 of 1.8). */
export const EYE_SHARE = 0.9;
/** How far above the feet the feet line ends, so it does not graze the floor under them. */
export const FEET_LIFT = 0.1;

/**
 * Whether the Body sees any part of an entity: a clear line from the eyes to its middle, its eyes
 * or its feet (decision 0446). One line to the middle alone missed an agent behind a waist-high
 * block whose head was in plain view. The middle is tried first, as it is the usual clear line.
 */
export function canSeeBody(
  bot: Bot,
  feet: Vec3,
  height: number,
  options: SightOptions = {},
): boolean {
  return (
    canSeePoint(bot, feet.offset(0, height / 2, 0), options) ||
    canSeePoint(bot, feet.offset(0, height * EYE_SHARE, 0), options) ||
    canSeePoint(bot, feet.offset(0, FEET_LIFT, 0), options)
  );
}

/**
 * Whether a toss can reach an entity: the middle or the eyes line free of every block shape, glass
 * included. The toss aims at the eyes, so a clear feet line alone (a gap at the floor) is not enough.
 */
export function canTossTo(bot: Bot, feet: Vec3, height: number): boolean {
  return (
    canSeePoint(bot, feet.offset(0, height / 2, 0), { solidOnly: true }) ||
    canSeePoint(bot, feet.offset(0, height * EYE_SHARE, 0), { solidOnly: true })
  );
}
