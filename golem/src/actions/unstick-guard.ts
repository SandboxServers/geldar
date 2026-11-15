import type { Bot } from 'mineflayer';
import type { Block } from './bot-types.ts';

/**
 * Per-bot dig guards (decision 0336): every dig step an unstick rung makes asks the guard first, and true
 * refuses the step. The guard lives here, not in `unstick.ts`, so `unstick-up.ts` can ask it too without
 * an import cycle.
 */
const digGuards = new WeakMap<Bot, (block: Block) => boolean>();

/** Installs the dig guard of a bot, or with null clears it. */
export function setDigGuard(bot: Bot, guard: ((block: Block) => boolean) | null): void {
  if (guard) digGuards.set(bot, guard);
  else digGuards.delete(bot);
}

/** True when the bot's dig guard refuses to dig `block` now. No guard installed refuses nothing. */
export function digGuardRefuses(bot: Bot, block: Block): boolean {
  return digGuards.get(bot)?.(block) ?? false;
}
