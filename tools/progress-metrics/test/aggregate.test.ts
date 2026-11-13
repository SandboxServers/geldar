import { describe, expect, it } from 'vitest';
import { aggregate, type Inputs } from '../src/aggregate.ts';
import { parseBodyLine, parseBodyLog } from '../src/body.ts';
import { renderTopFailures, topFailures } from '../src/failures.ts';
import { parseInventory } from '../src/inventory.ts';
import { parseOutcomes } from '../src/outcomes.ts';
import { parsePaperLog } from '../src/paper.ts';
import { parsePositions } from '../src/positions.ts';
import { renderCsv, renderMarkdown } from '../src/render.ts';
import { parseThoughts } from '../src/thoughts.ts';

const DAY = Date.parse('2026-01-02T00:00:00Z');
const iso = (min: number): string => new Date(DAY + 10 * 3_600_000 + min * 60_000).toISOString();

function inputs() {
  const paper = parsePaperLog(
    [
      '[10:05:00 INFO]: ag_a was slain by Zombie',
      '[10:40:00 INFO]: ag_a drowned',
      '[10:41:00 INFO]: <ag_a> hi',
    ].join('\n'),
    DAY,
  );
  const body = parseBodyLog(
    [
      `{"event":"stall_diag","agent":"ag_a","ts":"${iso(3)}","reason":"escape_ladder","rung":"dig","worked":true}`,
      `{"event":"stall_diag","agent":"ag_a","ts":"${iso(4)}","reason":"escape_ladder","rung":"dig","worked":false}`,
    ].join('\n'),
    null,
  ).concat(
    parseOutcomes(
      [
        `{"type":"action_outcome","agent_id":"ag_a","at":"${iso(1)}","payload":{"verb":"walk","index":0,"ok":true,"message":"m"}}`,
        `{"type":"action_outcome","agent_id":"ag_a","at":"${iso(2)}","payload":{"verb":"mine","index":0,"ok":false,"reason":"no_effect","message":"m"}}`,
      ].join('\n'),
      null,
    ),
  );
  const inventory = parseInventory(
    [
      `${iso(0)}\tag_a\t[{id: "minecraft:oak_log", count: 1}]`,
      `${iso(12)}\tag_a\t[{id: "minecraft:wooden_pickaxe", count: 1}]`,
    ].join('\n'),
  );
  const positions = parsePositions(
    [`${iso(0)}\tag_a\t[0.0d, 64.0d, 0.0d]`, `${iso(1)}\tag_a\t[10.0d, 64.0d, 0.0d]`].join('\n'),
  );
  const thoughts = parseThoughts(
    JSON.stringify([
      {
        thought_id: '1',
        life_id: 'ag_a',
        at: iso(1),
        name: 'Amy',
        kind: 'journal',
        text: 'same line here',
      },
      {
        thought_id: '2',
        life_id: 'ag_a',
        at: iso(2),
        name: 'Amy',
        kind: 'journal',
        text: 'Same line here!',
      },
    ]),
  );
  return { paper, body, positions, inventory, thoughts };
}

describe('aggregate', () => {
  it('builds one row over all data with every headline metric', () => {
    const [r, ...rest] = aggregate(inputs(), 0);
    expect(rest).toHaveLength(0);
    expect(r).toMatchObject({
      agent: 'ag_a',
      deaths: 2,
      chat: 1,
      actions: 2,
      noEffectShare: 0.5,
      escapeSuccessRate: 0.5,
      rungWorked: 'dig=1',
      distance: 10,
      journalEntries: 2,
      repeatedJournalShare: 0.5,
      timeToFirstToolMin: 12,
    });
    expect(r?.outcomes).toBe('no_effect=1 ok=1');
    expect(r?.deathCauses).toBe('drowned=1 was slain by Zombie=1');
  });

  it('splits into windows and computes deaths per hour', () => {
    const rows = aggregate(inputs(), 30 * 60_000);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.deaths).toBe(1);
    expect(rows[0]?.deathsPerHour).toBeCloseTo(2, 5);
    expect(rows[1]?.deaths).toBe(1);
    expect(rows[0]?.timeToFirstToolMin).toBe(12);
    expect(rows[1]?.timeToFirstToolMin).toBeNull();
  });

  it('renders a markdown table and a CSV with one line per row', () => {
    const rows = aggregate(inputs(), 0);
    const md = renderMarkdown(rows);
    expect(md).toContain('| ag_a |');
    expect(md).toContain('50%');
    const csv = renderCsv(rows).trim().split('\n');
    expect(csv).toHaveLength(2);
    expect(csv[0]).toContain('deathsPerHour');
    expect(csv[1]).toContain(',drowned=1 was slain by Zombie=1,');
  });

  it('returns nothing for no data', () => {
    expect(
      aggregate({ paper: [], body: [], positions: [], inventory: [], thoughts: [] }, 0),
    ).toEqual([]);
  });

  it('keeps a short tail inside the last window and counts samples after the last log event', () => {
    const rows = aggregate(inputs(), 40 * 60_000);
    // data spans 0..41 min: the 1 minute tail joins the single window, so the 10:41 chat is not a second row
    expect(rows).toHaveLength(1);
    expect(rows[0]?.windowEnd).toBe(DAY + 10 * 3_600_000 + 41 * 60_000 + 1);
    expect(rows[0]?.deathsPerHour).toBeCloseTo(2 / (41 / 60), 2);
  });

  it('derives escape episodes from stalls: rung success, position change, or neither', () => {
    const stall = (min: number): string =>
      `{"event":"stall_diag","reason":"stall","life_id":"ag_a","at":"${iso(min)}"}`;
    const body = parseBodyLog(
      [
        stall(0),
        `{"event":"stall_diag","reason":"escape_ladder","rung":"dig","worked":true,"life_id":"ag_a","at":"${iso(1)}"}`,
        stall(10),
        stall(20),
        stall(30),
      ].join('\n'),
      null,
    );
    const positions = parsePositions(
      [
        `${iso(20)}\tag_a\t[0.0d, 64.0d, 0.0d]`,
        `${iso(21)}\tag_a\t[9.0d, 64.0d, 0.0d]`,
        `${iso(30)}\tag_a\t[9.0d, 64.0d, 0.0d]`,
        `${iso(31)}\tag_a\t[9.5d, 64.0d, 0.0d]`,
      ].join('\n'),
    );
    const [r] = aggregate({ paper: [], body, positions, inventory: [], thoughts: [] }, 0);
    expect(r).toMatchObject({ episodes: 4, episodesEscaped: 2, episodeSuccessRate: 0.5 });
  });
});

const AGENT = 'ag_test_01';
const FT0 = Date.parse('2026-11-12T10:00:00Z');
const NONE: Inputs = { paper: [], body: [], positions: [], inventory: [], thoughts: [] };

// Fixture lines in the shape registry.ts logs: one JSON object per failed action, `repeats` only when > 0.
const digTimeout = (ts: string, repeats?: number | string): string =>
  JSON.stringify({
    ts,
    event: 'action_failed',
    do: 'dig',
    args: { block: 'stone' },
    reason: 'timeout',
    message: 'no progress',
    pos: { x: 10.5, y: 64, z: -3.25 },
    ms: 5000,
    ...(repeats === undefined ? {} : { repeats }),
  });
const moveCancelled = (ts: string): string =>
  JSON.stringify({
    ts,
    event: 'action_failed',
    do: 'move',
    args: { x: 1, y: 64, z: 2 },
    reason: 'cancelled',
    message: '',
    pos: null,
    ms: 120,
  });
const stallOnly = (ts: string): string =>
  JSON.stringify({ ts, event: 'stall_diag', reason: 'no_progress', corrections_10s: 1 });

describe('action_failed lines', () => {
  it('parses one line into an action_failed event with do, reason, message and repeats', () => {
    const [ev] = parseBodyLine(digTimeout('2026-11-12T10:00:00Z', 3), AGENT);
    expect(ev).toMatchObject({
      agent: AGENT,
      kind: 'action_failed',
      reason: 'timeout',
      failure: { verb: 'dig', message: 'no progress', repeats: 3 },
    });
  });

  it('treats a missing or invalid repeats as zero', () => {
    expect(parseBodyLine(digTimeout('2026-11-12T10:00:00Z'), AGENT)[0]?.failure?.repeats).toBe(0);
    expect(parseBodyLine(digTimeout('2026-11-12T10:00:00Z', 'x'), AGENT)[0]?.failure?.repeats).toBe(
      0,
    );
    expect(parseBodyLine(digTimeout('2026-11-12T10:00:00Z', -2), AGENT)[0]?.failure?.repeats).toBe(
      0,
    );
  });

  it('counts each line as one plus its repeats, per agent and per window', () => {
    const body = parseBodyLog(
      [
        digTimeout('2026-11-12T10:00:00Z'),
        digTimeout('2026-11-12T10:01:00Z', 4),
        moveCancelled('2026-11-12T10:02:00Z'),
        digTimeout('2026-11-12T11:30:00Z', 2),
      ].join('\n'),
      AGENT,
    );
    const rows = aggregate({ ...NONE, body }, 60 * 60_000);
    expect(rows.map((r) => r.actionFailed)).toEqual([7, 3]);
    expect(rows[0]?.actionFailures).toBe('dig/timeout=6 move/cancelled=1');
    expect(rows[1]?.actionFailures).toBe('dig/timeout=3');
    expect(rows[0]?.windowStart).toBe(FT0);
  });

  it('reports zero for an older log with no action_failed lines and does not throw', () => {
    const body = parseBodyLog(stallOnly('2026-11-12T10:00:00Z'), AGENT);
    const [row] = aggregate({ ...NONE, body }, 0);
    expect(row?.actionFailed).toBe(0);
    expect(row?.actionFailures).toBe('');
    expect(topFailures(body)).toEqual([]);
    expect(renderTopFailures([])).toBe('');
  });

  it('ignores a malformed action_failed line', () => {
    expect(parseBodyLog('{"event":"action_failed",', AGENT)).toEqual([]);
  });

  it('lists the top five (do, reason, message) combinations by count, most first', () => {
    const lines = [
      digTimeout('2026-11-12T10:00:00Z', 4),
      moveCancelled('2026-11-12T10:01:00Z'),
      ...['a', 'b', 'c', 'd', 'e', 'f'].map((m, i) =>
        JSON.stringify({
          ts: `2026-11-12T10:0${i + 2}:00Z`,
          event: 'action_failed',
          do: 'craft',
          args: {},
          reason: 'no_items',
          message: `need ${m}`,
          pos: null,
        }),
      ),
    ];
    const top = topFailures(parseBodyLog(lines.join('\n'), AGENT));
    expect(top).toHaveLength(5);
    expect(top[0]).toEqual({ verb: 'dig', reason: 'timeout', message: 'no progress', count: 5 });
    expect(top.slice(1).map((c) => c.count)).toEqual([1, 1, 1, 1]);
    const md = renderTopFailures(top);
    expect(md).toContain('| 5 | dig | timeout | no progress |');
    expect(md.split('\n').filter((l) => l.startsWith('| ')).length).toBe(2 + 5);
  });
});
