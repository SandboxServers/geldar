import { defineConfig } from 'vitest/config';

// One test run for the whole workspace: `pnpm test` from the root. Live tests need a running
// shard, so they run only through their own config (golem/vitest.live.config.ts).
export default defineConfig({
  test: {
    include: ['**/src/**/*.test.ts', '**/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/worktrees/**', '**/*.live.test.ts'],
  },
});
