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

function exited(proc: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) resolve(proc.exitCode);
    else proc.once('exit', (code) => resolve(code));
  });
}

async function listeningPort(stderr: () => string): Promise<number> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    for (const line of stderr().split('\n')) {
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
  if (child !== undefined && child.exitCode === null) {
    child.kill();
    await exited(child);
  }
  child = undefined;
  rmSync(dir, { recursive: true, force: true });
});

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
    expect(stderr()).not.toContain('short-tok');
  }, 30_000);
});
