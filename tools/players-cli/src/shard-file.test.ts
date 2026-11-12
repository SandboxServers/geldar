import { describe, expect, it } from 'vitest';
import { REPO_ROOT, shardFilePath } from './cli.ts';

describe('shardFilePath', () => {
  it('uses GELDAR_SHARD_FILE when set (the Colo roster in the admin image)', () => {
    expect(shardFilePath({ GELDAR_SHARD_FILE: '/opt/geldar/shards/colo.yaml' })).toBe(
      '/opt/geldar/shards/colo.yaml',
    );
  });

  it('falls back to shards/phase0.yaml when unset or blank', () => {
    const fallback = shardFilePath({});
    expect(fallback.replace(/\\/g, '/')).toBe(
      `${REPO_ROOT.replace(/\\/g, '/')}/shards/phase0.yaml`,
    );
    expect(shardFilePath({ GELDAR_SHARD_FILE: '  ' })).toBe(fallback);
  });
});
