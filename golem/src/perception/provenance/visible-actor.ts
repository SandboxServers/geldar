/**
 * The observed causal actor (AN-25): a player named as the cause of a hurt, only when the Body can
 * see that player right now. Nothing here names a player who is out of sight, the Body itself, or a
 * name that is not a Minecraft username. Paper-only in behaviour; do not enable on NeoForge until the
 * human-handling question is decided.
 */
import type { ObservedActor } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { lifeIdFor } from '../../registry.ts';
import { findVisibleAgent } from '../visible-agent.ts';

const USERNAME = /^[A-Za-z0-9_]{3,16}$/;

/**
 * The actor for `username`, or null. Null when the name is missing, is the Body's own name, is not a
 * Minecraft username, or is not a player the Body can see (`findVisibleAgent`). Otherwise the name
 * and the life id `lifeIdOf` gives it (the registry lookup by default).
 */
export function observedActor(
  bot: Bot,
  username: string | undefined,
  lifeIdOf: (name: string) => string = lifeIdFor,
): ObservedActor | null {
  if (username === undefined || username === bot.username || !USERNAME.test(username)) return null;
  if (findVisibleAgent(bot, username) === null) return null;
  return { name: username, life: lifeIdOf(username) };
}
