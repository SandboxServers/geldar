import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SHARD_FILE, shardFileFrom } from './cli.ts';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A real file to name in GELDAR_SHARD_FILE. */
async function shardPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-tokens-shard-file-'));
  dirs.push(dir);
  const file = join(dir, 'colo.yaml');
  await writeFile(file, 'shard: colo\n');
  return file;
}

describe('shardFileFrom', () => {
  it('defaults to shards/phase0.yaml when GELDAR_SHARD_FILE is unset', () => {
    expect(shardFileFrom({})).toBe(SHARD_FILE);
    expect(SHARD_FILE.endsWith(join('shards', 'phase0.yaml'))).toBe(true);
  });

  it('treats an empty GELDAR_SHARD_FILE as unset', () => {
    expect(shardFileFrom({ GELDAR_SHARD_FILE: '' })).toBe(SHARD_FILE);
  });

  it('uses the file GELDAR_SHARD_FILE names', async () => {
    const file = await shardPath();
    expect(shardFileFrom({ GELDAR_SHARD_FILE: file })).toBe(resolve(file));
    expect(shardFileFrom({ GELDAR_SHARD_FILE: file })).not.toBe(SHARD_FILE);
  });

  it('refuses a named path that does not exist, and names the variable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-tokens-shard-file-'));
    dirs.push(dir);
    const missing = join(dir, 'absent.yaml');
    expect(() => shardFileFrom({ GELDAR_SHARD_FILE: missing })).toThrow(
      `GELDAR_SHARD_FILE names ${missing}, which does not exist`,
    );
  });
});
