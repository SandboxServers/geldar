import { describe, expect, it } from 'vitest';
import { type CliDeps, runCli } from './cli.ts';

const SHARD = `sovereign:\n  players:\n    - { player_id: ag-jason-01, life_id: ag_jason_01, name: Jason }\n`;
const goodValue = Buffer.from(
  JSON.stringify({ textures: { SKIN: { url: 'https://textures.minecraft.net/texture/abc123' } } }),
).toString('base64');
const evilValue = Buffer.from(
  JSON.stringify({ textures: { SKIN: { url: 'https://evil.example/texture/abc123' } } }),
).toString('base64');
const SIG = Buffer.from('signature').toString('base64');

function setup(file: unknown, natsUrl = 'nats://127.0.0.1:4222') {
  const lines: string[] = [];
  const stored: Array<{ key: string; value: string }> = [];
  let closed = 0;
  const deps: CliDeps = {
    readShard: async () => SHARD,
    readSkin: async () => Buffer.alloc(0),
    readKey: async () => {
      throw new Error('the import must not read the MineSkin key');
    },
    upload: async () => {
      throw new Error('the import must not upload');
    },
    readJson: async () => (typeof file === 'string' ? file : JSON.stringify(file)),
    openBucket: async () => ({
      kv: {
        put: async (key, value) => {
          stored.push({ key, value: new TextDecoder().decode(value) });
          return 1;
        },
      },
      close: async () => void closed++,
    }),
    natsUrl: () => natsUrl,
    now: () => new Date('2026-11-11T00:00:00Z'),
    repoRoot: process.cwd(),
    out: (line) => lines.push(line),
  };
  return { deps, lines, stored, closed: () => closed };
}

describe('skin import', () => {
  it('stores the signed texture under the life id without uploading', async () => {
    const s = setup({ 'ag-jason-01': { value: goodValue, signature: SIG, model: 'slim' } });
    expect(await runCli(['skin', 'import', 'ag-jason-01', '/x/skins.json'], s.deps)).toBe(0);
    expect(s.stored.map((r) => r.key)).toEqual(['ag_jason_01']);
    expect(JSON.parse(s.stored[0]?.value ?? '{}')).toMatchObject({ model: 'slim' });
    expect(s.closed()).toBe(1);
    expect(s.lines.join('\n')).not.toContain(goodValue);
  });

  it('refuses a texture that is not on the Mojang texture host, and stores nothing', async () => {
    const s = setup({ 'ag-jason-01': { value: evilValue, signature: SIG } });
    expect(await runCli(['skin', 'import', 'ag-jason-01', '/x/skins.json'], s.deps)).toBe(1);
    expect(s.stored).toEqual([]);
  });

  it('refuses a player with no entry, bad JSON and an unset NATS URL', async () => {
    expect(await runCli(['skin', 'import', 'ag-jason-01', '/x'], setup({}).deps)).toBe(1);
    expect(await runCli(['skin', 'import', 'ag-jason-01', '/x'], setup('{nope').deps)).toBe(1);
    const noNats = setup({ 'ag-jason-01': { value: goodValue, signature: SIG } }, '');
    expect(await runCli(['skin', 'import', 'ag-jason-01', '/x'], noNats.deps)).toBe(1);
    expect(noNats.stored).toEqual([]);
  });
});
