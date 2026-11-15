import { DEFAULT_THRESHOLDS } from '@geldar/psyche';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decisionEvent, rollEvent, sheetEvent } from './audit/projection.fakes.ts';
import { actionEvent, eventOf, RECEIPT_A, receiptEvent } from './projection.fakes.ts';
import { pgEventWriter, type XpWriting } from './writer.ts';
import { awardsFor } from './xp/awards.ts';

vi.mock('./xp/awards.ts', () => ({ awardsFor: vi.fn(() => []) }));

const XP_ON: XpWriting = { enabled: true, thresholds: DEFAULT_THRESHOLDS };
const AWARD = {
  lifeId: 'ag_kestrel_01',
  domain: 'mining',
  evidenceKey: 'k1',
  sourceEventId: 'ev_1',
  worldTick: 100,
} as const;

/**
 * A pool whose client answers the XP statements: the life exists and the evidence is new, unless
 * `duplicate`. `failOn` makes one statement throw a check violation (SQLSTATE 23514).
 */
function xpPool(options: { duplicate?: boolean; failOn?: RegExp } = {}) {
  const texts: string[] = [];
  const client = {
    query: async (text: string) => {
      texts.push(text);
      if (options.failOn?.test(text)) throw Object.assign(new Error('boom'), { code: '23514' });
      if (/FROM agents/.test(text)) return { rows: [{ '?column?': 1 }] };
      if (/INSERT INTO xp_evidence/.test(text)) {
        return { rows: options.duplicate ? [] : [{ '?column?': 1 }] };
      }
      if (/INSERT INTO proficiency /.test(text)) return { rows: [{ xp: 1 }] };
      if (/SUM\(xp\)/.test(text)) return { rows: [{ total: 1 }] };
      return { rows: [] };
    },
    release: () => undefined,
  };
  const pool = {
    connect: async () => client,
    query: async () => {
      throw new Error('a transaction must use one client');
    },
  } as unknown as Pool;
  return { pool, texts, index: (re: RegExp) => texts.findIndex((t) => re.test(t)) };
}

/** A pool whose one client records every statement and can fail on a match. */
function fakePool(failOn?: RegExp) {
  const sql: string[] = [];
  let released = 0;
  const client = {
    query: async (text: string) => {
      sql.push(text.trim().split(/\s+/).slice(0, 3).join(' '));
      if (failOn?.test(text)) throw Object.assign(new Error('boom'), { code: '23505' });
      return { rows: [] };
    },
    release: () => void released++,
  };
  const pool = {
    connect: async () => client,
    query: async () => {
      throw new Error('a projected batch must use one client');
    },
  } as unknown as Pool;
  return { pool, sql, released: () => released };
}

describe('pgEventWriter projection', () => {
  it('inserts and projects in one transaction', async () => {
    const { pool, sql, released } = fakePool();
    await pgEventWriter(pool).insertBatch([
      actionEvent('accepted'),
      receiptEvent(RECEIPT_A, 'committed'),
    ]);
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toContain('INSERT INTO events');
    expect(sql.some((s) => s.startsWith('INSERT INTO actions'))).toBe(true);
    expect(sql.some((s) => s.startsWith('INSERT INTO receipts'))).toBe(true);
    expect(sql.at(-1)).toBe('COMMIT');
    expect(released()).toBe(1);
  });

  it('rolls back and rethrows when the projection fails', async () => {
    const { pool, sql, released } = fakePool(/INSERT INTO receipts/);
    await expect(
      pgEventWriter(pool).insertBatch([receiptEvent(RECEIPT_A, 'committed')]),
    ).rejects.toMatchObject({ code: '23505' });
    expect(sql.at(-1)).toBe('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(released()).toBe(1);
  });

  it('destroys the client when the rollback itself fails, and keeps it when it works', async () => {
    const releases: unknown[] = [];
    const client = {
      query: async (text: string) => {
        if (/INSERT INTO receipts/.test(text))
          throw Object.assign(new Error('boom'), { code: '23505' });
        if (text === 'ROLLBACK') throw new Error('connection lost');
        return { rows: [] };
      },
      release: (destroy?: boolean) => void releases.push(destroy),
    };
    const pool = { connect: async () => client } as unknown as Pool;
    await expect(
      pgEventWriter(pool).insertBatch([receiptEvent(RECEIPT_A, 'committed')]),
    ).rejects.toMatchObject({ code: '23505' });
    expect(releases).toEqual([true]);
    const ok = fakePool(/INSERT INTO receipts/);
    await pgEventWriter(ok.pool)
      .insertBatch([receiptEvent(RECEIPT_A, 'committed')])
      .catch(() => undefined);
    expect(ok.released()).toBe(1);
  });

  it('projects roll and decision events in the same transaction as their events row', async () => {
    const { pool, sql, released } = fakePool();
    await pgEventWriter(pool).insertBatch([rollEvent(1), decisionEvent(2)]);
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toContain('INSERT INTO events');
    expect(sql).toContain('INSERT INTO rolls');
    expect(sql).toContain('INSERT INTO decisions');
    expect(sql.at(-1)).toBe('COMMIT');
    expect(released()).toBe(1);
  });

  it('rolls the whole batch back when a roll insert fails', async () => {
    const { pool, sql, released } = fakePool(/INSERT INTO rolls/);
    await expect(pgEventWriter(pool).insertBatch([rollEvent(1)])).rejects.toMatchObject({
      code: '23505',
    });
    expect(sql).toContain('INSERT INTO events');
    expect(sql.at(-1)).toBe('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(released()).toBe(1);
  });

  it('sends a sheet_adopted event to the adoption path inside the transaction', async () => {
    const { pool, sql } = fakePool();
    // The fake returns no rows, so the adoption finds no life and is refused: the batch rolls back.
    await expect(pgEventWriter(pool).insertBatch([sheetEvent(3)])).rejects.toMatchObject({
      code: '23503',
    });
    expect(sql).toContain('UPDATE agents SET');
    expect(sql.at(-1)).toBe('ROLLBACK');
  });

  it('keeps a batch with no projected type on the single INSERT path', async () => {
    const calls: string[] = [];
    const pool = {
      query: async (text: string) => void calls.push(text),
      connect: async () => {
        throw new Error('no client needed');
      },
    } as unknown as Pool;
    await pgEventWriter(pool).insertBatch([eventOf('reflex_fired', { name: 'eat' })]);
    expect(calls).toHaveLength(1);
  });

  describe('XP (card AN-10a)', () => {
    beforeEach(() => {
      vi.mocked(awardsFor).mockClear();
    });

    it('with XP off, no award is computed and no XP statement runs', async () => {
      const { pool, texts } = xpPool();
      await pgEventWriter(pool).insertBatch([actionEvent('accepted')]);
      expect(awardsFor).not.toHaveBeenCalled();
      expect(texts.some((t) => /xp_evidence|proficiency/.test(t))).toBe(false);
      expect(texts.at(-1)).toBe('COMMIT');
    });

    it('with XP on, an award runs in the batch transaction after the events insert', async () => {
      vi.mocked(awardsFor).mockReturnValueOnce([{ ...AWARD, domain: 'mining' }]);
      const { pool, texts, index } = xpPool();
      await pgEventWriter(pool, XP_ON).insertBatch([eventOf('reflex_fired', { name: 'eat' })]);
      expect(texts[0]).toBe('BEGIN');
      expect(index(/INSERT INTO events/)).toBe(1);
      expect(index(/INSERT INTO xp_evidence/)).toBeGreaterThan(index(/INSERT INTO events/));
      expect(index(/INSERT INTO proficiency /)).toBeGreaterThan(index(/INSERT INTO xp_evidence/));
      expect(index(/INSERT INTO proficiency_outbox/)).toBe(-1);
      expect(texts.at(-1)).toBe('COMMIT');
    });

    it('with XP on, a redelivered award (no evidence row) bumps nothing', async () => {
      vi.mocked(awardsFor).mockReturnValueOnce([AWARD]);
      const { pool, texts } = xpPool({ duplicate: true });
      await pgEventWriter(pool, XP_ON).insertBatch([eventOf('reflex_fired', { name: 'eat' })]);
      expect(texts.some((t) => /INSERT INTO proficiency /.test(t))).toBe(false);
      expect(texts.at(-1)).toBe('COMMIT');
    });

    it('with XP on, a failed award rolls back the whole batch, the events row included', async () => {
      vi.mocked(awardsFor).mockReturnValueOnce([AWARD]);
      const { pool, texts } = xpPool({ failOn: /INSERT INTO proficiency / });
      await expect(
        pgEventWriter(pool, XP_ON).insertBatch([eventOf('reflex_fired', { name: 'eat' })]),
      ).rejects.toMatchObject({ code: '23514' });
      expect(texts.at(-1)).toBe('ROLLBACK');
      expect(texts).not.toContain('COMMIT');
    });
  });
});
