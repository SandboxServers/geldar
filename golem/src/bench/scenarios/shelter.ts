import type { RunEnv, Scenario } from '../types.ts';

/** An offset from the block the bot stands in. */
export type Offset = readonly [dx: number, dy: number, dz: number];

/**
 * The ten dirt blocks, in placing order: the lower layer first, because every block needs a
 * face-adjacent neighbor. The first roof block `(1,2,0)` sits on the head-level side `(1,1,0)`,
 * the second `(0,2,0)` hangs off the first.
 */
export const SHELTER_OFFSETS: readonly Offset[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [1, 1, 0],
  [-1, 1, 0],
  [0, 1, 1],
  [0, 1, -1],
  [1, 2, 0],
  [0, 2, 0],
];

/** The cells that must be solid: four at feet level, four at head level, above the head, below. */
const ENCLOSURE: readonly Offset[] = [...SHELTER_OFFSETS.slice(0, 8), [0, 2, 0], [0, -1, 0]];

/** Verdict: every cell around the bot's block is solid. `getBlock` returns null for unknown cells. */
export function isEnclosed(
  getBlock: (dx: number, dy: number, dz: number) => { boundingBox: string } | null,
): boolean {
  return ENCLOSURE.every(([dx, dy, dz]) => getBlock(dx, dy, dz)?.boundingBox === 'block');
}

/** Shelter: build a one-block closet of dirt around the bot, then check it from both sides. */
export const shelter: Scenario = {
  name: 'shelter',
  description: 'place dirt on all sides and above the head',
  timeoutMs: 180_000,
  async prepare(env) {
    await env.ctl.clear(env.bot.username);
    await env.ctl.give(env.bot.username, 'dirt', 16);
  },
  ready(env) {
    const dirt = env.bot.inventory.items().find((item) => item.name === 'dirt');
    return (dirt?.count ?? 0) >= SHELTER_OFFSETS.length;
  },
  async run(env: RunEnv) {
    const { bot, ctl } = env;
    const base = bot.entity.position.floored();
    for (const [dx, dy, dz] of SHELTER_OFFSETS) {
      const at = { x: base.x + dx, y: base.y + dy, z: base.z + dz };
      const placed = await env.run({ do: 'place', block: 'dirt', at });
      if (placed.result.status !== 'completed') {
        const { reason, message } = placed.result;
        return {
          passed: false,
          note: `place dirt at (${dx},${dy},${dz}) ${placed.result.status} (${reason}: ${message})`,
        };
      }
    }
    const client = isEnclosed((dx, dy, dz) => bot.blockAt(base.offset(dx, dy, dz)));
    const missing: string[] = [];
    for (const [dx, dy, dz] of SHELTER_OFFSETS) {
      if (!(await ctl.blockIs(base.x + dx, base.y + dy, base.z + dz, 'dirt'))) {
        missing.push(`(${dx},${dy},${dz})`);
      }
    }
    const server = missing.length === 0;
    if (client !== server) {
      return {
        passed: false,
        note: `client and server disagree: client ${client}, server ${server}, missing on server ${missing.join(' ')}`,
      };
    }
    return {
      passed: client,
      note: client
        ? 'enclosed, server agrees'
        : `not enclosed; server missing ${missing.join(' ')}`,
    };
  },
};
