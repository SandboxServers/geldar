import { defineConfig } from 'vitest/config';

// One test run for the whole workspace: `pnpm test` from the root.
export default defineConfig({
  test: {
    include: ['**/src/**/*.test.ts', '**/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/worktrees/**'],
  },
});
