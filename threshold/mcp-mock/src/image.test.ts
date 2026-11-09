import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { dockerReady, run } from '../test-support/docker.ts';

// The image suite is opt-in: a 15-minute build must not run in every default test run.
const ready = process.env.GELDAR_IMAGE_TESTS === '1' && dockerReady();
const prebuilt = process.env.MOCK_IMAGE;
const tag = prebuilt ?? 'geldar-mcp-mock:test';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PLAYER = 'mock-player';
const TOKEN = randomBytes(16).toString('hex');
const DEFAULT_COMMAND = [
  '--tokens',
  '/run/secrets/mcp-tokens.json',
  '--scenario',
  'scenarios/dawn.scenario.json',
  '--host',
  '0.0.0.0',
];

// Names that must not ship (test-support and tests, token files, env files) plus the one scenario that must.
const FIND_SHIPPED =
  '-name node_modules -prune -o \\( -name "*.test.ts" -o -name "*tokens*.json" -o -name "docker.ts" -o -name ".env*" -o -name "dawn.scenario.json" \\) -print';

let dir: string | undefined;
let containerId: string | undefined;
let client: Client | undefined;

/** Start the image detached on a random loopback port and return the port once it answers. */
async function start(options: { mountTokens: boolean; command?: string[] }): Promise<number> {
  dir = mkdtempSync(join(tmpdir(), 'mcp-mock-'));
  chmodSync(dir, 0o755);
  const file = join(dir, 'tokens.json');
  writeFileSync(file, JSON.stringify({ [PLAYER]: TOKEN }));
  chmodSync(file, 0o644);
  // The same hardening the README and compose example recommend: the image must start under it.
  const args = [
    'run',
    '-d',
    '--rm',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '-p',
    '127.0.0.1::8787',
  ];
  if (options.mountTokens) {
    args.push('--mount', `type=bind,source=${file},target=/run/secrets/mcp-tokens.json,readonly`);
  }
  // Without a command the image's own CMD runs, which the first case relies on.
  args.push(tag, ...(options.command ?? []));
  const started = run(args, { timeoutMs: 60_000 });
  expect(started.status, started.stderr).toBe(0);
  containerId = started.stdout.trim();
  const mapped = run(['port', containerId, '8787/tcp'], { timeoutMs: 60_000 });
  const match = /127\.0\.0\.1:(\d+)/.exec(mapped.stdout);
  expect(match, `${mapped.stdout} ${mapped.stderr}`).not.toBeNull();
  const port = Number(match?.[1]);
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await fetch(`http://127.0.0.1:${port}/p/${PLAYER}`, { signal: AbortSignal.timeout(2_000) });
      return port;
    } catch {
      if (Date.now() > deadline) {
        const logs = run(['logs', containerId], { timeoutMs: 30_000 });
        throw new Error(`the container never answered: ${logs.stdout} ${logs.stderr}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function connect(port: number): Promise<Client> {
  const c = new Client({ name: 'image-test', version: '0.0.0' });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/p/${PLAYER}`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  );
  client = c;
  return c;
}

describe.skipIf(!ready)('mcp-mock image', () => {
  beforeAll(() => {
    if (prebuilt !== undefined) return;
    const built = run(['build', '-f', 'threshold/mcp-mock/Dockerfile', '-t', tag, repoRoot], {
      timeoutMs: 900_000,
    });
    expect(built.status, built.stderr.slice(-2_000)).toBe(0);
  }, 900_000);

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    client = undefined;
    if (containerId !== undefined) run(['rm', '-f', containerId], { timeoutMs: 30_000 });
    containerId = undefined;
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }, 30_000);

  it('starts and serves', async () => {
    const port = await start({ mountTokens: true });
    const c = await connect(port);
    const tools = await c.listTools();
    expect(tools.tools).toHaveLength(14);
    const anonymous = await fetch(`http://127.0.0.1:${port}/p/${PLAYER}`, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    });
    expect(anonymous.status).toBe(401);
  }, 120_000);

  it('does not run as root', () => {
    const user = run(['image', 'inspect', '--format', '{{.Config.User}}', tag], {
      timeoutMs: 60_000,
    });
    expect(user.stdout.trim()).toBe('node');
    const id = run(['run', '--rm', '--entrypoint', 'id', tag, '-u'], { timeoutMs: 60_000 });
    expect(id.stdout.trim()).toBe('1000');
  }, 120_000);

  it('bakes in no tests, tokens or env files', () => {
    const found = run(
      ['run', '--rm', '--entrypoint', 'sh', tag, '-c', `find /opt/geldar ${FIND_SHIPPED}`],
      { timeoutMs: 60_000 },
    );
    expect(found.status, found.stderr).toBe(0);
    const lines = found.stdout.split('\n').filter((l) => l !== '');
    expect(lines).toEqual(['/opt/geldar/threshold/mcp-mock/scenarios/dawn.scenario.json']);
  }, 120_000);

  it('finds each forbidden name when one is present (the search is not vacuous)', () => {
    const names = ['a.test.ts', 'mcp-tokens.json', 'tokens.json', 'docker.ts', '.env.local'];
    const script = `mkdir -p /tmp/probe && cd /tmp/probe && touch ${names.join(' ')} && find /tmp/probe ${FIND_SHIPPED}`;
    const found = run(['run', '--rm', '--entrypoint', 'sh', tag, '-c', script], {
      timeoutMs: 60_000,
    });
    expect(found.status, found.stderr).toBe(0);
    expect(
      found.stdout
        .split('\n')
        .filter((l) => l !== '')
        .sort(),
    ).toEqual(names.map((n) => `/tmp/probe/${n}`).sort());
  }, 120_000);
  it('runs the scenario in the container', async () => {
    const port = await start({
      mountTokens: true,
      command: [...DEFAULT_COMMAND, '--day-length-seconds', '24'],
    });
    const c = await connect(port);
    const result = await c.callTool({ name: 'look', arguments: {} });
    const text = (result.content as { text: string }[])[0]?.text ?? '';
    expect(result.isError, text).not.toBe(true);
    expect(JSON.parse(text).snapshot.agent_id).toBe('ag_kestrel_01');
  }, 120_000);
});
