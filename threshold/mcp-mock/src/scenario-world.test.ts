import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { loadTokens } from './auth.ts';
import { createScenarioWorld } from './scenario-world.ts';

const TOKEN = 'token-for-player-a-0123456789';

let dir: string;
let closeApp: (() => Promise<void>) | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-scenario-world-'));
});

afterEach(async () => {
  await closeApp?.();
  closeApp = undefined;
  rmSync(dir, { recursive: true, force: true });
});

// The in-process form of the CLI case that spawned node: the same world, the same MCP client, no child process.
describe('createScenarioWorld', () => {
  it('applies the timing overrides and writes suppressed wakeups as JSONL without text', async () => {
    const tokens = join(dir, 'tokens.json');
    writeFileSync(tokens, JSON.stringify({ aa: TOKEN }));
    // Left alone, 10 ticks a second (a 2400 s day) would put the chatter at 80 s and the spacing at 60 s.
    const scenario = join(dir, 'slow.scenario.json');
    writeFileSync(
      scenario,
      JSON.stringify({
        name: 'slow',
        day_length_seconds: 2400,
        character: { name: 'Kestrel', life_id: 'ag_kestrel_01', position: { x: 0, y: 64, z: 0 } },
        reflex: { hunger_interval_ticks: 10000000, eat_below: 14 },
        wake: { min_spacing_seconds: 60 },
        events: [
          { type: 'speech', at_tick: 800, from: 'Bram', to: null, text: 'secret chatter' },
          { type: 'speech', at_tick: 1500, from: 'Bram', to: 'Kestrel', text: 'first hello' },
          { type: 'speech', at_tick: 3500, from: 'Bram', to: 'Kestrel', text: 'second hello' },
        ],
      }),
    );
    const log = join(dir, 'suppressed.jsonl');
    const world = createScenarioWorld({
      scenarioPath: scenario,
      overrides: { dayLengthSeconds: 24, minWakeSpacingSeconds: 0.5 },
      suppressedLog: log,
      log: () => {},
    });
    const app = createApp({ tokens: loadTokens(tokens), world, log: () => {} });
    closeApp = () => app.close();
    const port = await app.listen(0, '127.0.0.1');
    expect(existsSync(log)).toBe(true);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/p/aa`), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      }),
    );
    const longIntent = {
      goal: 'walk',
      program: 'travel',
      arguments: { mock_ticks: 60000 },
      wake_on: ['directly_addressed', 'goal_completed'],
      limits: { max_world_ticks: 240000, max_block_operations: 10 },
    };
    await client.callTool({ name: 'act', arguments: { intent: longIntent } });
    const reasons: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = (await client.callTool({ name: 'wait', arguments: { max_seconds: 8 } })) as {
        content: { text: string }[];
      };
      reasons.push((JSON.parse(r.content[0]?.text ?? '{}') as { wake_reason: string }).wake_reason);
    }
    await client.close();
    expect(reasons).toEqual(['directly_addressed', 'directly_addressed']);
    const lines = readFileSync(log, 'utf8')
      .split('\n')
      .filter((l) => l !== '');
    const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(typeof r.reason).toBe('string');
      expect(typeof r.kind).toBe('string');
      expect(r).not.toHaveProperty('text');
    }
    expect(records.some((r) => r.reason === 'overheard_chatter')).toBe(true);
    expect(records.some((r) => r.reason === 'min_spacing')).toBe(false);
    expect(lines.join('\n')).not.toContain('secret chatter');
  }, 60_000);
});
