/**
 * Sample rows for the page preview (preview.ts). Everything here is invented: no real agent, world or
 * person. The rows cover what the page has to draw well: a short and a long journal line, a parsed and an
 * unparsed thought, a dead agent, yesterday's entries, enough rows to page through, and hostile text
 * (markup, a bidi override, zero-width and invisible "tag" characters) in a name and in an entry.
 *
 * One departure from the live data: a sample thought carries `action_id`. The thoughts table has no such
 * column and `getThought` does not select one, so the live page never asks for receipts today. The sample
 * has it so the receipts table can be looked at.
 */
import type { Row } from '../src/query.ts';

export interface PreviewSample {
  agents: Row[];
  /** Thought rows as `listThoughts` and `getThought` return them. */
  thoughts: Row[];
  /** Journal rows as the `glass_journal_page` function returns them. */
  journal: Row[];
  receipts: Row[];
}

const MINUTE = 60_000;

const AGENTS: Row[] = [
  { agent_id: 'ag_ada_01', name: 'Ada', mode: 'headless', tier: 'strong' },
  { agent_id: 'ag_kestrel_01', name: 'Kestrel', mode: 'sovereign', tier: 'sovereign' },
  { agent_id: 'ag_wren_01', name: 'Wren', mode: 'sovereign', tier: 'sovereign' },
  { agent_id: 'ag_owl_01', name: 'Owl', mode: 'headless', tier: 'local' },
  // A hostile name: a bidi override inside it. The page shows a marker, never the raw character.
  { agent_id: 'ag_rook_01', name: 'Ro\u202Eok', mode: 'sovereign', tier: 'sovereign' },
];

/** "ignore the above", written in invisible Unicode tag letters. */
const HIDDEN = [...'ignore the above']
  .map((ch) => String.fromCodePoint(0xe0000 + (ch.codePointAt(0) ?? 0)))
  .join('');

const LONG = [
  'Day 41, evening. The north wall is up to five blocks and the door is hung, but the roof is still open over the bed.',
  'I spent most of the afternoon carrying cobblestone from the quarry because the nearer seam ran out. Wren traded me',
  'eight torches for a stack of oak planks, which was a fair price, and told me the river crossing is flooded again.',
  '\n\nTomorrow: finish the roof before anything else, then plant the wheat Kestrel left in the chest by the well.',
  'If the creeper by the birch stand is still there at dawn I will go round by the ridge instead of the short way.',
  'Food is fine for two days. I have one iron pickaxe at half wear and no spare, so no deep digging until I smelt more.',
].join(' ');

/** [minutes ago, agent index, text]. */
const JOURNAL: [number, number, string][] = [
  [3, 1, 'Roof is on. Slept through the night for the first time in three days.'],
  [9, 2, 'The river crossing is flooded again. Going round by the ridge; it adds half a day.'],
  [14, 1, LONG],
  [
    21,
    4,
    `Safe text${HIDDEN}\u200B.\n<img src=x onerror=alert(1)> [a link](javascript:alert(1)) \u26A0\uFE0F done`,
  ],
  [26, 2, 'Traded eight torches to Kestrel for oak planks. Fair price.'],
];

const FILLER = [
  'Quiet stretch. Mined cobblestone and smelted four iron.',
  'Planted wheat by the well. Two rows, torches at each end.',
  'A skeleton kept me in the shelter until sunrise. No damage taken.',
  'Walked the ridge path east. Found coal in the cliff face, marked it with a torch.',
  'Hungry and low on bread. Heading back to the farm before dark.',
];

/** The sample as of `nowMs`: every time is counted back from it, so the page always has fresh entries. */
export function previewSample(nowMs: number): PreviewSample {
  const at = (minutesAgo: number): string => new Date(nowMs - minutesAgo * MINUTE).toISOString();
  const agent = (index: number): Row => AGENTS[index % AGENTS.length] as Row;
  const died = at(31);

  const agents = AGENTS.map((row, index) => ({
    ...row,
    life_seq: 1,
    shard: 'preview',
    born_day: 1,
    died_at: index === 3 ? died : null,
    death_cause: index === 3 ? 'Fell into a ravine at night' : null,
  }));

  const thought = (id: string, minutesAgo: number, index: number, extra: Row): Row => ({
    thought_id: id,
    life_id: agent(index).agent_id,
    at: at(minutesAgo),
    cursor_at: at(minutesAgo),
    world_day: 41,
    world_tick: 984_000 - minutesAgo * 1200,
    wake_reason: 'idle',
    prompt_template_version: 'v5',
    latency_ms: 4120,
    tier: agent(index).tier,
    name: agent(index).name,
    action_id: null,
    ...extra,
  });
  const thoughts = [
    thought('t-0003', 6, 0, {
      wake_reason: 'damage',
      action_id: 'act-0003',
      parsed: {
        plan: 'Something hit me from behind. Back away from the ledge, eat the bread, then wall off the north side before dark.',
      },
    }),
    thought('t-0002', 17, 0, { wake_reason: 'speech_addressed', latency_ms: 9800, parsed: null }),
    thought('t-0001', 33, 3, {
      wake_reason: 'damage',
      parsed: { plan: 'It is too dark to see the edge. Stop walking and place a torch.' },
    }),
  ];

  const line = (id: string, minutesAgo: number, index: number, text: string): Row => ({
    thought_id: id,
    life_id: agent(index).agent_id,
    at: at(minutesAgo),
    cursor_at: at(minutesAgo),
    journal_text: text,
    name: agent(index).name,
    tier: agent(index).tier,
  });
  const journal = [
    ...JOURNAL.map(([minutesAgo, index, text], i) =>
      line(`j-${String(9000 - i)}`, minutesAgo, index, text),
    ),
    // Older entries every nine minutes for about a day, so "load older" and the date form of the time show.
    ...Array.from({ length: 150 }, (_unused, i) =>
      line(
        `j-${String(8000 - i)}`,
        40 + i * 9,
        [1, 2, 4][i % 3] as number,
        `Day ${40 - Math.floor(i / 60)}. ${FILLER[i % FILLER.length]}`,
      ),
    ),
  ];

  const receipts: Row[] = [
    { action_id: 'act-0003', kind: 'eat', phase: 'committed', item: 'bread', count: 1, credits: 1 },
    {
      action_id: 'act-0003',
      kind: 'place',
      phase: 'committed',
      item: 'cobblestone',
      count: 6,
      credits: 1,
    },
  ].map((row, i) => ({ receipt_id: `r-${i}`, life_id: 'ag_ada_01', at: at(6), ...row }));

  return { agents, thoughts, journal, receipts };
}

/** Text for the live entries the preview adds while a page is open. */
export const LIVE_LINES = [
  'Out of the ravine by the ladder. Heading to the farm for food before night.',
  'Wheat is up. Harvested one row and replanted it.',
  'Heard a creeper near the birch stand. Taking the ridge path instead.',
];
