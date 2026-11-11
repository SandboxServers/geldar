import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandler } from './http.ts';
import { OPEN_POLICY, type PublicPolicy, visibilityAt } from './policy.ts';
import { getThought, listReceipts, listThoughts, type SqlClient, thoughtsAfter } from './query.ts';
import { ROUTES } from './routes.ts';
import { streamFeed } from './server.ts';
import type { SseHub } from './sse.ts';

/** The predicate every thought and receipt statement carries: a living sovereign agent is hidden. */
const PREDICATE =
  /\(\$\d+::boolean OR a\.mode IS DISTINCT FROM 'sovereign' OR a\.died_at IS NOT NULL\)/;

type Call = { text: string; values: unknown[] };

function recorder(): { db: SqlClient; calls: Call[] } {
  const calls: Call[] = [];
  const db: SqlClient = {
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [] };
    },
  };
  return { db, calls };
}

/** The value bound to the predicate's show flag in the last statement. */
function flagOf(calls: Call[]): unknown {
  const last = calls[calls.length - 1];
  if (last === undefined) throw new Error('no statement ran');
  const n = Number(/\(\$(\d+)::boolean OR a\.mode/.exec(last.text)?.[1]);
  return last.values[n - 1];
}

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function get(policy: Partial<PublicPolicy>, db: SqlClient, name: string): Promise<number> {
  const server = createServer(createHandler({ db, hub: {} as unknown as SseHub, policy }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const route = ROUTES.find((r) => r.name === name);
  if (route === undefined) throw new Error(`no route ${name}`);
  const path = route.path.replace(':id', 'th-1') + (name === 'receipts' ? '?action_id=ac-1' : '');
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'GET', path }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('living sovereign agents (0072 item 4)', () => {
  it('hides them by default', () => {
    expect(OPEN_POLICY.showLivingSovereign).toBe(false);
    expect(visibilityAt(OPEN_POLICY).showLivingSovereign).toBe(false);
  });

  it.each([false, true])('every statement carries the predicate, bound to %s', async (flag) => {
    const { db, calls } = recorder();
    const shown = { shownUntil: null, showLivingSovereign: flag };
    await listThoughts(db, { limit: 5 }, shown);
    await getThought(db, 'th-1', shown);
    await thoughtsAfter(db, { at: '2026-11-11 00:00:00+00', id: '' }, 5, shown);
    await listReceipts(db, 'ac-1', shown);
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.text).toMatch(PREDICATE);
      expect(flagOf([call])).toBe(flag);
    }
  });

  it('the receipts statement joins agents on the receipt life', async () => {
    const { db, calls } = recorder();
    await listReceipts(db, 'ac-1');
    expect(calls[0]?.text).toContain('LEFT JOIN agents a ON a.agent_id = r.life_id');
  });

  it.each([false, true])(
    'the thought, receipt and stream routes pass %s from the policy',
    async (flag) => {
      for (const name of ['thoughts', 'thought', 'receipts']) {
        const { db, calls } = recorder();
        await get({ showLivingSovereign: flag }, db, name);
        expect(flagOf(calls), name).toBe(flag);
      }
      const { db, calls } = recorder();
      await streamFeed(db, { ...OPEN_POLICY, showLivingSovereign: flag })({
        at: '2026-11-11 00:00:00+00',
        id: '',
      });
      expect(flagOf(calls)).toBe(flag);
    },
  );

  it('with no policy given, the routes hide a living sovereign', async () => {
    const { db, calls } = recorder();
    await get({}, db, 'thoughts');
    expect(flagOf(calls)).toBe(false);
  });
});
