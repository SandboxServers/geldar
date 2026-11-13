import { describe, expect, it } from 'vitest';
import { aggregate, type Inputs } from '../src/aggregate.ts';
import { parseBodyLog } from '../src/body.ts';
import { parsePositions, positionMetrics, stillNote } from '../src/positions.ts';
import { renderMarkdown } from '../src/render.ts';
import type { Thought } from '../src/thoughts.ts';
import { cutInputs, parseWindows } from '../src/window.ts';

const T0 = Date.parse('2026-03-01T10:00:00Z');
const iso = (min: number, sec = 0): string =>
  new Date(T0 + min * 60_000 + sec * 1000).toISOString();
const empty: Inputs = { paper: [], body: [], positions: [], inventory: [], thoughts: [] };

const stall = (min: number, corr: number | string, agent = 'ag_test_01'): string =>
  JSON.stringify({
    event: 'stall_diag',
    life_id: agent,
    ts: iso(min),
    reason: 'stall',
    control: 'walk',
    blocks: { below: 'stone', at: 'air' },
    corrections_10s: corr,
    ticks_since_correction: 3,
    path_status: 'blocked',
  });

describe('stall_diag fields, forced_move and rungs', () => {
  const lines = [
    stall(1, 57),
    stall(2, 40),
    stall(3, 0),
    `${iso(4)} {"event":"forced_move","server":{"x":1,"y":2,"z":3},"client_before":{"x":1,"y":2,"z":9}}`,
    `{"event":"forced_move","ts":"${iso(5)}","server":{},"client_before":{}}`,
    `{"event":"stall_diag","life_id":"ag_test_01","ts":"${iso(6)}","reason":"escape_ladder","rung":"dig","worked":false}`,
    `{"event":"stall_diag","life_id":"ag_test_01","ts":"${iso(7)}","reason":"escape_ladder","rung":"dig","worked":true}`,
    `{"event":"stall_diag","life_id":"ag_test_01","ts":"${iso(8)}","reason":"escape_ladder","rung":"pillar","worked":false}`,
  ].join('\n');
  const body = parseBodyLog(lines, 'ag_test_01');

  it('reads the new fields and the agent of a forced_move from the file', () => {
    expect(body[0]?.diag).toMatchObject({
      control: 'walk',
      below: 'stone',
      at: 'air',
      corrections10s: 57,
      ticksSinceCorrection: 3,
      pathStatus: 'blocked',
    });
    const fm = body.filter((e) => e.kind === 'forced_move');
    expect(fm.map((e) => e.agent)).toEqual(['ag_test_01', 'ag_test_01']);
    expect(fm[0]?.at).toBe(T0 + 4 * 60_000);
  });

  it('counts forced_move, max corrections, high share and the rubber-banding flag', () => {
    const [r] = aggregate({ ...empty, body }, 0);
    expect(r).toMatchObject({
      forcedMoves: 2,
      maxCorrections10s: 57,
      stallDiag: 3,
      rubberBanding: 'rubber-banding',
    });
    expect(r?.highCorrectionShare).toBeCloseTo(2 / 3);
  });

  it('does not flag a few high lines among many low ones, nor a lone line', () => {
    const calm = parseBodyLog(
      [stall(1, 0), stall(2, 1), stall(3, 2), stall(4, 12)].join('\n'),
      null,
    );
    expect(aggregate({ ...empty, body: calm }, 0)[0]?.rubberBanding).toBe('');
    const lone = parseBodyLog(stall(1, 90), null);
    expect(aggregate({ ...empty, body: lone }, 0)[0]?.rubberBanding).toBe('');
    const missing = parseBodyLog(stall(1, 'x'), null);
    expect(aggregate({ ...empty, body: missing }, 0)[0]?.maxCorrections10s).toBeNull();
  });

  it('keeps rung lines out of the stall count and per-rung worked and tried', () => {
    const [r] = aggregate({ ...empty, body }, 0);
    expect(r?.stallDiag).toBe(3);
    expect(r).toMatchObject({ rungLines: 3, rungTried: 'dig=2 pillar=1', rungWorked: 'dig=1' });
  });
});

describe('windows and cuts', () => {
  const th = (min: number, text: string, agent = 'ag_test_01'): Thought => ({
    agent,
    at: T0 + min * 60_000,
    text,
  });

  it('cuts every stream to [since, until) and drops untimed body events', () => {
    const body = parseBodyLog(
      `${stall(1, 1)}\n${stall(10, 1)}\n{"event":"eat","life_id":"ag_test_01"}`,
      null,
    );
    const inp: Inputs = {
      ...empty,
      body,
      positions: parsePositions(
        `${iso(1)}\tag_test_01\t[0d, 1d, 2d]\n${iso(10)}\tag_test_01\t[0d, 1d, 2d]`,
      ),
      thoughts: [th(1, 'a'), th(10, 'b')],
    };
    const cut = cutInputs(inp, T0 + 5 * 60_000, T0 + 20 * 60_000);
    expect([cut.body.length, cut.positions.length, cut.thoughts.length]).toEqual([1, 1, 1]);
    const upper = cutInputs(inp, null, T0 + 10 * 60_000);
    expect([upper.body.length, upper.positions.length, upper.thoughts.length]).toEqual([1, 1, 1]);
    expect(cutInputs(inp, null, null)).toBe(inp);
  });

  it('validates a windows file', () => {
    expect(parseWindows(`[{"name":"W1","start":"${iso(0)}","end":"${iso(5)}"}]`)).toEqual([
      { name: 'W1', start: T0, end: T0 + 5 * 60_000 },
    ]);
    expect(() => parseWindows('[]')).toThrow();
    expect(() => parseWindows(`[{"name":"W","start":"${iso(5)}","end":"${iso(0)}"}]`)).toThrow();
    expect(() => parseWindows('[{"name":"W","start":"x","end":"y"}]')).toThrow();
  });

  it('carries the previous 20 journal lines across a cut', () => {
    const same = 'stuck in the pit again';
    const thoughts = Array.from({ length: 25 }, (_, i) =>
      th(i, i < 24 ? `distinct line number ${i} alpha` : same),
    );
    thoughts.splice(0, 1, th(0, same));
    // the repeated text sits 24 lines before the cut start entry (outside 20) and at -1: only look-back sees it
    const all: Inputs = { ...empty, thoughts: [...thoughts, th(26, same)] };
    const cut = cutInputs(all, T0 + 26 * 60_000, null);
    const row = aggregate(cut, 0, { range: { start: T0 + 26 * 60_000, end: T0 + 30 * 60_000 } })[0];
    expect(row?.journalEntries).toBe(1);
    expect(row?.repeatedJournalShare).toBe(1);
    const lost = aggregate({ ...empty, thoughts: [th(26, same)] }, 0)[0];
    expect(lost?.repeatedJournalShare).toBe(0);
  });

  it('gives an empty named window a row that says insufficient data with the range covered', () => {
    const inp: Inputs = { ...empty, thoughts: [th(1, 'x'), th(2, 'y')] };
    const range = { start: T0, end: T0 + 10 * 60_000 };
    const rows = aggregate(cutInputs(inp, range.start, range.end), 0, {
      name: 'W1',
      range,
      agents: ['ag_test_01', 'ag_test_02'],
      minEvents: 5,
    });
    expect(rows.map((r) => [r.agent, r.insufficient, r.events])).toEqual([
      ['ag_test_01', 1, 2],
      ['ag_test_02', 1, 0],
    ]);
    const md = renderMarkdown(rows);
    expect(md).toContain('| W1 |');
    expect(md).toContain(
      `insufficient data (2 events, covered ${iso(1).slice(0, 16)} to ${iso(2).slice(0, 16)})`,
    );
    expect(md).toContain('insufficient data (0 events, covered nothing)');
    expect(md).not.toMatch(/\| 0\.00 \|/);
    const enough = aggregate(inp, 0, { minEvents: 2 })[0];
    expect(enough?.insufficient).toBe(0);
  });
});

describe('still samples', () => {
  it('flags no movement with the sample interval, but not movement or a single sample', () => {
    const still = parsePositions(
      [0, 5, 10].map((s) => `${iso(0, s)}\tag_test_01\t[1.0d, 64.0d, 2.0d]`).join('\n'),
    );
    const m = positionMetrics(still);
    expect(stillNote(m)).toBe('did not move in 3 samples (every 5 s)');
    expect(aggregate({ ...empty, positions: still }, 0)[0]?.positionNote).toBe(
      'did not move in 3 samples (every 5 s)',
    );
    const moved = parsePositions(
      [`${iso(0, 0)}\tag_test_01\t[1d, 64d, 2d]`, `${iso(0, 5)}\tag_test_01\t[1d, 64d, 5d]`].join(
        '\n',
      ),
    );
    expect(stillNote(positionMetrics(moved))).toBe('');
    expect(stillNote(positionMetrics(still.slice(0, 1)))).toBe('');
  });
});
