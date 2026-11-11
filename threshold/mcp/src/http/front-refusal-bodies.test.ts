import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  PublicKillSwitchError,
  PublicRateLimitedError,
  PublicUnauthenticatedError,
} from '../../../../contract/src/generated/types.ts';
import {
  CappedLimiter,
  INIT,
  startDoor,
  storeWithTokenA,
  TOKEN_A,
} from '../fakes/front-door.fakes.ts';
import { FakeTokenStore } from '../fakes/stores.fakes.ts';
import type { FrontDoor } from './front.ts';

// The 0090 refusal bodies, byte for byte, and checked against the contract schema they come from.
const UNAUTHENTICATED = '{"error":{"code":"unauthenticated","message":"Unauthorized"}}';
const UNAVAILABLE = '{"error":{"code":"unavailable","message":"Service unavailable"}}';

type Schema = {
  type?: string;
  const?: unknown;
  minimum?: number;
  maximum?: number;
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, Schema>;
};

const common = JSON.parse(
  readFileSync(
    new URL('../../../../contract/schemas/mcp-common.schema.json', import.meta.url),
    'utf8',
  ),
) as { $defs: Record<string, Schema> };

/** Checks a value against the subset of JSON Schema the public error shapes use. */
function conforms(value: unknown, schema: Schema, path = '$'): string[] {
  if ('const' in schema) return value === schema.const ? [] : [`${path}: not the const`];
  if (schema.type === 'integer') {
    const ok =
      Number.isInteger(value) &&
      (value as number) >= (schema.minimum ?? -Infinity) &&
      (value as number) <= (schema.maximum ?? Infinity);
    return ok ? [] : [`${path}: not an integer in range`];
  }
  if (typeof value !== 'object' || value === null) return [`${path}: not an object`];
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of schema.required ?? []) {
    if (!(key in record)) problems.push(`${path}.${key}: missing`);
  }
  for (const [key, sub] of Object.entries(record)) {
    const known = schema.properties?.[key];
    if (known === undefined) {
      if (schema.additionalProperties === false) problems.push(`${path}.${key}: not allowed`);
    } else problems.push(...conforms(sub, known, `${path}.${key}`));
  }
  return problems;
}

function shape(name: string): Schema {
  const found = common.$defs[name];
  if (found === undefined) throw new Error(`missing shape ${name}`);
  return found;
}

let door: FrontDoor | undefined;

afterEach(async () => {
  await door?.close();
  door = undefined;
});

function post(port: number, authorization: string | undefined, client = '198.51.100.1') {
  return fetch(`http://127.0.0.1:${port}/p/aa`, {
    method: 'POST',
    headers: {
      ...(authorization === undefined ? {} : { Authorization: authorization }),
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-geldar-client-ip': client,
    },
    body: INIT,
  });
}

const bad = (n: number): string => `Bearer gmcp-${String(n).padStart(64, '0')}`;

async function start(store: FakeTokenStore = storeWithTokenA(new FakeTokenStore())) {
  const started = await startDoor({
    http: { trustedProxies: ['127.0.0.1'] },
    store,
    limiter: new CappedLimiter(5),
    now: () => 0,
  });
  door = started.door;
  return started.port;
}

describe('the 0090 refusal bodies', () => {
  it('answers 401 with the unauthenticated body for a missing, malformed and unknown token', async () => {
    const port = await start();
    for (const header of [undefined, 'Basic abc', 'Bearer short', bad(1)]) {
      const reply = await post(port, header);
      expect(reply.status).toBe(401);
      expect(reply.headers.get('www-authenticate')).toBe('Bearer');
      expect(reply.headers.get('content-type')).toContain('application/json');
      const text = await reply.text();
      expect(text).toBe(UNAUTHENTICATED);
      const body = JSON.parse(text) as PublicUnauthenticatedError;
      expect(conforms(body, shape('PublicUnauthenticatedError'))).toEqual([]);
    }
  });

  it('answers the failed-auth lockout with the rate_limited body and a matching Retry-After', async () => {
    const port = await start();
    let reply = await post(port, bad(0));
    for (let n = 1; reply.status === 401 && n < 200; n++) reply = await post(port, bad(n));
    expect(reply.status).toBe(429);
    const retryAfter = reply.headers.get('retry-after');
    const body = (await reply.json()) as PublicRateLimitedError;
    expect(conforms(body, shape('PublicRateLimitedError'))).toEqual([]);
    expect(body.retryAfter).toBe(Number(retryAfter));
    expect(JSON.stringify(body)).toBe(
      `{"error":{"code":"rate_limited","message":"Too many requests"},"retryAfter":${retryAfter}}`,
    );
  });

  it('answers a store that is down with the unavailable body', async () => {
    const store = storeWithTokenA(new FakeTokenStore());
    store.resolve = async () => {
      throw new Error('connect ECONNREFUSED db-internal.example:5432');
    };
    const port = await start(store);
    const reply = await post(port, `Bearer ${TOKEN_A}`);
    expect(reply.status).toBe(503);
    const text = await reply.text();
    expect(text).toBe(UNAVAILABLE);
    expect(conforms(JSON.parse(text) as PublicKillSwitchError, shape('PublicKillSwitchError'))).toEqual(
      [],
    );
  });
});
