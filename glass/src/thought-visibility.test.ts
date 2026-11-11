import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { signKinoSession } from '../test/kino-fixture.ts';
import { createHandler } from './http.ts';
import { ownedAgentsOf } from './owner-view.ts';
import { listThoughts, type SqlClient, thoughtsAfter } from './query.ts';
import type { SseHub } from './sse.ts';

const KEY = 'k'.repeat(40);
const OWNER_HASH = 'ab'.repeat(32);
const BANNED_HASH = 'cd'.repeat(32);

type Call = { text: string; values: unknown[] };

function fakeDb(): { db: SqlClient; calls: Call[] } {
  const calls: Call[] = [];
  const db: SqlClient = {
    query: async (text, values) => {
      calls.push({ text, values });
      // glass_owner_agents: the owner owns one agent; a banned identity gets no row.
      if (text.includes('glass_owner_agents')) {
        return { rows: values[0] === OWNER_HASH ? [{ agent_id: 'ag-mine' }] : [] };
      }
      return { rows: [] };
    },
  };
  return { db, calls };
}

let server: Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

async function getThoughts(cookie: string | undefined, key: string | undefined = KEY) {
  const { db, calls } = fakeDb();
  server = createServer(
    createHandler({ db, hub: {} as SseHub, ...(key ? { sessionKey: key } : {}), now: () => 100 }),
  );
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  await fetch(`http://127.0.0.1:${port}/api/thoughts`, { headers: cookie ? { cookie } : {} });
  const run = calls.find((c) => c.text.includes('FROM thoughts'));
  return { calls, owned: run?.values[9] };
}

const session = (hash: string, expiresAt = 1000) =>
  `gk_session=${signKinoSession(KEY, { identityHash: hash, expiresAt })}`;

describe('rule 1: the owner sees their own sovereign players live', () => {
  it('passes the owner agents to the thought query, which exempts them from the hiding and the delay', async () => {
    const { owned, calls } = await getThoughts(session(OWNER_HASH));
    expect(owned).toEqual(['ag-mine']);
    const sql = calls.find((c) => c.text.includes('FROM thoughts'))?.text ?? '';
    expect(sql).toMatch(
      /OR a\.agent_id = ANY\(\$10::text\[\]\)\)\s+AND \(\$9::timestamptz IS NULL/,
    );
    expect(sql).toMatch(
      /t\.at <= \$9::timestamptz OR a\.died_at IS NOT NULL\s+OR a\.agent_id = ANY/,
    );
  });
});

describe('rule 2: a non-owner sees only the public rules', () => {
  const cases: [string, () => Promise<{ calls: Call[]; owned: unknown }>][] = [
    ['anonymous', () => getThoughts(undefined)],
    ['forged cookie', () => getThoughts('gk_session=junk')],
    ['expired cookie', () => getThoughts(session(OWNER_HASH, 50))],
    ['wrong key', () => getThoughts(session(OWNER_HASH), 'z'.repeat(40))],
    ['no key configured', () => getThoughts(session(OWNER_HASH), '')],
    ['banned identity', () => getThoughts(session(BANNED_HASH))],
  ];
  for (const [name, run] of cases) {
    it(`${name}: no owned agent reaches the query`, async () => {
      const { owned } = await run();
      expect(owned).toEqual([]);
    });
  }

  it('a database error while resolving the owner gives an empty list, not a 500', async () => {
    const db: SqlClient = {
      query: async () => {
        throw new Error('down');
      },
    };
    expect(await ownedAgentsOf(db, KEY, session(OWNER_HASH), 100)).toEqual([]);
  });
});

describe('rule 3: the thoughts of a dead life are public, with no delay', () => {
  it('listThoughts lets a row through the delay once the agent has died_at', async () => {
    const { db, calls } = fakeDb();
    await listThoughts(
      db,
      { limit: 5 },
      { shownUntil: '2026-01-01T00:00:00Z', showLivingSovereign: false },
    );
    const sql = calls[0]?.text ?? '';
    expect(sql).toMatch(
      /\$8::boolean OR a\.mode IS DISTINCT FROM 'sovereign' OR a\.died_at IS NOT NULL/,
    );
    expect(sql).toMatch(/t\.at <= \$9::timestamptz OR a\.died_at IS NOT NULL/);
    expect(calls[0]?.values[9]).toEqual([]);
  });

  it('the shared stream keeps the delay for every row so its cursor never skips one', async () => {
    const { db, calls } = fakeDb();
    await thoughtsAfter(db, { at: '2026-01-01T00:00:00Z', id: '' }, 5, {
      shownUntil: '2026-01-01T00:00:00Z',
      showLivingSovereign: false,
      ownedAgents: ['ag-mine'],
    });
    const sql = calls[0]?.text ?? '';
    expect(sql).toMatch(/AND \(\$5::timestamptz IS NULL OR t\.at <= \$5::timestamptz\)/);
    expect(sql).not.toContain('ANY(');
  });
});

describe('rule 4: the owner opt-in shows a living sovereign agent after the delay', () => {
  it('the membership test reads thoughts_delayed_public and the delay still applies', async () => {
    const { db, calls } = fakeDb();
    await listThoughts(
      db,
      { limit: 5 },
      { shownUntil: '2026-01-01T00:00:00Z', showLivingSovereign: false },
    );
    const sql = calls[0]?.text ?? '';
    expect(sql).toMatch(/a\.died_at IS NOT NULL\s+OR a\.thoughts_delayed_public/);
    expect(calls[0]?.values[8]).toBe('2026-01-01T00:00:00Z');
  });
});
