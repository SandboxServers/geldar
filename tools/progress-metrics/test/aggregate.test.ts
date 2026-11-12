import { describe, expect, it } from 'vitest';
import { aggregate } from '../src/aggregate.ts';
import { parseBodyLog } from '../src/body.ts';
import { parseInventory } from '../src/inventory.ts';
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
      `{"event":"action_result","agent":"ag_a","ts":"${iso(1)}","reason":"moved"}`,
      `{"event":"action_result","agent":"ag_a","ts":"${iso(2)}","reason":"no_effect"}`,
      `{"event":"stall_diag","agent":"ag_a","ts":"${iso(3)}","reason":"escape_ladder","rung":"dig","worked":true}`,
      `{"event":"stall_diag","agent":"ag_a","ts":"${iso(4)}","reason":"escape_ladder","rung":"dig","worked":false}`,
    ].join('\n'),
    null,
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
        life_id: 'l',
        at: iso(1),
        name: 'ag_a',
        kind: 'journal',
        text: 'same line here',
      },
      {
        thought_id: '2',
        life_id: 'l',
        at: iso(2),
        name: 'ag_a',
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
    expect(r?.outcomes).toBe('moved=1 no_effect=1');
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
});
