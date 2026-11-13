import { Vec3 } from 'vec3';
import { wakeBot } from '../../actions/wake.ts';
import { waitUntil } from '../runner.ts';
import type { BenchEnv, Scenario } from '../types.ts';

/** Night starts at this time of day; the client must see it before `sleep` (decision 0038). */
const NIGHT_TICKS = 13_000;
/** World ticks the client gets to see the night after `time set night`. */
const NIGHT_WAIT_TICKS = 200;

/** Offset of the crafting table from the arena center. */
const TABLE = { x: 2, z: 0 };
/** Where the bed goes by the spec: diagonal to the table. The second half lands one block further. */
export const BED = { x: 2, z: 2 };
/**
 * The bed on the side away from the table, for `bed-clear`: the sleep walk stalled in the spec
 * layout (live: no movement for 600 world ticks), so this tells a Body stall from a scenario fault.
 */
export const BED_CLEAR = { x: -2, z: 2 };

/** True when the client's inventory holds at least `count` of `name`. */
function holds(env: BenchEnv, name: string, count: number): boolean {
  return (
    env.bot.inventory.items().reduce((n, i) => (i.name === name ? n + i.count : n), 0) >= count
  );
}

/** Pure verdict: `sleep` completed and the client and the server both say the player is in bed. */
export function bedVerdict(
  sleepStatus: string,
  clientSleeping: boolean,
  serverSleeping: boolean,
): boolean {
  return sleepStatus === 'completed' && clientSleeping && serverSleeping;
}

/**
 * Craft a bed from wool and planks at a table, place it at `offset` from the arena center, wait for
 * the client to see night, sleep. The client's `isSleeping` and the server's (`ctl.isSleeping`)
 * must agree; a disagreement is named in the note.
 */
function makeBedScenario(
  name: string,
  description: string,
  offset: { x: number; z: number },
  hidden: boolean,
): Scenario {
  return {
    name,
    description,
    ...(hidden ? { hidden: true } : {}),
    timeoutMs: 180_000,
    async prepare(env) {
      const { center } = env.arena;
      await env.ctl.setblock(center.x + TABLE.x, center.y, center.z + TABLE.z, 'crafting_table');
      await env.ctl.give(env.bot.username, 'white_wool', 3);
      await env.ctl.give(env.bot.username, 'oak_planks', 3);
    },
    ready(env) {
      const { center } = env.arena;
      const table = env.bot.blockAt(new Vec3(center.x + TABLE.x, center.y, center.z + TABLE.z));
      return (
        table?.name === 'crafting_table' &&
        holds(env, 'white_wool', 3) &&
        holds(env, 'oak_planks', 3)
      );
    },
    async run(env) {
      const { bot, ctl } = env;
      const { center } = env.arena;
      try {
        const steps: Array<[string, unknown]> = [
          ['craft', { do: 'craft', item: 'white_bed', count: 1 }],
          [
            'place',
            {
              do: 'place',
              block: 'white_bed',
              at: { x: center.x + offset.x, y: center.y, z: center.z + offset.z },
            },
          ],
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
        await ctl.timeSet('night');
        const seen = await waitUntil(
          env,
          () => bot.time.timeOfDay >= NIGHT_TICKS,
          NIGHT_WAIT_TICKS,
        );
        if (!seen) return { passed: false, note: 'client never saw night' };
        const { result } = await env.run({ do: 'sleep' });
        const client = bot.isSleeping;
        const server = await ctl.isSleeping(bot.username);
        const passed = bedVerdict(result.status, client, server);
        const mismatch = client === server ? '' : '; client and server disagree';
        const note = `sleep ${result.status} (${result.reason ?? '-'}: ${result.message ?? ''}), client isSleeping ${client}, server ${server}${mismatch}`;
        return { passed, note };
      } finally {
        if (bot.isSleeping) await wakeBot(bot).catch(() => undefined);
        await ctl.timeSet('day');
      }
    },
  };
}

/** The canonical bed scenario: the bed diagonal to the table, as the spec has it. */
export const bed: Scenario = makeBedScenario(
  'bed',
  'craft a bed at a table, place it, wait for night and sleep in it',
  BED,
  false,
);

/** Hidden twin with the bed away from the table; never recorded, not in all. */
export const bedClear: Scenario = makeBedScenario(
  'bed-clear',
  'bed with the bed placed away from the crafting table',
  BED_CLEAR,
  true,
);
