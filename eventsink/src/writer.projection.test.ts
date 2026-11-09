import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { actionEvent, eventOf, RECEIPT_A, receiptEvent } from './projection.fakes.ts';
import { pgEventWriter } from './writer.ts';

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
});
