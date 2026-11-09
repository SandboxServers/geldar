import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'token-for-player-a-0123456789';
const TOKEN_B = 'token-for-player-b-0123456789';

let dir: string;
let child: ChildProcess | undefined;

function run(args: string[]): { child: ChildProcess; stderr: () => string } {
  const proc = spawn(process.execPath, ['src/cli.ts', ...args], {
    cwd: PACKAGE_DIR,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child = proc;
  let text = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    text += chunk.toString('utf8');
  });
  return { child: proc, stderr: () => text };
}

/** Resolves with the exit code once the child has closed (stdio drained, so stderr is complete). */
function exited(proc: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) resolve(proc.exitCode);
    else if (proc.signalCode !== null) resolve(null);
    else proc.once('close', (code) => resolve(code));
  });
}

async function listeningPort(stderr: () => string): Promise<number> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    // Only whole lines: the last chunk may be a partial line still being written.
    for (const line of stderr().split('\n').slice(0, -1)) {
      if (!line.startsWith('{')) continue;
      const parsed = JSON.parse(line) as { event?: string; port?: number };
      if (parsed.event === 'listening' && parsed.port !== undefined) return parsed.port;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('no listening line');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-cli-'));
});

afterEach(async () => {
  // A child killed by a signal has exitCode null too, so check signalCode as well.
  if (child !== undefined && child.exitCode === null && child.signalCode === null) {
    child.kill();
    await exited(child);
  }
  child = undefined;
  rmSync(dir, { recursive: true, force: true });
}, 10_000);

describe('cli', () => {
  it('listens and serves the tools without printing a token', async () => {
    const file = join(dir, 'tokens.json');
    writeFileSync(file, JSON.stringify({ aa: TOKEN }));
    const { stderr } = run(['--tokens', file, '--port', '0']);
    const port = await listeningPort(stderr);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/p/aa`), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      }),
    );
    expect((await client.listTools()).tools).toHaveLength(14);
    await client.close();
    expect(stderr()).not.toContain(TOKEN);
  }, 30_000);

  it('exits 2 without --tokens', async () => {
    const { child: proc } = run(['--port', '0']);
    expect(await exited(proc)).toBe(2);
  }, 30_000);

  it('exits 1 on a short token and does not print it', async () => {
    const file = join(dir, 'tokens.json');
    writeFileSync(file, JSON.stringify({ aa: 'short-tok' }));
    const { child: proc, stderr } = run(['--tokens', file]);
    expect(await exited(proc)).toBe(1);
    expect(stderr()).toMatch(/tokens file: invalid token/);
    expect(stderr()).not.toContain('short-tok');
  }, 30_000);

  it.each([
    ['--host', ''],
    ['--host', '   '],
    ['--port', 'abc'],
    ['--port', ''],
    ['--port', '0x50'],
    ['--port', '1e3'],
    ['--port', '65536'],
  ])(
    'exits 2 on %s %j',
    async (flag, value) => {
      const file = join(dir, 'tokens.json');
      writeFileSync(file, JSON.stringify({ aa: TOKEN }));
      const { child: proc, stderr } = run(['--tokens', file, flag, value]);
      expect(await exited(proc)).toBe(2);
      expect(stderr()).toContain(flag);
    },
    30_000,
  );

  it('gives each player its own handler set', async () => {
    const file = join(dir, 'tokens.json');
    writeFileSync(file, JSON.stringify({ aa: TOKEN, bb: TOKEN_B }));
    const { stderr } = run(['--tokens', file, '--port', '0']);
    const port = await listeningPort(stderr);
    const ids: string[] = [];
    for (const [player, token] of [
      ['aa', TOKEN],
      ['bb', TOKEN_B],
    ] as const) {
      const client = new Client({ name: 'test', version: '0.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/p/${player}`), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      const result = (await client.callTool({ name: 'look' })) as { content: { text: string }[] };
      ids.push(/sn_\w+/.exec(result.content[0]?.text ?? '')?.[0] ?? 'none');
      await client.close();
    }
    expect(ids[0]).not.toBe('none');
    expect(ids[1]).toBe(ids[0]);
  }, 30_000);

  it.skipIf(process.platform === 'win32')(
    'stops with exit 0 on SIGTERM',
    async () => {
      const file = join(dir, 'tokens.json');
      writeFileSync(file, JSON.stringify({ aa: TOKEN }));
      const { child: proc, stderr } = run(['--tokens', file, '--port', '0']);
      await listeningPort(stderr);
      proc.kill('SIGTERM');
      expect(await exited(proc)).toBe(0);
      expect(stderr()).toContain('"event":"stopping"');
    },
    30_000,
  );
});
