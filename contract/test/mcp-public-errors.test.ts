/**
 * The public MCP refusal bodies (decision 0090). Each shape is a fixed body: a stable error.code,
 * no stack, no path and no internal host, and no detail that says whether a token is valid.
 */
import { readFileSync } from 'node:fs';
import ajv2020Module from 'ajv/dist/2020.js';
import ajvFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const Ajv2020 = ajv2020Module.default;
const addFormats = ajvFormatsModule.default;

const commonUrl = new URL('../schemas/mcp-common.schema.json', import.meta.url);
const common = JSON.parse(readFileSync(commonUrl, 'utf8')) as Record<string, unknown>;
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(common);

const COMMON_ID = 'https://geldar.dev/schemas/mcp-common.schema.json';
const SHAPES = [
  'PublicUnauthenticatedError',
  'PublicRateLimitedError',
  'PublicKillSwitchError',
] as const;

function shape(name: string) {
  const check = ajv.getSchema(`${COMMON_ID}#/$defs/${name}`);
  if (check === undefined) throw new Error(`missing shape ${name}`);
  return check;
}

/** Every key name anywhere in a schema object, walking nested objects and arrays. */
function keyNames(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) keyNames(item, out);
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      out.push(key);
      keyNames(value, out);
    }
  }
  return out;
}

const unauthenticated = { error: { code: 'unauthenticated', message: 'Unauthorized' } };

describe('the public MCP refusal shapes', () => {
  it('defines each shape in mcp-common', () => {
    for (const name of SHAPES) expect(() => shape(name), name).not.toThrow();
  });

  it('accepts the fixed unauthenticated body and rejects a body that adds detail', () => {
    const check = shape('PublicUnauthenticatedError');
    expect(check(unauthenticated)).toBe(true);
    expect(check({ error: { ...unauthenticated.error, detail: 'token unknown' } })).toBe(false);
    expect(check({ ...unauthenticated, token_state: 'malformed' })).toBe(false);
  });

  it('accepts a rate-limit body with an integer retryAfter of at least 1, and requires it', () => {
    const check = shape('PublicRateLimitedError');
    const body = { error: { code: 'rate_limited', message: 'Too many requests' } };
    expect(check({ ...body, retryAfter: 30 })).toBe(true);
    expect(check({ ...body, retryAfter: 1 })).toBe(true);
    expect(check(body)).toBe(false);
    expect(check({ ...body, retryAfter: 0 })).toBe(false);
    expect(check({ ...body, retryAfter: 1.5 })).toBe(false);
    expect(check({ ...body, retryAfter: '30' })).toBe(false);
  });

  it('accepts the fixed kill-switch body and rejects a body that adds detail', () => {
    const check = shape('PublicKillSwitchError');
    const body = { error: { code: 'unavailable', message: 'Service unavailable' } };
    expect(check(body)).toBe(true);
    expect(check({ error: { ...body.error, reason: 'public.killSwitch' } })).toBe(false);
  });

  it('fixes error.code in each shape, so a client can match on it', () => {
    const codes = SHAPES.map((name) => {
      const def = (
        common.$defs as Record<string, { properties: { error: { properties: { code: unknown } } } }>
      )[name];
      return def?.properties.error.properties.code;
    });
    expect(codes).toEqual([
      { const: 'unauthenticated' },
      { const: 'rate_limited' },
      { const: 'unavailable' },
    ]);
  });

  it('has no key named stack, path or host in any shape', () => {
    const defs = common.$defs as Record<string, unknown>;
    const leaks = SHAPES.flatMap((name) =>
      keyNames(defs[name]).filter((key) => ['stack', 'path', 'host'].includes(key)),
    );
    expect(leaks).toEqual([]);
  });
});
