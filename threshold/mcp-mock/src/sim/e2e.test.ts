import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateToolResult } from '@geldar/contract';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { loadTokens } from '../auth.ts';
import type { MockHttp } from '../server.ts';
import { applyOverrides, parseScenario, type Scenario } from './scenario.ts';
import { createSimWorld } from './sim-world.ts';

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKEN = 'token-for-player-a-0123456789';
const PLAYER = 'aa';
const WAIT_OPTIONS = { timeout: 260_000 };

let dir: string;
let http: MockHttp | undefined;
let client: Client | undefined;
let child: ChildProcess | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-e2e-'));
});

afterEach(async () => {
  await client?.close().catch(() => undefined);
  client = undefined;
  await http?.close();
  http = undefined;
  if (child !== undefined && child.exitCode === null && child.signalCode === null) {
    const closed = new Promise<void>((resolve) => child?.once('close', () => resolve()));
    child.kill();
    await closed;
  }
  child = undefined;
  rmSync(dir, { recursive: true, force: true });
}, 10_000);

// Day length 24 s gives 1000 ticks a second.
function scenarioOf(over: Record<string, unknown> = {}): Scenario {
  return parseScenario(
    JSON.stringify({
      name: 'e2e',
      day_length_seconds: 24,
      character: { name: 'Kestrel', life_id: 'ag_kestrel_01', position: { x: 0, y: 64, z: 0 } },
      reflex: { hunger_interval_ticks: 10000000, eat_below: 14 },
      wake: { min_spacing_seconds: 0.5 },
      ...over,
    }),
  );
}

function tokensFile(): string {
  const file = join(dir, 'tokens.json');
  writeFileSync(file, JSON.stringify({ [PLAYER]: TOKEN }));
  return file;
}

async function connectTo(port: number): Promise<Client> {
  const c = new Client({ name: 'test', version: '0.0.0' });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/p/${PLAYER}`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  );
  client = c;
  return c;
}

async function startWorld(scenario: Scenario) {
  const world = createSimWorld({ scenario });
  http = createApp({ tokens: loadTokens(tokensFile()), world, log: () => undefined });
  const c = await connectTo(await http.listen(0));
  return { world, c };
}

async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await c.callTool(
    { name, arguments: args },
    undefined,
    name === 'wait' ? WAIT_OPTIONS : undefined,
  );
  const text = (r.content as { text: string }[])[0]?.text ?? '';
  expect(r.isError, text).not.toBe(true);
  return JSON.parse(text);
}

const longIntent = (over: Record<string, unknown> = {}) => ({
  goal: 'walk',
  program: 'travel',
  arguments: { mock_ticks: 60000 },
  wake_on: ['directly_addressed', 'goal_completed'],
  limits: { max_world_ticks: 240000, max_block_operations: 10 },
  ...over,
});

describe('real-time end to end', () => {
  it('chatter does not wake; an addressed line does, and is named', async () => {
    const { world, c } = await startWorld(
      scenarioOf({
        events: [
          { type: 'speech', at_tick: 1500, from: 'Bram', to: null, text: 'nice day' },
          { type: 'speech', at_tick: 3500, from: 'Bram', to: 'Kestrel', text: 'hello you' },
        ],
      }),
    );
    expect((await call(c, 'act', { intent: longIntent() })).accepted).toEqual([0]);
    const t0 = Date.now();
    const result = await call(c, 'wait', { max_seconds: 8 });
    const seconds = (Date.now() - t0) / 1000;
    expect(seconds).toBeGreaterThanOrEqual(3.0);
    expect(seconds).toBeLessThanOrEqual(7.5);
    expect(result.wake_reason).toBe('directly_addressed');
    expect(validateToolResult('wait', result).ok).toBe(true);
    const types = result.events.map((e: { type: string }) => e.type);
    expect(types).toContain('conversation_digest');
    expect(types).toContain('speech_to_me');
    expect(
      world.hub
        .suppressed(PLAYER)
        .some((r) => r.kind === 'speech' && r.reason === 'overheard_chatter'),
    ).toBe(true);
  }, 30_000);

  it('falls back to a wakeup after the run-too-long seconds', async () => {
    const scenario = applyOverrides(scenarioOf(), { intentRunTooLongSeconds: 2 });
    const { c } = await startWorld(scenario);
    await call(c, 'act', { intent: longIntent({ arguments: { mock_ticks: 100000 } }) });
    const t0 = Date.now();
    const result = await call(c, 'wait', { max_seconds: 8 });
    const seconds = (Date.now() - t0) / 1000;
    expect(result.wake_reason).toBe('intent_run_too_long');
    expect(seconds).toBeGreaterThanOrEqual(1.5);
    expect(seconds).toBeLessThanOrEqual(4);
  }, 30_000);

  it('reports the reflex in the next wait without waking or spending budget', async () => {
    const { c } = await startWorld(
      scenarioOf({
        character: {
          name: 'Kestrel',
          life_id: 'ag_kestrel_01',
          position: { x: 0, y: 64, z: 0 },
          food: 15,
          inventory: [{ item: 'bread', count: 1 }],
        },
        reflex: { hunger_interval_ticks: 1000, eat_below: 14 },
      }),
    );
    const result = await call(c, 'wait', { max_seconds: 5 });
    expect(result.wake_reason).toBe('timeout');
    const reflexes = result.events.filter((e: { type: string }) => e.type === 'reflex');
    expect(reflexes).toHaveLength(1);
    expect((await call(c, 'status')).budget_remaining_thoughts).toBe(100);
  }, 30_000);
});

describe('the command line', () => {
  it('parses the dawn scenario file', () => {
    const raw = readFileSync(join(PACKAGE_DIR, 'scenarios', 'dawn.scenario.json'), 'utf8');
    const scenario = parseScenario(raw);
    // The file leaves the timings to the defaults, and every event lands within one default day.
    const keys = Object.keys(JSON.parse(raw) as Record<string, unknown>);
    for (const key of ['wake', 'reflex', 'intent']) expect(keys, key).not.toContain(key);
    expect(Math.max(...scenario.events.map((e) => e.at_tick))).toBeLessThanOrEqual(10000);
    expect(scenario.character.name).toBe('Kestrel');
    expect(scenario.neighbours.map((n) => n.name)).toEqual(['Pike', 'Wren']);
    expect(scenario.character.inventory.find((s) => s.item === 'bread')?.count).toBe(2);
    expect(scenario.books.map((b) => b.kind).sort()).toEqual(['skill', 'text']);
    expect([...scenario.character.facts].sort()).toEqual(['field_is_known', 'seeds_available']);
    const speech = scenario.events.filter((e) => e.type === 'speech');
    expect(speech.filter((e) => e.to === null)).toHaveLength(3);
    expect(speech.filter((e) => e.to === 'Kestrel')).toHaveLength(1);
    for (const type of ['damage', 'agent_approaches', 'proposal']) {
      expect(
        scenario.events.filter((e) => e.type === type),
        type,
      ).toHaveLength(1);
    }
  });

  it('starts with --scenario and serves a snapshot for Kestrel', async () => {
    const log = join(dir, 'suppressed.jsonl');
    const proc = spawn(
      process.execPath,
      [
        'src/cli.ts',
        '--scenario',
        'scenarios/dawn.scenario.json',
        '--tokens',
        tokensFile(),
        '--port',
        '0',
        '--day-length-seconds',
        '24',
        '--suppressed-log',
        log,
      ],
      { cwd: PACKAGE_DIR, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    child = proc;
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const deadline = Date.now() + 10_000;
    let port = 0;
    while (port === 0 && Date.now() < deadline) {
      for (const line of stderr.split('\n').slice(0, -1)) {
        if (!line.startsWith('{')) continue;
        const parsed = JSON.parse(line) as { event?: string; port?: number };
        if (parsed.event === 'listening' && parsed.port !== undefined) port = parsed.port;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(port).toBeGreaterThan(0);
    const c = await connectTo(port);
    const look = await call(c, 'look');
    expect(validateToolResult('look', look).ok).toBe(true);
    expect(look.snapshot.agent_id).toBe('ag_kestrel_01');
    expect(stderr).not.toContain(TOKEN);
  }, 30_000);

  it('exits 1 with the message on a bad scenario', async () => {
    const bad = join(dir, 'bad.scenario.json');
    writeFileSync(bad, '{ "name": 5 }');
    const proc = spawn(
      process.execPath,
      ['src/cli.ts', '--scenario', bad, '--tokens', tokensFile()],
      {
        cwd: PACKAGE_DIR,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    child = proc;
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const code = await new Promise<number | null>((resolve) => proc.once('close', resolve));
    expect(code).toBe(1);
    expect(stderr).toMatch(/^scenario: /);
  }, 30_000);
});
