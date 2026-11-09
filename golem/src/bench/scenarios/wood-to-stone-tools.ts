import { Vec3 } from 'vec3';
import type { BenchEnv, Scenario } from '../types.ts';

/** Trunk bases and the cobblestone patch corner, as offsets from the arena center. */
const TRUNKS = [
  { dx: 6, dz: 0 },
  { dx: 6, dz: 3 },
] as const;
const TRUNK_HEIGHT = 4;
const PATCH = { dx: 10, dz: 0, size: 3 } as const;
/** The crafting table goes one block east of the arena center, where the bot starts. */
const TABLE_OFFSET = { dx: 1, dz: 0 } as const;

/** One scripted step: the action and the name that goes in the note. */
export const STEPS: ReadonlyArray<{ label: string; action: Record<string, unknown> }> = [
  { label: 'mine oak_log', action: { do: 'mine', block: 'oak_log', count: 3 } },
  { label: 'craft oak_planks', action: { do: 'craft', item: 'oak_planks', count: 12 } },
  { label: 'craft crafting_table', action: { do: 'craft', item: 'crafting_table', count: 1 } },
  // The place step is built in `run`, because its position comes from the arena.
  { label: 'place crafting_table', action: { do: 'place', block: 'crafting_table' } },
  { label: 'craft stick', action: { do: 'craft', item: 'stick', count: 4 } },
  { label: 'craft wooden_pickaxe', action: { do: 'craft', item: 'wooden_pickaxe', count: 1 } },
  { label: 'mine cobblestone', action: { do: 'mine', block: 'cobblestone', count: 3 } },
  { label: 'craft stone_pickaxe', action: { do: 'craft', item: 'stone_pickaxe', count: 1 } },
];

/** Verdict: the inventory holds a stone pickaxe. */
export function holdsStonePickaxe(
  inventory: ReadonlyArray<{ name: string; count: number }>,
): boolean {
  return inventory.some((item) => item.name === 'stone_pickaxe' && item.count > 0);
}

/** The note for a step that did not complete, naming the step and the action result. */
export function failedStepNote(
  index: number,
  label: string,
  result: { status: string; reason?: string; message?: string },
): string {
  const why = [result.reason, result.message].filter(Boolean).join(': ');
  return `step ${index + 1} (${label}) ${result.status}${why ? ` (${why})` : ''}`;
}

function blockName(env: BenchEnv, dx: number, dy: number, dz: number): string | null {
  const { center } = env.arena;
  return env.bot.blockAt(new Vec3(center.x + dx, center.y + dy, center.z + dz))?.name ?? null;
}

/**
 * Wood to stone tools: chop trees, build a table, make a wooden then a stone pickaxe. Every
 * step is a registered action. The patch is `cobblestone` rather than `stone` so that the mine
 * step can only be satisfied by the patch (the floor is `stone_bricks`, but nothing else
 * in reach is `stone`-like); cobblestone needs a pickaxe and drops itself.
 */
export const woodToStoneTools: Scenario = {
  name: 'wood-to-stone-tools',
  description:
    'chop logs, craft a table and a wooden pickaxe, mine cobblestone, craft a stone pickaxe',
  timeoutMs: 300_000,
  async prepare(env) {
    const { ctl, arena, bot } = env;
    const { center } = arena;
    await ctl.clear(bot.username);
    for (const { dx, dz } of TRUNKS) {
      await ctl.fill(
        { x: center.x + dx, y: center.y, z: center.z + dz },
        { x: center.x + dx, y: center.y + TRUNK_HEIGHT - 1, z: center.z + dz },
        'oak_log',
      );
    }
    await ctl.fill(
      { x: center.x + PATCH.dx, y: center.y, z: center.z + PATCH.dz },
      {
        x: center.x + PATCH.dx + PATCH.size - 1,
        y: center.y,
        z: center.z + PATCH.dz + PATCH.size - 1,
      },
      'cobblestone',
    );
  },
  ready(env) {
    if (env.bot.inventory.items().length > 0) return false;
    const trunks = TRUNKS.every(
      ({ dx, dz }) =>
        blockName(env, dx, 0, dz) === 'oak_log' &&
        blockName(env, dx, TRUNK_HEIGHT - 1, dz) === 'oak_log',
    );
    const patch =
      blockName(env, PATCH.dx, 0, PATCH.dz) === 'cobblestone' &&
      blockName(env, PATCH.dx + PATCH.size - 1, 0, PATCH.dz + PATCH.size - 1) === 'cobblestone';
    return trunks && patch;
  },
  async run(env) {
    const { center } = env.arena;
    const at = { x: center.x + TABLE_OFFSET.dx, y: center.y, z: center.z + TABLE_OFFSET.dz };
    for (const [index, step] of STEPS.entries()) {
      const action = step.label === 'place crafting_table' ? { ...step.action, at } : step.action;
      const { result } = await env.run(action);
      if (result.status !== 'completed') {
        return { passed: false, note: failedStepNote(index, step.label, result) };
      }
    }
    const passed = holdsStonePickaxe(
      env.bot.inventory.items().map((item) => ({ name: item.name, count: item.count })),
    );
    return {
      passed,
      note: passed ? 'stone_pickaxe in inventory' : 'all steps completed but no stone_pickaxe',
    };
  },
};
