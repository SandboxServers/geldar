import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The hard no-agent-path test (BLD-37, decision 0429). Plan data is for humans on Glass. Nothing an agent
 * reads may name the plan-activity panel, its model, or the plan-progress view of it, and the panel may not
 * reach into agent code. The repo fence (tools/repo-checks plan-activity-fence) covers imports and the feed
 * subject; this test covers the names and the one-way dependency from inside the Glass package.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const AGENT_ROOTS = ['threshold/mcp/src', 'animus/src', 'player-core/src', 'golem/src'];
const PANEL_FILES = ['index.ts', 'model.ts'];
const PANEL_NAMES = /plan-activity|PlanActivity|planActivity|toPlanActivityRow/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('the plan-activity panel has no path into agent code (BLD-37, decision 0429)', () => {
  it('agent-facing source never names the panel, its model or its row builder', () => {
    const hits: string[] = [];
    for (const root of AGENT_ROOTS) {
      const dir = join(ROOT, root);
      if (!existsSync(dir)) continue;
      for (const file of sourceFiles(dir)) {
        if (PANEL_NAMES.test(readFileSync(file, 'utf8'))) hits.push(file);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the panel imports nothing from agent packages or the Glass server', () => {
    const forbidden = /from '(\.\.\/)*(threshold|animus|player-core|golem)\//;
    for (const name of PANEL_FILES) {
      const src = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
      expect(src, name).not.toMatch(forbidden);
      expect(src, name).not.toMatch(/from '\.\.\/(kino|server|routes|query|sse)/);
    }
  });

  it('a fixture of an agent role is refused: the panel reads no feed of its own', () => {
    // The panel has no fetch, WebSocket or EventSource: its only input is the rows the page hands it.
    for (const name of PANEL_FILES) {
      const src = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
      expect(src, name).not.toMatch(/\bfetch\(|WebSocket|EventSource|\.feed\b/);
    }
  });
});
