import { Vec3 } from 'vec3';
import type { RunEnv, Scenario } from '../types.ts';

/** Offset of the chest from the arena center. */
const CHEST_DX = 3;
const GIVEN = 10;
const DEPOSITED = 10;
const WITHDRAWN = 4;

/** The part of an inventory stack the verdict reads. */
export interface StackLite {
  name: string;
  count: number;
}

/**
 * Pure verdict: the chest holds exactly 6 cobblestone and nothing else, and the bot holds exactly
 * 4 cobblestone. No receipt check: receipts are built with the executor in wave 4.
 */
export function chestVerdict(chest: Map<string, number>, inventory: StackLite[]): boolean {
  if (chest.size !== 1 || chest.get('cobblestone') !== DEPOSITED - WITHDRAWN) return false;
  const held = inventory.reduce((n, s) => (s.name === 'cobblestone' ? n + s.count : n), 0);
  return held === WITHDRAWN;
}

/** Open a chest, put 10 cobblestone in and take 4 out, as explicit server-confirmed clicks (decision 0037). */
export const chest: Scenario = {
  name: 'chest',
  description: 'open a chest, deposit 10 cobblestone and withdraw 4',
  timeoutMs: 120_000,
  async prepare(env) {
    const { center } = env.arena;
    await env.ctl.setblock(center.x + CHEST_DX, center.y, center.z, 'chest');
    await env.ctl.give(env.bot.username, 'cobblestone', GIVEN);
  },
  ready(env) {
    const { center } = env.arena;
    const block = env.bot.blockAt(new Vec3(center.x + CHEST_DX, center.y, center.z));
    const held = env.bot.inventory
      .items()
      .reduce((n, i) => (i.name === 'cobblestone' ? n + i.count : n), 0);
    return block?.name === 'chest' && held === GIVEN;
  },
  async run(env: RunEnv) {
    const { center } = env.arena;
    const at = { x: center.x + CHEST_DX, y: center.y, z: center.z };
    const steps: Array<[string, unknown]> = [
      ['open', { do: 'open', at }],
      ['deposit', { do: 'deposit', at, item: 'cobblestone', count: DEPOSITED }],
      ['withdraw', { do: 'withdraw', at, item: 'cobblestone', count: WITHDRAWN }],
    ];
    for (const [kind, action] of steps) {
      const { result } = await env.run(action);
      if (result.status !== 'completed') {
        return {
          passed: false,
          note: `${kind} ${result.status} (${result.reason ?? '-'}): ${result.message ?? ''}`,
        };
      }
    }
    const inChest = await env.ctl.chestItems(at.x, at.y, at.z);
    const passed = chestVerdict(inChest, env.bot.inventory.items());
    const held = JSON.stringify(Object.fromEntries(inChest));
    return { passed, note: `chest ${held}; receipts: not built yet (wave 4)` };
  },
};
