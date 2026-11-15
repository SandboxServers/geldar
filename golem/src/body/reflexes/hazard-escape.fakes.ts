import { Vec3 } from 'vec3';
import { fakeBot } from '../body.fakes.ts';
import type { EscapeWalk } from './hazard-escape.ts';

/** A bot that logs its control states and counts the ticks it waited. */
export function controlBot(at = new Vec3(0.5, 64, 0.5)) {
  const bot = fakeBot() as unknown as Record<string, unknown>;
  const controls: string[] = [];
  const state = { ticks: 0 };
  (bot.entity as { position: Vec3 }).position = at;
  bot.setControlState = (name: string, on: boolean) => controls.push(`${name}:${on}`);
  bot.lookAt = async () => undefined;
  bot.waitForTicks = async () => {
    state.ticks += 1;
  };
  return { bot: bot as never, controls, state };
}

export function walkFor(bot: never, reachedAfter: () => boolean, extra: Partial<EscapeWalk> = {}) {
  return {
    bot,
    target: { x: 3, y: 64, z: 0 },
    signal: new AbortController().signal,
    timeScale: 2,
    expired: () => false,
    reached: reachedAfter,
    ...extra,
  } as EscapeWalk;
}
