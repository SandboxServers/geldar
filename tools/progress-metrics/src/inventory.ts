import { parseTime } from './time.ts';

export type InvSample = { agent: string; at: number; items: Map<string, number> };

/** The tool ladder whose first-seen times are reported. */
export const LADDER = [
  'wooden_pickaxe',
  'stone_pickaxe',
  'crafting_table',
  'furnace',
  'bed',
  'torch',
] as const;
/** Any pickaxe counts for "time to first tool". */
export const TOOLS = [
  'wooden_pickaxe',
  'stone_pickaxe',
  'iron_pickaxe',
  'diamond_pickaxe',
  'golden_pickaxe',
];

const ITEM = /id:\s*"minecraft:([a-z0-9_]+)"[^}]*?[Cc]ount:\s*(\d+)/g;
const ITEM_COUNT_FIRST = /[Cc]ount:\s*(\d+)b?[^}]*?id:\s*"minecraft:([a-z0-9_]+)"/g;

/**
 * Sampler lines: `<iso time>\t<agent>\t<raw rcon reply>`: the reply of `data get entity <agent> Inventory[N]` (one
 * item per line, `{Slot: 0b, id: "minecraft:x", count: 1}`) or of the whole `Inventory` (rcon-cli cuts that one
 * at about 110 characters). Lines with the same time and agent form one sample. Beds (any colour) count as
 * `bed`. Both "id first" (`count:`, 1.20.5+) and "Count first" (`Count:`) key orders are read.
 */
export function parseInventory(text: string): InvSample[] {
  const bySample = new Map<string, InvSample>();
  for (const line of text.split('\n')) {
    const [ts, agent, raw] = line.trimEnd().split('\t');
    if (!ts || !agent || !raw) continue;
    const at = parseTime(ts);
    if (at === null) continue;
    const found: [string, number][] = [...raw.matchAll(ITEM)].map((m) => [
      m[1] as string,
      Number(m[2]),
    ]);
    if (found.length === 0)
      for (const m of raw.matchAll(ITEM_COUNT_FIRST)) found.push([m[2] as string, Number(m[1])]);
    const sampleKey = `${at}\t${agent}`;
    const smp = bySample.get(sampleKey) ?? { agent, at, items: new Map<string, number>() };
    bySample.set(sampleKey, smp);
    for (const [id, n] of found) {
      const key = id.endsWith('_bed') ? 'bed' : id;
      smp.items.set(key, (smp.items.get(key) ?? 0) + n);
    }
  }
  return [...bySample.values()];
}
export type InvMetrics = {
  distinctItems: number;
  firstSeen: Record<string, number>;
  firstSampleAt: number | null;
  firstToolAt: number | null;
};

/** `all` is every sample of the agent, so first-seen times are for its whole run, not the window. */
export function inventoryMetrics(all: InvSample[]): InvMetrics {
  const s = [...all].sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  const firstSeen: Record<string, number> = {};
  let firstToolAt: number | null = null;
  for (const smp of s) {
    for (const [id, n] of smp.items) {
      if (n <= 0) continue;
      seen.add(id);
      if ((LADDER as readonly string[]).includes(id) && firstSeen[id] === undefined)
        firstSeen[id] = smp.at;
      if (TOOLS.includes(id) && firstToolAt === null) firstToolAt = smp.at;
    }
  }
  return { distinctItems: seen.size, firstSeen, firstSampleAt: s[0]?.at ?? null, firstToolAt };
}
