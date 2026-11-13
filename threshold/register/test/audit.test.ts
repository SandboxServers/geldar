import { describe, expect, it } from 'vitest';
import type { FlagQuery } from '../src/admin.ts';
import { writeAudit } from '../src/audit.ts';

/** A fake that records statements; `flagged` lists the owners whose flag reads true. */
function auditDb(flagged: string[] = [], failFlag = false) {
  const calls: { text: string; values?: unknown[] }[] = [];
  const db: FlagQuery = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.startsWith('SELECT register_is_admin')) {
        if (failFlag) throw new Error('lookup failed');
        return { rows: [{ admin: flagged.includes(String(values?.[0])) }] };
      }
      return { rows: [] };
    },
  };
  return { db, calls };
}

const inserted = (calls: { text: string; values?: unknown[] }[]) =>
  calls.filter((c) => c.text.startsWith('INSERT INTO register_audit'));

describe('writeAudit (decision 0170, C7-12)', () => {
  it('writes admin = true only for a flagged owner', async () => {
    const { db, calls } = auditDb(['alice']);
    await writeAudit(db, {
      actor: 'hash-alice',
      actorOwner: 'alice',
      action: 'player_start',
      target: 'p1',
      outcome: 'ok',
    });
    expect(inserted(calls)[0]?.values).toEqual([
      'hash-alice',
      'player_start',
      'p1',
      'ok',
      true,
      '',
    ]);
  });

  it('writes admin = false for an unflagged owner', async () => {
    const { db, calls } = auditDb(['alice']);
    await writeAudit(db, {
      actor: 'hash-bob',
      actorOwner: 'bob',
      action: 'a',
      target: 't',
      outcome: 'ok',
    });
    expect(inserted(calls)[0]?.values?.[4]).toBe(false);
  });

  it('writes admin = false when no actor owner is named (the operator)', async () => {
    const { db, calls } = auditDb(['alice']);
    await writeAudit(db, {
      actor: 'operator',
      action: 'admin_set',
      target: 'alice',
      outcome: 'ok',
    });
    expect(calls.some((c) => c.text.startsWith('SELECT register_is_admin'))).toBe(false);
    expect(inserted(calls)[0]?.values?.[4]).toBe(false);
  });

  it('writes admin = false when the flag lookup fails (fail closed)', async () => {
    const { db, calls } = auditDb(['alice'], true);
    await writeAudit(db, {
      actor: 'hash-alice',
      actorOwner: 'alice',
      action: 'a',
      target: 't',
      outcome: 'ok',
    });
    expect(inserted(calls)[0]?.values?.[4]).toBe(false);
  });

  it('refuses a detail over 256 characters and writes no row', async () => {
    const { db, calls } = auditDb();
    await expect(
      writeAudit(db, {
        actor: 'operator',
        action: 'a',
        target: 't',
        outcome: 'ok',
        detail: 'x'.repeat(257),
      }),
    ).rejects.toThrow('audit detail is over 256 characters');
    expect(calls).toHaveLength(0);
  });

  it('accepts a detail of exactly 256 characters', async () => {
    const { db, calls } = auditDb();
    await writeAudit(db, {
      actor: 'operator',
      action: 'a',
      target: 't',
      outcome: 'ok',
      detail: 'x'.repeat(256),
    });
    expect(inserted(calls)[0]?.values?.[5]).toBe('x'.repeat(256));
  });
});
