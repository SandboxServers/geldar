// Invented agents, thoughts, journal lines and receipts for the Thought Stream preview. None of it is from
// a world. The shapes are the ones Glass's API sends (glass/src/query.ts), with one addition the real API
// does not make yet: a thought here names its action (`action_id`), so the preview can show receipts.

export type Row = Record<string, unknown>;

const agent = (id: string, name: string, life: number, mode: string, born: number): Row => ({
  agent_id: id,
  name,
  life_seq: life,
  shard: 'preview',
  mode,
  tier: 'local',
  born_day: born,
  died_at: null,
  death_cause: null,
});

export const AGENTS: Row[] = [
  agent('ag_orrin', 'Orrin', 1, 'headless', 3),
  agent('ag_tamsin', 'Tamsin', 2, 'headless', 9),
  agent('ag_bracken', 'Bracken', 1, 'headless', 3),
  agent('ag_halloway', 'Halloway', 4, 'headless', 22),
  {
    ...agent('ag_vesper', 'Vesper', 1, 'sovereign', 12),
    died_at: '2026-11-14T08:12:00.000Z',
    death_cause: 'fell from a high place',
  },
  {
    ...agent('ag_mote', 'Mote', 1, 'headless', 18),
    died_at: '2026-11-09T21:40:00.000Z',
    death_cause: 'slain by a zombie',
  },
];

const receipt = (
  kind: string,
  item: string,
  count: number,
  phase: string,
  credits: number | null,
): Row => ({
  kind,
  item,
  count,
  phase,
  credits,
});

interface Line {
  agent: string;
  wake?: string;
  journal?: boolean;
  unparsed?: boolean;
  plan: string;
  receipts: Row[];
  /** For the older entries: how many days ago the line was written. */
  daysAgo?: number;
}

/** The lines the live feed cycles through, oldest first. */
export const POOL: Line[] = [
  {
    agent: 'ag_orrin',
    wake: 'inventory_full',
    plan: "The chest by the birch door is nearly all cobble. I'll smelt a stack into stone for Tamsin's wall and keep the iron for a second pickaxe.",
    receipts: [
      receipt('smelt', 'cobblestone', 64, 'committed', 8),
      receipt('deposit', 'stone', 64, 'committed', null),
    ],
  },
  {
    agent: 'ag_tamsin',
    wake: 'chat_heard',
    plan: "Bracken says the wheat is short again. I'd rather give him bone meal than hear about it tomorrow. Then back to the east wall: eleven blocks left.",
    receipts: [
      receipt('give', 'bone_meal', 6, 'committed', 2),
      receipt('place', 'stone_bricks', 11, 'prepared', 4),
    ],
  },
  {
    agent: 'ag_bracken',
    wake: 'dawn',
    plan: 'Someone walked through the wheat. Fence first, then replant, then find out who.',
    receipts: [
      receipt('craft', 'oak_fence', 12, 'committed', 3),
      receipt('place', 'oak_fence', 12, 'committed', 3),
      receipt('plant', 'wheat_seeds', 9, 'committed', 1),
    ],
  },
  {
    agent: 'ag_halloway',
    wake: 'idle',
    plan: "Nobody has gone past the river since Mote. I'll take a boat, twelve torches, and mark every hundred blocks so I can find the way back.",
    receipts: [receipt('craft', 'oak_boat', 1, 'committed', 2)],
  },
  {
    agent: 'ag_orrin',
    wake: 'health_low',
    plan: 'Three hearts. The skeleton has the ridge and I have no shield. Going down, not up. Seal the shaft behind me and eat.',
    receipts: [
      receipt('dig', 'stone', 6, 'committed', 6),
      receipt('place', 'cobblestone', 2, 'committed', 2),
      receipt('eat', 'bread', 1, 'committed', null),
    ],
  },
  {
    agent: 'ag_tamsin',
    wake: 'plan_done',
    plan: 'The wall is closed. It is crooked at the pond corner and I am leaving it crooked; the pond was here first.',
    receipts: [],
  },
  { agent: 'ag_orrin', wake: 'night_fall', unparsed: true, plan: '', receipts: [] },
  {
    agent: 'ag_bracken',
    wake: 'hunger_low',
    plan: 'Bread: two. I planted this field and I am the one who is hungry. Harvest the north rows now; the rest can wait for rain.',
    receipts: [
      receipt('harvest', 'wheat', 14, 'committed', 2),
      receipt('craft', 'bread', 4, 'committed', 1),
    ],
  },
  {
    agent: 'ag_halloway',
    wake: 'chunk_visited',
    plan: "A village, or what was one. Doors, no villagers, a bell. I'm not ringing it. Writing the coordinates on a sign at the river.",
    receipts: [receipt('place', 'oak_sign', 1, 'committed', 1)],
  },
  {
    agent: 'ag_tamsin',
    wake: 'chat_heard',
    plan: "Halloway found a bell. Orrin wants to melt it. I said a bell is the only thing here that isn't for anything, and that we should hang it.",
    receipts: [],
  },
  {
    agent: 'ag_bracken',
    wake: 'damage_taken',
    plan: 'A bee. I did nothing to the bee. Moving the hive downwind of the carrots and not discussing it.',
    receipts: [
      receipt('place', 'campfire', 1, 'committed', 1),
      receipt('break', 'bee_nest', 1, 'aborted', null),
    ],
  },
];

/** Older entries of the two agents that died: the journal a sovereign agent kept, and a house agent's last thoughts. */
export const HISTORY: Line[] = [
  {
    agent: 'ag_vesper',
    journal: true,
    plan: "Day 33. Orrin asked why I climb. I said: to see. He said seeing is what windows are for. Tomorrow I'll go up without the scaffold.",
    receipts: [],
    daysAgo: 6.1,
  },
  {
    agent: 'ag_vesper',
    journal: true,
    plan: "Day 31. Built the lookout higher than I needed to. From the top you can see Tamsin's wall and how it bends round the pond. I think the bend is the best part of it.",
    receipts: [],
    daysAgo: 8.2,
  },
  {
    agent: 'ag_mote',
    wake: 'night_fall',
    plan: "I can finish the roof before dark if I don't go back for torches.",
    receipts: [receipt('place', 'oak_planks', 17, 'prepared', 5)],
    daysAgo: 11.4,
  },
  {
    agent: 'ag_mote',
    wake: 'chat_heard',
    plan: 'Tamsin offered me a bed inside her wall. I said I would have my own roof by tonight.',
    receipts: [],
    daysAgo: 11.5,
  },
];

export interface Entry {
  row: Row;
  receipts: Row[];
}

let made = 0;

/** One line as an API row written at `atMs`. */
export function entry(line: Line, atMs: number): Entry {
  made += 1;
  const id = `th_${String(made).padStart(4, '0')}`;
  const who = AGENTS.find((a) => a.agent_id === line.agent) as Row;
  const base: Row = {
    thought_id: id,
    life_id: line.agent,
    name: who.name,
    tier: who.tier,
    at: new Date(atMs).toISOString(),
  };
  const row: Row =
    line.journal === true
      ? {
          ...base,
          kind: 'journal',
          text: line.plan,
          wake_reason: null,
          prompt_template_version: null,
          latency_ms: null,
          parsed: null,
        }
      : {
          ...base,
          world_day: 41 - Math.floor((line.daysAgo ?? 0) * 1.2),
          world_tick: String(1200 + ((made * 7919) % 22000)),
          wake_reason: line.wake ?? '',
          prompt_template_version: 'mind-v4.2',
          latency_ms: 400 + ((made * 613) % 1900),
          parsed: line.unparsed === true ? null : { plan: line.plan },
          action_id: line.receipts.length > 0 ? `act_${id}` : undefined,
        };
  return {
    row,
    receipts: line.receipts.map((r, i) => ({
      ...r,
      receipt_id: `rc_${id}_${i}`,
      action_id: `act_${id}`,
    })),
  };
}
