import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { listThoughtsWithJournal, microsOf, thoughtsAndJournalAfter } from './journal.ts';
import type { Row, SqlClient } from './query.ts';
import { filterThoughts, toView } from './render-model.ts';
import { type Doc, renderDetail, renderRow } from './render-view.ts';

type Call = { text: string; values: unknown[] };

const thought = (id: string, at: string): Row => ({
  thought_id: id,
  life_id: 'ag_h',
  at,
  cursor_at: at,
  name: 'Hob',
  tier: 'house',
  parsed: { plan: 'build' },
});
const line = (id: string, at: string, text = 'a line'): Row => ({
  thought_id: id,
  life_id: 'ag_s',
  at,
  cursor_at: at,
  journal_text: text,
  name: 'Jason',
  tier: 'sovereign',
});

/** A fake db: the thoughts statements answer `thoughts`, the journal functions answer `journal`. */
function fake(thoughts: Row[], journal: Row[]): { db: SqlClient; calls: Call[] } {
  const calls: Call[] = [];
  const db: SqlClient = {
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: text.includes('glass_journal_') ? journal : thoughts };
    },
  };
  return { db, calls };
}

const SHOWN = { shownUntil: '2026-11-11T00:00:00.000Z', showLivingSovereign: false };

describe('microsOf', () => {
  it('orders fractions numerically', () => {
    const a = microsOf('2026-11-11 10:00:00.1+00');
    const b = microsOf('2026-11-11 10:00:00.12+00');
    const c = microsOf('2026-11-11 10:00:00.09+00');
    expect(a !== null && b !== null && c !== null && c < a && a < b).toBe(true);
  });
  it('honours the zone offset on both signs and the whole-second form', () => {
    expect(microsOf('2026-11-11 10:00:00+00')).toBe(microsOf('2026-11-11 12:00:00+02'));
    expect(microsOf('2026-11-11 10:00:00+00')).toBe(microsOf('2026-11-11 05:00:00-05'));
    expect(microsOf('2026-11-11 10:00:00.000001+00')).toBe(
      (microsOf('2026-11-11 10:00:00+00') ?? 0n) + 1n,
    );
    expect(microsOf('garbage')).toBeNull();
  });
});

describe('listThoughtsWithJournal', () => {
  it('merges by time, newest first, with journal rows in thought shape', async () => {
    const { db } = fake(
      [thought('t1', '2026-11-10 10:00:00.5+00'), thought('t3', '2026-11-10 08:00:00+00')],
      [line('j2', '2026-11-10 09:00:00+00')],
    );
    const rows = await listThoughtsWithJournal(db, { limit: 10 }, SHOWN);
    expect(rows.map((r) => r.thought_id)).toEqual(['t1', 'j2', 't3']);
    expect(rows[1]).toMatchObject({
      kind: 'journal',
      text: 'a line',
      name: 'Jason',
      parsed: null,
      prompt_template_version: null,
      latency_ms: null,
    });
    expect(rows[1]).not.toHaveProperty('journal_text');
  });

  it('keeps the page at the limit so the next cursor (the last row) skips nothing', async () => {
    const { db } = fake(
      [thought('t1', '2026-11-10 10:00:00+00'), thought('t2', '2026-11-10 06:00:00+00')],
      [line('j1', '2026-11-10 09:00:00+00'), line('j2', '2026-11-10 08:00:00+00')],
    );
    const rows = await listThoughtsWithJournal(db, { limit: 3 }, SHOWN);
    expect(rows.map((r) => r.thought_id)).toEqual(['t1', 'j1', 'j2']);
  });

  it('passes the visibility to the function as parameters and nothing else widens it', async () => {
    const { db, calls } = fake([], []);
    await listThoughtsWithJournal(
      db,
      { limit: 7, lifeId: 'ag_s', before: { at: '2026-11-10 10:00:00+00', id: 'j9' } },
      { ...SHOWN, ownedAgents: ['ag_s'] },
    );
    const call = calls.find((c) => c.text.includes('glass_journal_page'));
    expect(call?.values).toEqual([
      SHOWN.shownUntil,
      ['ag_s'],
      false,
      'ag_s',
      null,
      null,
      '2026-11-10 10:00:00+00',
      'j9',
      7,
    ]);
  });

  it('leaves journal lines out when the outcome filter is set: they have no outcome', async () => {
    const { db, calls } = fake(
      [thought('t1', '2026-11-10 10:00:00+00')],
      [line('j1', '2026-11-10 11:00:00+00')],
    );
    const rows = await listThoughtsWithJournal(db, { limit: 10, outcome: 'parsed' }, SHOWN);
    expect(rows.map((r) => r.thought_id)).toEqual(['t1']);
    expect(calls.some((c) => c.text.includes('glass_journal_page'))).toBe(false);
  });
});

describe('thoughtsAndJournalAfter', () => {
  it('merges oldest first and returns at most limit, the smallest of the union', async () => {
    const { db, calls } = fake(
      [thought('t1', '2026-11-10 10:00:00+00'), thought('t4', '2026-11-10 13:00:00+00')],
      [line('j2', '2026-11-10 11:00:00+00'), line('j3', '2026-11-10 12:00:00+00')],
    );
    const rows = await thoughtsAndJournalAfter(
      db,
      { at: '2026-11-10 09:00:00+00', id: '' },
      3,
      SHOWN,
    );
    expect(rows.map((r) => r.thought_id)).toEqual(['t1', 'j2', 'j3']);
    const call = calls.find((c) => c.text.includes('glass_journal_after'));
    // The shared stream passes no owned agents: the delay holds for every row.
    expect(call?.values).toEqual(['2026-11-10 09:00:00+00', '', SHOWN.shownUntil, false, 3]);
  });
});

describe('journal text is untrusted', () => {
  const HOSTILE_TEXT = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const view = toView({
    kind: 'journal',
    thought_id: 'j1',
    life_id: 'ag_s',
    at: '2026-11-10T09:00:00Z',
    name: 'Jason',
    tier: 'sovereign',
    text: HOSTILE_TEXT,
    parsed: null,
  });

  it('is shown as text in the row and the detail, never as markup', () => {
    const doc = new Window().document as unknown as Doc & {
      body: { append(n: unknown): void; innerHTML: string; querySelector(s: string): unknown };
    };
    doc.body.append(renderRow(doc, view, () => {}));
    doc.body.append(renderDetail(doc, view, []));
    expect(doc.body.innerHTML).not.toMatch(/<(script|img)[\s>]/i);
    expect(doc.body.innerHTML).toContain('&lt;img');
    expect(doc.body.querySelector('img')).toBeNull();
  });

  it('has neutral outcome and template, so the filters exclude it only when they are set', () => {
    expect(view).toMatchObject({ kind: 'journal', outcome: 'none', templateVersion: '' });
    expect(filterThoughts([view], {})).toHaveLength(1);
    expect(filterThoughts([view], { outcome: 'parsed' })).toHaveLength(0);
    expect(filterThoughts([view], { outcome: 'unparsed' })).toHaveLength(0);
    expect(filterThoughts([view], { templateVersion: 'v1' })).toHaveLength(0);
    expect(filterThoughts([view], { agentId: 'ag_s', keyword: 'SCRIPT' })).toHaveLength(1);
  });
});
