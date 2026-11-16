import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type ErasureKvs,
  type KvPort,
  parseArgs,
  parseLivesFile,
  REGISTRY_BUCKET_NAME,
  runErasure,
  SKIN_BUCKET_NAME,
} from './erase-owner.ts';

const OWNER = 'owner-7731';
const LIVES = [
  { lifeId: 'life-a1', username: 'Ranger_One' },
  { lifeId: 'life-b2', username: 'ranger_two' },
];

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

  it('is a no-op on a second run: nothing is found and nothing is purged', async () => {
    const { kvs, skins } = fakeKvs(['life-a1'], ['ranger_one']);
    await runErasure({ ownerId: OWNER, lives: LIVES, execute: true, confirm: OWNER }, kvs);
    skins.calls.length = 0;
    const again = await runErasure(
      { ownerId: OWNER, lives: LIVES, execute: true, confirm: OWNER },
      kvs,
    );
    expect(again.status).toBe('purged');
    expect(again.skins).toEqual({ found: 0, purged: 0 });
    expect(skins.calls.some((c) => c.startsWith('purge:'))).toBe(false);
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
