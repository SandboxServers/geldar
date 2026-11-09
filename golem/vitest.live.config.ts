import { defineConfig } from 'vitest/config';

// The live lane: tests that need the running shard (`./geldar.ps1 shard up phase0`).
// One shared world, so files run one after another; the root config excludes these files.
export default defineConfig({
  test: {
    include: ['test/live/**/*.live.test.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});
