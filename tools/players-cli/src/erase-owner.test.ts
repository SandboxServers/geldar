import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KV } from '@nats-io/kv';
import { describe, expect, it, vi } from 'vitest';
import {
  asPort,
  type ErasureKvs,
  exitCodeFor,
  type KvPort,
  main,
  parseArgs,
  parseLivesFile,
  REGISTRY_BUCKET_NAME,
  refusalFor,
  runErasure,
  SKIN_BUCKET_NAME,
} from './erase-owner.ts';

const OWNER = 'owner-7731';
const LIVES = [
  { lifeId: 'life-a1', username: 'Ranger_One' },
  { lifeId: 'life-b2', username: 'ranger_two' },
];

/** A fake KV that keeps a PURGE marker after a purge, as NATS does: kv.get returns the marker, not null. */
function markerKv(initial: string[]) {
  const entries = new Map<string, { operation: string; value: Uint8Array }>();
  for (const key of initial) entries.set(key, { operation: 'PUT', value: new Uint8Array([1]) });
  const purges: string[] = [];
  const kv = {
    async get(key: string) {
      return entries.get(key) ?? null;
    },
    async purge(key: string) {
      purges.push(key);
      entries.set(key, { operation: 'PURGE', value: new Uint8Array() });
    },
  } as unknown as KV;
  return { kv, purges };
}

/** A fake KV bucket: `data` holds the keys that exist; `calls` records every read and purge. */
function fakeBucket(initial: string[], failOn?: { op: 'get' | 'purge'; key: string }) {
  const data = new Set(initial);
  const calls: string[] = [];
  const port: KvPort = {
    async get(key) {
      calls.push(`get:${key}`);
      if (failOn?.op === 'get' && failOn.key === key) throw new Error(`boom on ${key}`);
      return data.has(key) ? { value: new TextEncoder().encode('{"value":"x"}') } : null;
    },
    async purge(key) {
      calls.push(`purge:${key}`);
      if (failOn?.op === 'purge' && failOn.key === key) throw new Error(`boom on ${key}`);
      data.delete(key);
    },
  };
  return { port, data, calls };
}

function fakeKvs(
  skinKeys: string[],
  registryKeys: string[],
  failOn?: { op: 'get' | 'purge'; key: string },
) {
  const skins = fakeBucket(skinKeys, failOn);
  const registry = fakeBucket(registryKeys, failOn);
  const kvs: ErasureKvs = { skins: skins.port, registry: registry.port };
  return { kvs, skins, registry };
}

describe('parseArgs', () => {
  it('is a dry run by default: no --execute means execute is false', () => {
    const args = parseArgs(['--owner', OWNER, '--lives', 'lives.json']);
    expect(args.execute).toBe(false);
    expect(args.confirm).toBeUndefined();
  });

  it('reads --execute and --confirm only when they are given', () => {
    const args = parseArgs([
      '--owner',
      OWNER,
      '--lives',
      'lives.json',
      '--execute',
      '--confirm',
      OWNER,
    ]);
    expect(args.execute).toBe(true);
    expect(args.confirm).toBe(OWNER);
  });

  it('refuses an unknown flag and a flag with no value', () => {
    expect(() => parseArgs(['--owner', OWNER, '--lives', 'l.json', '--force'])).toThrow();
    expect(() => parseArgs(['--owner', OWNER, '--lives'])).toThrow();
    expect(() => parseArgs(['--lives', 'l.json'])).toThrow();
  });
});

describe('parseLivesFile', () => {
  it('reads a list of lives and lowercases usernames', () => {
    const lives = parseLivesFile(JSON.stringify(LIVES));
    expect(lives).toEqual([
      { lifeId: 'life-a1', username: 'ranger_one' },
      { lifeId: 'life-b2', username: 'ranger_two' },
    ]);
  });

  it('fails closed on bad JSON, a non-array, an empty list, a missing field and a bad username', () => {
    expect(() => parseLivesFile('{not json')).toThrow();
    expect(() => parseLivesFile('{"lifeId":"life-a1","username":"ranger"}')).toThrow();
    expect(() => parseLivesFile('[]')).toThrow();
    expect(() => parseLivesFile('[{"username":"ranger"}]')).toThrow();
    expect(() => parseLivesFile('[{"lifeId":"life-a1","username":"not a username!"}]')).toThrow();
  });
});

describe('runErasure dry run', () => {
  it('reads both buckets, purges nothing and reports the counts', async () => {
    const { kvs, skins, registry } = fakeKvs(['life-a1'], ['ranger_one', 'ranger_two']);
    const outcome = await runErasure(
      { ownerId: OWNER, lives: LIVES, execute: false, confirm: undefined },
      kvs,
    );
    expect(outcome.status).toBe('dry-run');
    expect(outcome.skins).toEqual({ found: 1, purged: 0 });
    expect(outcome.registry).toEqual({ found: 2, purged: 0 });
    expect(skins.calls.some((c) => c.startsWith('purge:'))).toBe(false);
    expect(registry.calls.some((c) => c.startsWith('purge:'))).toBe(false);
    expect(skins.data.has('life-a1')).toBe(true);
    expect(registry.data.has('ranger_one')).toBe(true);
  });

  it('ignores a confirm value in a dry run and still purges nothing', async () => {
    const { kvs, skins } = fakeKvs(['life-a1'], []);
    const outcome = await runErasure(
      { ownerId: OWNER, lives: LIVES, execute: false, confirm: OWNER },
      kvs,
    );
    expect(outcome.status).toBe('dry-run');
    expect(skins.calls.some((c) => c.startsWith('purge:'))).toBe(false);
  });
});

describe('runErasure execute', () => {
  it('purges only the keys that exist, in both buckets', async () => {
    const { kvs, skins, registry } = fakeKvs(['life-a1'], ['ranger_one']);
    const outcome = await runErasure(
      { ownerId: OWNER, lives: LIVES, execute: true, confirm: OWNER },
      kvs,
    );
    expect(outcome.status).toBe('purged');
    expect(skins.calls).toContain('purge:life-a1');
    expect(skins.calls).not.toContain('purge:life-b2');
    expect(registry.calls).toContain('purge:ranger_one');
    expect(registry.calls).not.toContain('purge:ranger_two');
    expect(skins.data.size).toBe(0);
    expect(registry.data.size).toBe(0);
    expect(outcome.skins).toEqual({ found: 1, purged: 1 });
    expect(outcome.registry).toEqual({ found: 1, purged: 1 });
  });

  it('refuses execute with no confirm, before any read', async () => {
    const { kvs, skins, registry } = fakeKvs(['life-a1'], ['ranger_one']);
    const outcome = await runErasure(
      { ownerId: OWNER, lives: LIVES, execute: true, confirm: undefined },
      kvs,
    );
    expect(outcome.status).toBe('refused');
    expect(skins.calls).toEqual([]);
    expect(registry.calls).toEqual([]);
    expect(skins.data.has('life-a1')).toBe(true);
  });

  it('refuses a confirm that does not name this owner, including another life id', async () => {
    const wrong = fakeKvs(['life-a1'], ['ranger_one']);
    const outcome = await runErasure(
      { ownerId: OWNER, lives: LIVES, execute: true, confirm: 'owner-0000' },
      wrong.kvs,
    );
    expect(outcome.status).toBe('refused');
    expect(wrong.skins.calls).toEqual([]);
    const lifeAsConfirm = fakeKvs(['life-a1'], []);
    const refused = await runErasure(
      { ownerId: OWNER, lives: LIVES, execute: true, confirm: 'life-a1' },
      lifeAsConfirm.kvs,
    );
    expect(refused.status).toBe('refused');
    expect(lifeAsConfirm.skins.calls).toEqual([]);
  });

  it('is a no-op on a second run: a purge marker reads as absent, so nothing is found or purged', async () => {
    const skinKv = markerKv(['life-a1']);
    const registryKv = markerKv(['ranger_one']);
    const kvs: ErasureKvs = { skins: asPort(skinKv.kv), registry: asPort(registryKv.kv) };
    const request = { ownerId: OWNER, lives: LIVES, execute: true, confirm: OWNER };
    const first = await runErasure(request, kvs);
    expect(first.status).toBe('purged');
    expect(skinKv.purges).toEqual(['life-a1']);
    expect(registryKv.purges).toEqual(['ranger_one']);
    const dry = await runErasure({ ...request, execute: false }, kvs);
    expect(dry.skins).toEqual({ found: 0, purged: 0 });
    expect(dry.registry).toEqual({ found: 0, purged: 0 });
    const again = await runErasure(request, kvs);
    expect(again.status).toBe('purged');
    expect(again.skins).toEqual({ found: 0, purged: 0 });
    expect(again.registry).toEqual({ found: 0, purged: 0 });
    expect(skinKv.purges).toEqual(['life-a1']);
    expect(registryKv.purges).toEqual(['ranger_one']);
  });

  it('refuses a confirm that is a prefix, an extension, a case change or empty, before any read', async () => {
    for (const confirm of ['owner-773', `${OWNER}x`, OWNER.toUpperCase(), '']) {
      const { kvs, skins, registry } = fakeKvs(['life-a1'], ['ranger_one']);
      const outcome = await runErasure(
        { ownerId: OWNER, lives: LIVES, execute: true, confirm },
        kvs,
      );
      expect(outcome.status, `confirm "${confirm}"`).toBe('refused');
      expect(skins.calls).toEqual([]);
      expect(registry.calls).toEqual([]);
    }
  });

  it('stops at a purge error, reports it with a fixed message, and a re-run finishes the rest', async () => {
    const { kvs, registry } = fakeKvs(['life-a1'], ['ranger_one', 'ranger_two'], {
      op: 'purge',
      key: 'ranger_two',
    });
    const failed = await runErasure(
      { ownerId: OWNER, lives: LIVES, execute: true, confirm: OWNER },
      kvs,
    );
    expect(failed.status).toBe('failed');
    expect(failed.reason).toBe('a purge failed; run again to finish');
    expect(failed.registry.purged).toBe(1);
    expect(registry.data.has('ranger_two')).toBe(true);
    const retry = fakeKvs([], ['ranger_two']);
    const done = await runErasure(
      { ownerId: OWNER, lives: LIVES, execute: true, confirm: OWNER },
      retry.kvs,
    );
    expect(done.status).toBe('purged');
    expect(retry.registry.data.size).toBe(0);
  });

  it('fails with no purge when a read fails in a dry run', async () => {
    const { kvs, skins } = fakeKvs(['life-a1'], [], { op: 'get', key: 'life-a1' });
    const outcome = await runErasure(
      { ownerId: OWNER, lives: LIVES, execute: false, confirm: undefined },
      kvs,
    );
    expect(outcome.status).toBe('failed');
    expect(skins.calls.some((c) => c.startsWith('purge:'))).toBe(false);
  });

  it('dedupes repeated lives so each key is read and purged once', async () => {
    const { kvs, skins } = fakeKvs(['life-a1'], []);
    const dup = [
      { lifeId: 'life-a1', username: 'Ranger_One' },
      { lifeId: 'life-a1', username: 'Ranger_One' },
      { lifeId: 'life-a1', username: 'RANGER_ONE' },
    ];
    const outcome = await runErasure(
      { ownerId: OWNER, lives: dup, execute: true, confirm: OWNER },
      kvs,
    );
    expect(outcome.status).toBe('purged');
    expect(skins.calls.filter((c) => c === 'purge:life-a1')).toHaveLength(1);
  });

  it('keeps every life id, owner id and username out of the output lines', async () => {
    const { kvs } = fakeKvs(['life-a1'], ['ranger_one'], { op: 'purge', key: 'ranger_two' });
    const outcome = await runErasure(
      { ownerId: OWNER, lives: LIVES, execute: true, confirm: OWNER },
      kvs,
    );
    const text = outcome.lines.join('\n');
    for (const secret of [OWNER, 'life-a1', 'life-b2', 'ranger_one', 'ranger_two', 'Ranger_One']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('web reachability', () => {
  it('no web or service source file names the erasure script', () => {
    const roots = ['../../../threshold/register/src', '../../../glass/src', '../../../golem/src'];
    const offenders: string[] = [];
    for (const root of roots) {
      const dir = fileURLToPath(new URL(root, import.meta.url));
      for (const name of readdirSync(dir, { recursive: true }) as string[]) {
        if (!/\.(ts|js|mjs)$/.test(name)) continue;
        const path = join(dir, name);
        if (readFileSync(path, 'utf8').includes('erase-owner')) offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('runErasure refusals', () => {
  it('refuses an empty list and an empty owner id without touching a bucket', async () => {
    const { kvs, skins } = fakeKvs(['life-a1'], []);
    expect(
      (await runErasure({ ownerId: OWNER, lives: [], execute: false, confirm: undefined }, kvs))
        .status,
    ).toBe('refused');
    expect(
      (await runErasure({ ownerId: '', lives: LIVES, execute: false, confirm: undefined }, kvs))
        .status,
    ).toBe('refused');
    expect(skins.calls).toEqual([]);
  });

  it('names the bucket constants the operator sees', () => {
    expect(SKIN_BUCKET_NAME).toBe('geldar-skins');
    expect(REGISTRY_BUCKET_NAME).toBe('geldar-life-registry');
  });
});

describe('asPort', () => {
  it('reads a live entry as present, and a DEL, a PURGE or a missing key as absent', async () => {
    const entries: Record<string, { operation: string; value: Uint8Array }> = {
      live: { operation: 'PUT', value: new Uint8Array([1]) },
      deleted: { operation: 'DEL', value: new Uint8Array() },
      purged: { operation: 'PURGE', value: new Uint8Array() },
    };
    const kv = {
      async get(key: string) {
        return entries[key] ?? null;
      },
    } as unknown as KV;
    const port = asPort(kv);
    expect(await port.get('live')).not.toBeNull();
    expect(await port.get('deleted')).toBeNull();
    expect(await port.get('purged')).toBeNull();
    expect(await port.get('missing')).toBeNull();
  });
});

describe('malformed lives', () => {
  it('refuses a life id or username the keys cannot hold, and runErasure reads nothing', async () => {
    const bad = [
      { lifeId: '*', username: 'ranger' },
      { lifeId: 'a.b', username: 'ranger' },
      { lifeId: '', username: 'ranger' },
      { lifeId: 'life-a1', username: '' },
      { lifeId: 'life-a1', username: 'a'.repeat(17) },
      { lifeId: 'life-a1', username: 'ranger>' },
    ];
    for (const life of bad) {
      const request = { ownerId: OWNER, lives: [life], execute: false, confirm: undefined };
      expect(refusalFor(request), JSON.stringify(life)).toBeDefined();
    }
    const { kvs, skins, registry } = fakeKvs(['life-a1'], ['ranger']);
    const outcome = await runErasure(
      {
        ownerId: OWNER,
        lives: [{ lifeId: '*', username: 'ranger' }],
        execute: false,
        confirm: undefined,
      },
      kvs,
    );
    expect(outcome.status).toBe('refused');
    expect(skins.calls).toEqual([]);
    expect(registry.calls).toEqual([]);
  });

  it('parseLivesFile rejects a wildcard, a dotted id, an empty id, an empty or 17-character username', () => {
    for (const lifeId of ['*', '>', 'a.b', '']) {
      expect(() => parseLivesFile(JSON.stringify([{ lifeId, username: 'ranger' }]))).toThrow();
    }
    expect(() => parseLivesFile(JSON.stringify([{ lifeId: 'life-a1', username: '' }]))).toThrow();
    expect(() =>
      parseLivesFile(JSON.stringify([{ lifeId: 'life-a1', username: 'a'.repeat(17) }])),
    ).toThrow();
  });
});

describe('exit codes, and main refuses before any NATS connect', () => {
  it('maps a dry run and a purge to 0, and a failed or refused run to 1', () => {
    expect(exitCodeFor('dry-run')).toBe(0);
    expect(exitCodeFor('purged')).toBe(0);
    expect(exitCodeFor('failed')).toBe(1);
    expect(exitCodeFor('refused')).toBe(1);
  });

  it('main exits 2 for a bad confirm, a missing NATS URL and a missing lives file, with no bucket touched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'erase-owner-test-'));
    const lives = join(dir, 'lives.json');
    writeFileSync(lives, JSON.stringify(LIVES));
    const savedUrl = process.env.GELDAR_NATS_URL;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // A closed loopback port: without main's refusal the run would reach openErasureKvs and return 1.
      process.env.GELDAR_NATS_URL = 'nats://127.0.0.1:1';
      expect(
        await main(['--owner', OWNER, '--lives', lives, '--execute', '--confirm', 'owner-773']),
      ).toBe(2);
      delete process.env.GELDAR_NATS_URL;
      expect(await main(['--owner', OWNER, '--lives', lives])).toBe(2);
      expect(await main(['--owner', OWNER, '--lives', join(dir, 'absent.json')])).toBe(2);
    } finally {
      errors.mockRestore();
      if (savedUrl !== undefined) process.env.GELDAR_NATS_URL = savedUrl;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('source guards', () => {
  it('opens both buckets with open(), never create()', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./erase-owner.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('kvm.open(SKIN_BUCKET_NAME)');
    expect(source).toContain('kvm.open(REGISTRY_BUCKET_NAME)');
    expect(source).not.toContain('kvm.create(');
  });
});
