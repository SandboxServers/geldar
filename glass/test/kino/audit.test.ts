import { describe, expect, it } from 'vitest';
import { validateLakituAudit } from '../../../contract/src/generated/validators.js';
import {
  AUDIT_RETENTION_DAYS,
  type AuditEntry,
  type AuditStore,
  KinoAudit,
  loginHash,
  newPaneId,
  sqlAuditStore,
} from '../../src/kino/audit.ts';
import { type FeedSource, type KinoConn, KinoRelay } from '../../src/kino/relay.ts';
import type { Access, ScopeStore } from '../../src/kino/scope.ts';

const HASH = 'ab'.repeat(32);
const OWNER: Access = { signedIn: true, admin: true, ownerId: 'o1', banned: false };
const DAY = 86_400_000;
const NOW = new Date('2026-11-11T12:00:00.000Z');

function memory(failInsert = false) {
  const rows: AuditEntry[] = [];
  const store: AuditStore = {
    async insert(e) {
      if (failInsert) throw new Error('db down');
      rows.push(e);
    },
    async purgeBefore(cutoff) {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        if ((rows[i] as AuditEntry).at < cutoff) rows.splice(i, 1);
      }
      return before - rows.length;
    },
  };
  return { rows, store };
}

function relayRig(store: AuditStore) {
  const errors: unknown[] = [];
  const subs: string[] = [];
  const scope: ScopeStore = {
    access: async () => OWNER,
    agent: async () => ({ owner: 'o1', publicCamera: false }),
  };
  const feed: FeedSource = {
    subscribe: (a) => {
      subs.push(a);
      return () => {};
    },
  };
  const audit = new KinoAudit(store, (e) => errors.push(e));
  const relay = new KinoRelay({ store: scope, feed, audit, now: () => NOW });
  const conn = { sent: [] as string[], closed: 0 } as { sent: string[]; closed: number } & KinoConn;
  conn.send = (t) => void conn.sent.push(t);
  conn.close = () => void conn.closed++;
  return { relay, conn, errors, subs };
}
const sub = (a: string, mode = 'follow') =>
  JSON.stringify({ type: 'subscribe', target_agent_id: a, mode });

describe('audit rows', () => {
  it('open, retarget, mode change and close validate against lakitu-audit and hold no name', async () => {
    const { rows, store } = memory();
    const r = relayRig(store);
    const pane = r.relay.accept(r.conn, HASH, HASH);
    await pane?.message(sub('alpha', 'follow'));
    await pane?.message(sub('beta', 'follow'));
    await pane?.message(sub('beta', 'orbit'));
    pane?.closed();
    await new Promise((res) => setTimeout(res, 0));
    expect(rows.map((e) => e.event)).toEqual([
      'pane_opened',
      'pane_targeted',
      'pane_mode_changed',
      'pane_closed',
    ]);
    for (const e of rows) {
      expect(validateLakituAudit(e), JSON.stringify(validateLakituAudit.errors)).toBe(true);
      expect(e.login_hash).toBe(HASH);
      expect(Object.keys(e).sort()).not.toContain('name');
    }
    expect(rows[3]?.stopped_at).toBe(NOW.toISOString());
    expect(new Set(rows.map((e) => e.pane_id)).size).toBe(1);
  });

  it('hashes an anonymous session key and never stores it', () => {
    const h = loginHash(null, 'client-session-key');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('client');
    expect(newPaneId()).toMatch(/^pn_[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe('fail closed', () => {
  it('a failed write is reported and the pane is not left open', async () => {
    const r = relayRig(memory(true).store);
    const pane = r.relay.accept(r.conn, HASH, HASH);
    await pane?.message(sub('alpha'));
    expect(r.errors).toHaveLength(1);
    expect(r.subs).toEqual([]);
    expect(r.conn.sent).toEqual([JSON.stringify({ type: 'bye', reason: 'feed_unavailable' })]);
    expect(r.conn.closed).toBe(1);
    expect(r.relay.openPanes).toBe(0);
  });

  it('a socket that closes while the write is in flight opens nothing and records the stop', async () => {
    const { rows, store } = memory();
    let closeNow = (): void => {};
    const slow: AuditStore = {
      ...store,
      insert: async (e) => {
        closeNow();
        await new Promise((res) => setTimeout(res, 5));
        return store.insert(e);
      },
    };
    const r = relayRig(slow);
    const pane = r.relay.accept(r.conn, HASH, HASH);
    closeNow = () => pane?.closed();
    await pane?.message(sub('alpha'));
    await new Promise((res) => setTimeout(res, 10));
    expect(r.subs).toEqual([]);
    expect(rows.map((e) => e.event)).toEqual(['pane_opened', 'pane_closed']);
  });
});

describe('retention', () => {
  it('keeps 89 days and 90 days exactly, purges 91', async () => {
    const { rows, store } = memory();
    const mk = (days: number): AuditEntry => ({
      event: 'pane_opened',
      login_hash: HASH,
      agent_id: `a${days}`,
      pane_id: newPaneId(),
      mode: 'follow',
      at: new Date(NOW.getTime() - days * DAY).toISOString(),
    });
    for (const d of [89, 90, 91, 400]) rows.push(mk(d));
    const purged = await new KinoAudit(store).purge(NOW);
    expect(AUDIT_RETENTION_DAYS).toBe(90);
    expect(purged).toBe(2);
    expect(rows.map((e) => e.agent_id)).toEqual(['a89', 'a90']);
  });

  it('the SQL store sends only parameters', async () => {
    const calls: { text: string; values: unknown[] }[] = [];
    const store = sqlAuditStore({
      query: async (text, values) => {
        calls.push({ text, values });
        return { rows: [{ n: '3' }] };
      },
    });
    expect(await new KinoAudit(store).purge(NOW)).toBe(3);
    expect(calls[0]?.text).toContain('kino_audit_purge($1)');
    expect(calls[0]?.values).toEqual([new Date(NOW.getTime() - 90 * DAY).toISOString()]);
  });
});
