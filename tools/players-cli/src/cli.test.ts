import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CliDeps, runCli } from './cli.ts';
import type { SignedTexture } from './mineskin.ts';
import { makeSkinPng } from './skin-fixture.ts';
import type { SkinKv } from './skin-store.ts';

const SHARD = `sovereign:\n  players:\n    - { player_id: ag-jason-01, life_id: ag_jason_01, name: Jason }\n`;
const REPO = join(process.cwd(), 'fixture-repo');
const KEY = `msk_${'K'.repeat(24)}`;
const TEXTURE: SignedTexture = { value: 'dmFsdWU=', signature: 'c2lnbg==', model: 'classic' };
const PNG_BYTES = makeSkinPng();

interface Fakes {
  deps: CliDeps;
  lines: string[];
  uploads: Array<{ model: string; key: string }>;
  stored: Array<{ key: string; value: string }>;
  buckets: string[];
  readonly closed: number;
}

/** Fakes for every side effect; a test overrides the one it needs. */
function fakes(overrides: Partial<CliDeps> = {}): Fakes {
  const lines: string[] = [];
  const uploads: Array<{ model: string; key: string }> = [];
  const stored: Array<{ key: string; value: string }> = [];
  const buckets: string[] = [];
  const state = { closed: 0 };
  const kv: SkinKv = {
    put: async (key, value) => {
      stored.push({ key, value: new TextDecoder().decode(value) });
      return 1;
    },
  };
  const deps: CliDeps = {
    readShard: async () => SHARD,
    readSkin: async () => PNG_BYTES,
    readKey: async () => KEY,
    upload: async (_png, model, apiKey) => {
      uploads.push({ model, key: apiKey });
      return { ...TEXTURE, model: model as 'classic' | 'slim' };
    },
    openBucket: async (url) => {
      buckets.push(url);
      return { kv, close: async () => void state.closed++ };
    },
    natsUrl: () => 'nats://127.0.0.1:4222',
    now: () => new Date('2026-11-09T00:00:00Z'),
    repoRoot: REPO,
    out: (line) => lines.push(line),
    ...overrides,
  };
  return {
    deps,
    lines,
    uploads,
    stored,
    buckets,
    get closed() {
      return state.closed;
    },
  } as Fakes;
}

describe('skin set', () => {
  it('signs the skin and stores it under the registered life id only', async () => {
    const f = fakes();
    const code = await runCli(
      ['skin', 'set', 'ag-jason-01', join(REPO, 'skins', 'jason.png'), '--model', 'slim'],
      f.deps,
    );
    expect(code).toBe(0);
    expect(f.uploads).toEqual([{ model: 'slim', key: KEY }]);
    expect(f.stored).toHaveLength(1);
    expect(f.stored[0]?.key).toBe('ag_jason_01');
    expect(JSON.parse(f.stored[0]?.value ?? '{}')).toMatchObject({
      life_id: 'ag_jason_01',
      model: 'slim',
    });
    expect(f.buckets).toEqual(['nats://127.0.0.1:4222']);
    expect(f.closed).toBe(1);
  });

  it('never prints the key, the texture value or the signature', async () => {
    const f = fakes();
    await runCli(['skin', 'set', 'ag-jason-01', join(REPO, 'skins', 'jason.png')], f.deps);
    const printed = f.lines.join('\n');
    expect(printed).not.toContain(KEY);
    expect(printed).not.toContain(TEXTURE.value);
    expect(printed).not.toContain(TEXTURE.signature);
  });

  it('with --check-only validates the PNG and uploads nothing', async () => {
    const f = fakes({ readSkin: async () => Buffer.from('not a png') });
    const code = await runCli(
      ['skin', 'set', 'ag-jason-01', join(REPO, 'skins', 'a.png'), '--check-only'],
      f.deps,
    );
    expect(code).toBe(1);
    expect(f.lines.join('\n')).toContain('not a PNG');
    expect(f.uploads).toHaveLength(0);
  });

  it('refuses a player that is not in the shard config before reading any file', async () => {
    let read = false;
    const f = fakes({
      readSkin: async () => {
        read = true;
        return PNG_BYTES;
      },
    });
    const code = await runCli(['skin', 'set', 'ag-zack-01', join(REPO, 'skins', 'z.png')], f.deps);
    expect(code).toBe(1);
    expect(read).toBe(false);
    expect(f.lines[0]).toContain('no sovereign player ag-zack-01');
  });

  it('refuses a skin inside the repo outside skins/, and uploads nothing', async () => {
    const f = fakes();
    const code = await runCli(['skin', 'set', 'ag-jason-01', join(REPO, 'docs', 'j.png')], f.deps);
    expect(code).toBe(1);
    expect(f.uploads).toHaveLength(0);
  });

  it('stores nothing when GELDAR_NATS_URL is unset, and says so', async () => {
    const f = fakes({ natsUrl: () => undefined });
    const code = await runCli(['skin', 'set', 'ag-jason-01', join(REPO, 'skins', 'j.png')], f.deps);
    expect(code).toBe(1);
    expect(f.buckets).toHaveLength(0);
    expect(f.lines[0]).toContain('GELDAR_NATS_URL is not set');
  });

  it('checks NATS before any MineSkin upload, so an unset URL spends no generation', async () => {
    const f = fakes({ natsUrl: () => undefined });
    const code = await runCli(['skin', 'set', 'ag-jason-01', join(REPO, 'skins', 'j.png')], f.deps);
    expect(code).toBe(1);
    expect(f.uploads).toHaveLength(0);
  });

  it('does not upload when the bucket cannot be opened', async () => {
    const f = fakes({
      openBucket: async () => {
        throw new Error('no connection');
      },
    });
    const code = await runCli(['skin', 'set', 'ag-jason-01', join(REPO, 'skins', 'j.png')], f.deps);
    expect(code).toBe(1);
    expect(f.uploads).toHaveLength(0);
  });

  it('reports a missing key file with a fixed message', async () => {
    const f = fakes({
      readKey: async () => {
        throw new Error('ENOENT');
      },
    });
    const code = await runCli(['skin', 'set', 'ag-jason-01', join(REPO, 'skins', 'j.png')], f.deps);
    expect(code).toBe(1);
    expect(f.lines[0]).toBe('error: the command failed; see the README for the steps');
  });

  it('prints usage for any other command', async () => {
    const f = fakes();
    expect(await runCli(['skin', 'list'], f.deps)).toBe(2);
    expect(await runCli(['skin', 'set', 'ag-jason-01', 'x.png', '--model', 'huge'], f.deps)).toBe(
      2,
    );
    expect(f.lines[0]).toContain('usage: players-cli skin set');
  });
});
