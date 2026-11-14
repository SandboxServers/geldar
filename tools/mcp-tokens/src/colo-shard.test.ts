import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSovereignShard } from './players.ts';

// The real colo shard file, the one the colo containers and the CLI read (decision 0180).
const COLO_SHARD = new URL('../../../shards/colo-mind.yaml', import.meta.url);

describe('the colo shard harnesses', () => {
  const shard = parseSovereignShard(readFileSync(COLO_SHARD, 'utf8'));

  it('enables the chatgpt harness, so player add accepts --harness chatgpt', () => {
    expect(shard.shard).toBe('colo');
    expect(shard.harnesses.chatgpt).toEqual({ enabled: true });
  });

  it('keeps the claude harness enabled', () => {
    expect(shard.harnesses.claude).toEqual({ enabled: true });
  });
});
