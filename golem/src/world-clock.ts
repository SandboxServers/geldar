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

/**
 * Calls `listener` with a world-tick estimate on every client physics tick (20 Hz, mineflayer's own
 * timer, which runs whatever the server's TPS: decision 0038), and returns the unsubscribe.
 *
 * `bot.time.age` only moves every 20 ticks (one time packet per second), too coarse to drive
 * reflexes. So between time packets the estimate advances by one per physics tick from the last
 * `bot.time.age`, and a time packet re-bases it. The estimate never goes backwards and never repeats:
 * one value per physics tick, so a reflex cooldown counted in these ticks cannot fire twice in one
 * physics tick. Nothing is emitted before the first time packet. Values between packets are
 * estimates, not measurements (decision 0038); decision 0030 still defines `world_time.ticks`.
 */
export function watchWorldTicks(bot: Bot, listener: (worldTick: number) => void): () => void {
  let last: number | null = null;
  const onTime = (): void => {
    const age = worldAge(bot);
    // A packet ahead of the estimate re-bases it; one behind it is ignored (monotonic).
    if (age !== null && (last === null || age > last)) last = age;
  };
  const onPhysicsTick = (): void => {
    if (last === null) return;
    last += 1;
    listener(last);
  };
  onTime();
  bot.on('time', onTime);
  bot.on('physicsTick', onPhysicsTick);
  return () => {
    bot.off('time', onTime);
    bot.off('physicsTick', onPhysicsTick);
  };
}
