import { describe, expect, it } from 'vitest';
import { type FlagQuery, isAdminOwner } from '../src/admin.ts';

/** A fake that answers the flag function with the given value, or fails when `error` is set. */
function flagDb(answer: unknown, error?: Error) {
  const calls: { text: string; values?: unknown[] }[] = [];
  const db: FlagQuery = {
    async query(text, values) {
      calls.push({ text, values });
      if (error !== undefined) throw error;
      return { rows: answer === undefined ? [] : [{ admin: answer }] };
    },
  };
  return { db, calls };
}

describe('isAdminOwner (decision 0170, C7-12)', () => {
  it('reads true only for a flagged owner', async () => {
    const { db, calls } = flagDb(true);
    expect(await isAdminOwner(db, 'alice')).toBe(true);
    expect(calls[0]?.text).toContain('register_is_admin($1)');
    expect(calls[0]?.values).toEqual(['alice']);
  });

  it('reads false for an unflagged owner', async () => {
    expect(await isAdminOwner(flagDb(false).db, 'bob')).toBe(false);
  });

  it('fails closed for an unknown owner (no row)', async () => {
    expect(await isAdminOwner(flagDb(undefined).db, 'ghost')).toBe(false);
  });

  it('fails closed when the value is not exactly true', async () => {
    expect(await isAdminOwner(flagDb('true').db, 'alice')).toBe(false);
    expect(await isAdminOwner(flagDb(null).db, 'alice')).toBe(false);
  });

  it('fails closed when the query errors', async () => {
    const { db } = flagDb(true, new Error('connection lost'));
    expect(await isAdminOwner(db, 'alice')).toBe(false);
  });
});
