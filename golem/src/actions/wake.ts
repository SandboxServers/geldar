import type { Bot } from 'mineflayer';

/** How long a wake is waited for when the server's update does not arrive first. */
export const WAKE_CONFIRM_MS = 1_000;

/** The client's packet writer. mineflayer's types do not expose it. */
interface RawClient {
  write(name: string, params: Record<string, unknown>): void;
}

/**
 * Asks the server to wake a sleeping bot and resolves true when the server's 'wake' arrives within
 * WAKE_CONFIRM_MS, false otherwise. mineflayer's `bot.wake()` sends `entity_action` with the numeric
 * action id 2, which protocol 1.21.6 and later (26.1 included) reads as stop_sprinting, so the server
 * keeps the player in bed. The packet is written with the action's name instead, and the serializer
 * picks the id for the connected version.
 */
export function wakeBot(bot: Bot): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (awake: boolean): void => {
      clearTimeout(timer);
      bot.removeListener('wake', onWake);
      resolve(awake);
    };
    const onWake = (): void => finish(true);
    bot.on('wake', onWake);
    timer = setTimeout(() => finish(false), WAKE_CONFIRM_MS);
    try {
      (bot as unknown as { _client: RawClient })._client.write('entity_action', {
        entityId: bot.entity.id,
        actionId: 'stop_sleeping',
        jumpBoost: 0,
      });
    } catch {
      finish(false);
    }
  });
}
