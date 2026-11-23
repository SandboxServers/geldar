import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { signKinoSession } from '../test/kino-fixture.ts';
import { createHandler } from './http.ts';
import type { SqlClient } from './query.ts';
import type { SseHub } from './sse.ts';

/**
 * The thought route (GET /api/thoughts/:id) with a fake database that answers the three statements it runs:
 * the owner lookup, getThought and the action join. These checks prove the route sends action_ids in order
 * and asks the join with the same visibility it asked getThought with (decision 0410 A8).
 */
const KEY = 'k'.repeat(40);
const OWNER_HASH = 'ab'.repeat(32);
const THOUGHT_ROW = {
  thought_id: 'th-1',
  life_id: 'ag-1',
  at: '2026-11-11T09:00:00.000Z',
  tier: 'standard',
  name: 'Ada',
  model_input: 'SECRET-PROMPT',
  raw_output: 'SECRET-RAW',
};

type Call = { text: string; values: unknown[] };

function fakeDb(thoughtRows: unknown[], actionRows: unknown[]): { db: SqlClient; calls: Call[] } {
  const calls: Call[] = [];
  const db: SqlClient = {
    query: async (text, values) => {
      calls.push({ text, values });
      if (text.includes('glass_owner_agents')) {
        return { rows: values[0] === OWNER_HASH ? [{ agent_id: 'ag-mine' }] : [] };
      }
      if (text.includes('JOIN intents')) return { rows: actionRows };
      if (text.includes('FROM thoughts t LEFT JOIN agents a')) return { rows: thoughtRows };
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

async function getThought(thoughtRows: unknown[], actionRows: unknown[], cookie?: string) {
  const { db, calls } = fakeDb(thoughtRows, actionRows);
  server = createServer(createHandler({ db, hub: {} as SseHub, sessionKey: KEY, now: () => 100 }));
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const res = await fetch(`http://127.0.0.1:${port}/api/thoughts/th-1`, {
    headers: cookie ? { cookie } : {},
  });
  const text = await res.text();
  const body = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
  const getCall = calls.find((c) => c.text.includes('FROM thoughts t LEFT JOIN agents a'));
  const joinCall = calls.find((c) => c.text.includes('JOIN intents'));
  return { status: res.status, body, text, getCall, joinCall };
}

const session = (hash: string) =>
  `gk_session=${signKinoSession(KEY, { identityHash: hash, expiresAt: 1000 })}`;

describe('GET /api/thoughts/:id sends the actions the thought led to', () => {
  it('sends action_ids in the order the join returns them', async () => {
    const { status, body } = await getThought(
      [THOUGHT_ROW],
      [{ action_id: 'ac-1' }, { action_id: 'ac-2' }, { action_id: 'ac-3' }],
    );
    expect(status).toBe(200);
    const thought = body.thought as Record<string, unknown>;
    expect(thought.action_ids).toEqual(['ac-1', 'ac-2', 'ac-3']);
    expect(thought.thought_id).toBe('th-1');
  });

  it('sends an empty action_ids when the thought led to no action', async () => {
    const { body } = await getThought([THOUGHT_ROW], []);
    expect((body.thought as Record<string, unknown>).action_ids).toEqual([]);
  });

  it('never sends the prompt or the raw reply', async () => {
    const { text } = await getThought([THOUGHT_ROW], [{ action_id: 'ac-1' }]);
    expect(text).not.toContain('SECRET-PROMPT');
    expect(text).not.toContain('SECRET-RAW');
  });

  it('asks the join with the same visibility it asked getThought with (default viewer)', async () => {
    const { getCall, joinCall } = await getThought([THOUGHT_ROW], [{ action_id: 'ac-1' }]);
    expect(getCall).toBeDefined();
    expect(joinCall).toBeDefined();
    expect(joinCall?.values.slice(0, 4)).toEqual([...(getCall?.values.slice(0, 4) ?? [])]);
    expect(joinCall?.values[0]).toBe('th-1');
  });

  it('asks the join with the owner agents when the viewer owns the thought agent', async () => {
    const { getCall, joinCall } = await getThought(
      [THOUGHT_ROW],
      [{ action_id: 'ac-1' }],
      session(OWNER_HASH),
    );
    expect(getCall?.values[3]).toEqual(['ag-mine']);
    expect(joinCall?.values).toEqual(getCall?.values.slice(0, 4));
  });

  it('answers 404 and runs no join for a thought the viewer may not see', async () => {
    const { status, body, joinCall } = await getThought([], [{ action_id: 'ac-1' }]);
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'not found' });
    expect(joinCall).toBeUndefined();
  });
});
