/**
 * BLD-19 fence (decision 0429): the reverse of the seen fence. No agent-facing module reads Glass plan activity.
 * The agent-facing roots are the MCP tools (`threshold/mcp`), `animus`, `golem` (the snapshot and wake text)
 * and `player-core`. Each must not name the plan-activity module, import a Glass `kino` module, or spell the
 * Glass feed subject (`geldar.<shard>.kino.<agent>.feed`). Every `.ts` file under those roots counts, tests too.
 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsFilesUnder } from './seen-fence.ts';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Repo-relative, forward slashes. */
export const AGENT_ROOTS = ['animus', 'golem', 'player-core', 'threshold/mcp'];

/** Each pattern names one way an agent-facing file could reach Glass plan activity or the Glass feed. */
const FORBIDDEN: Array<{ why: string; pattern: RegExp }> = [
  { why: 'plan-activity module', pattern: /plan-activity/ },
  {
    why: 'Glass kino module import',
    pattern: /glass\/src\/kino\b|kino\/(nats-feed|control|scope)\b/,
  },
  { why: 'Glass feed subject', pattern: /\.kino\.[^'"`\s]*feed/ },
];

/** One `label:line: why: text` entry per forbidden line of `source`. */
export function scanPlanActivityReferences(label: string, source: string): string[] {
  const hits: string[] = [];
  source.split('\n').forEach((line, index) => {
    for (const { why, pattern } of FORBIDDEN) {
      if (pattern.test(line)) hits.push(`${label}:${index + 1}: ${why}: ${line.trim()}`);
    }
  });
  return hits;
}

/**
 * NATS ACL tests that name the Glass feed subject as data: the permission matrix asserts that only the kino
 * role may subscribe to it (`kinoFeed`), and that other roles are denied. They grant no read to an agent.
 * The allowance is exact: one more feed-subject line in this file fails the fence.
 */
export const FEED_SUBJECT_ACL_TESTS: Record<string, number> = {
  'threshold/mcp/test/nats-auth.it.test.ts': 3,
};

/** Scans every agent-facing root under `root`; returns the hits and how many files were read per root. */
export function planActivityFenceReport(root: string = ROOT): {
  hits: string[];
  files: Record<string, number>;
} {
  const hits: string[] = [];
  const files: Record<string, number> = {};
  for (const top of AGENT_ROOTS) {
    const paths = tsFilesUnder(join(root, top));
    files[top] = paths.length;
    for (const path of paths) {
      const label = relative(root, path).split('\\').join('/');
      const found = scanPlanActivityReferences(label, readFileSync(path, 'utf8'));
      const allowed = FEED_SUBJECT_ACL_TESTS[label];
      const feedHits = found.filter((hit) => hit.includes('Glass feed subject'));
      const exempt = allowed !== undefined && feedHits.length === allowed;
      hits.push(...(exempt ? found.filter((hit) => !hit.includes('Glass feed subject')) : found));
    }
  }
  return { hits, files };
}
