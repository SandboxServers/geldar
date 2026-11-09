import type { Bot } from 'mineflayer';

/** Resolves after `ms` of wall time. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `bot.time.age` when it is a finite number, else null (before the first time packet). */
export function worldAge(bot: Bot): number | null {
  const age: unknown = bot.time?.age;
  return typeof age === 'number' && Number.isFinite(age) ? age : null;
}
