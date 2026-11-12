import { describe, expect, it } from 'vitest';
import { type CliDeps, runCli } from './cli.ts';
import type { SkinKv } from './skin-store.ts';

const SHARD = `sovereign:\n  players:\n    - { player_id: ag-jason-01, life_id: ag_jason_01, name: Jason }\n`;
const VALUE = Buffer.from(
  JSON.stringify({ textures: { SKIN: { url: 'https://textures.minecraft.net/texture/abc' } } }),
).toString('base64');
const SIGNATURE = 'c2lnbmF0dXJlLXNlY3JldA==';

function run(stored: Record<string, string>, natsUrl = 'nats://127.0.0.1:4222') {
  const lines: string[] = [];
  const kv: SkinKv = {
    put: async () => 1,
    get: async (key) => {
      const raw = stored[key];
      return raw === undefined ? null : { value: new TextEncoder().encode(raw) };
    },
  };
  const deps = {
    readShard: async () => SHARD,
    openBucket: async () => ({ kv, close: async () => undefined }),
    natsUrl: () => natsUrl,
    out: (line: string) => lines.push(line),
  } as unknown as CliDeps;
  return { lines, code: runCli(['skin', 'show', 'ag-jason-01'], deps) };
}

describe('skin show', () => {
  it('prints variant, host and signature length, never the value or the signature', async () => {
    const r = run({
      ag_jason_01: JSON.stringify({
        life_id: 'ag_jason_01',
        value: VALUE,
        signature: SIGNATURE,
        model: 'slim',
      }),
    });
    expect(await r.code).toBe(0);
    const printed = r.lines.join('\n');
    expect(printed).toContain('variant slim');
    expect(printed).toContain('texture host textures.minecraft.net');
    expect(printed).toContain(`signature length ${SIGNATURE.length}`);
    expect(printed).toContain('life_id matches');
    expect(printed).not.toContain(VALUE);
    expect(printed).not.toContain(SIGNATURE);
  });

  it('flags a record whose life_id differs from its key', async () => {
    const r = run({
      ag_jason_01: JSON.stringify({ life_id: 'other', value: VALUE, signature: SIGNATURE }),
    });
    expect(await r.code).toBe(0);
    expect(r.lines.join('\n')).toContain('DOES NOT MATCH');
  });

  it('fails with a fixed message when there is no record', async () => {
    const r = run({});
    expect(await r.code).toBe(1);
    expect(r.lines.join('\n')).toContain('no skin record for life ag_jason_01');
  });

  it('fails without echoing an unreadable record', async () => {
    const r = run({ ag_jason_01: 'not json SECRET' });
    expect(await r.code).toBe(1);
    expect(r.lines.join('\n')).toContain('unreadable');
    expect(r.lines.join('\n')).not.toContain('SECRET');
  });

  it('fails when GELDAR_NATS_URL is unset', async () => {
    const r = run({}, '');
    expect(await r.code).toBe(1);
    expect(r.lines.join('\n')).toContain('GELDAR_NATS_URL is not set');
  });
});
