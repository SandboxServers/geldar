import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { type DiagProcess, installDiagnostics, startProxy } from '../alias-proxy/alias-proxy.ts';

// Why the alias proxy stops: one `alias-proxy: ...` line per event. Every alias and username here is made up.
const SCRIPT = fileURLToPath(new URL('../alias-proxy/alias-proxy.ts', import.meta.url));
const EXIT_FIXTURE = fileURLToPath(new URL('./fixtures/alias-exit-fixture.ts', import.meta.url));
const UNCAUGHT_FIXTURE = fileURLToPath(
  new URL('./fixtures/alias-uncaught-fixture.ts', import.meta.url),
);
const FAKE_ALIAS = 'FakeAliasZeta';
const PLAYERS_JSON = '{"players":[{"uuid":"u-1","name":"ag_test_01","foreign":false}]}';

const dir = mkdtempSync(join(tmpdir(), 'alias-diag-'));
const aliasesPath = join(dir, 'aliases.json');
writeFileSync(aliasesPath, JSON.stringify({ ag_test_01: FAKE_ALIAS }));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => ok(port));
    });
  });
}

async function proxyEnv(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  return {
    GELDAR_ALIAS_PROXY_PORT: String(await freePort()),
    GELDAR_ALIAS_UPSTREAM_HOST: '127.0.0.1',
    GELDAR_ALIAS_UPSTREAM_PORT: String(await freePort()),
    ...extra,
  };
}

type Child = {
  text: () => string;
  closed: Promise<number | null>;
  kill: (sig: NodeJS.Signals) => void;
};

// The child inherits the developer's environment, so GELDAR_ALIASES_FILE is removed unless the test sets it.
function runScript(script: string, env: Record<string, string>): Child {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  if (!('GELDAR_ALIASES_FILE' in env)) delete childEnv.GELDAR_ALIASES_FILE;
  const child = spawn(process.execPath, [script], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c: Buffer) => {
    out += c;
  });
  child.stderr.on('data', (c: Buffer) => {
    out += c;
  });
  const closed = new Promise<number | null>((ok) => child.on('close', (code) => ok(code)));
  return { text: () => out, closed, kill: (sig) => void child.kill(sig) };
}

async function waitForText(child: Child, needle: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!child.text().includes(needle)) {
    if (Date.now() > deadline) throw new Error(`no output containing "${needle}"`);
    await new Promise((ok) => setTimeout(ok, 25));
  }
}

// A stand-in for process: EventEmitter plus exit(), which emits 'exit' like Node does, and a fixed uptime.
class FakeProcess extends EventEmitter {
  readonly codes: number[] = [];
  uptime(): number {
    return 42.4;
  }
  exit(code = 0): void {
    this.codes.push(code);
    this.emit('exit', code);
  }
  asProcess(): DiagProcess {
    return this as unknown as DiagProcess;
  }
}

describe('alias proxy as a child process', () => {
  it('logs the start line with pid, node version, listen port, upstream and aliases=unset', async () => {
    const env = await proxyEnv();
    const child = runScript(SCRIPT, env);
    try {
      await waitForText(child, 'aliases=unset');
    } finally {
      child.kill('SIGKILL');
      await child.closed;
    }
    const start = new RegExp(
      `alias-proxy: start pid=\\d+ node=v\\d+\\.\\d+\\.\\d+ listen=${env.GELDAR_ALIAS_PROXY_PORT} ` +
        `upstream=127\\.0\\.0\\.1:${env.GELDAR_ALIAS_UPSTREAM_PORT} aliases=unset`,
    );
    expect(child.text()).toMatch(start);
  });

  it('logs the start line as aliases=set and never the aliases path or contents', async () => {
    const child = runScript(SCRIPT, await proxyEnv({ GELDAR_ALIASES_FILE: aliasesPath }));
    try {
      await waitForText(child, 'aliases=set');
    } finally {
      child.kill('SIGKILL');
      await child.closed;
    }
    expect(child.text()).not.toContain(aliasesPath);
    expect(child.text()).not.toContain(FAKE_ALIAS);
  });

  it.skipIf(process.platform === 'win32')(
    'SIGTERM logs the signal and the exit, then exits 0',
    async () => {
      const child = runScript(SCRIPT, await proxyEnv());
      let code: number | null = null;
      try {
        await waitForText(child, 'aliases=unset');
        child.kill('SIGTERM');
        code = await child.closed;
      } finally {
        child.kill('SIGKILL');
      }
      expect(child.text()).toContain('alias-proxy: signal SIGTERM uptime=');
      expect(child.text()).toContain('alias-proxy: exit code=0 uptime=');
      expect(code).toBe(0);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'SIGINT logs the signal and the exit, then exits 0',
    async () => {
      const child = runScript(SCRIPT, await proxyEnv());
      let code: number | null = null;
      try {
        await waitForText(child, 'aliases=unset');
        child.kill('SIGINT');
        code = await child.closed;
      } finally {
        child.kill('SIGKILL');
      }
      expect(child.text()).toContain('alias-proxy: signal SIGINT uptime=');
      expect(child.text()).toContain('alias-proxy: exit code=0 uptime=');
      expect(code).toBe(0);
    },
  );

  it('logs event loop empty when the loop drains (beforeExit), with exit code 0', async () => {
    const child = runScript(EXIT_FIXTURE, {});
    const code = await child.closed;
    expect(child.text()).toContain('alias-proxy: server closed uptime=');
    expect(child.text()).toMatch(/alias-proxy: event loop empty \(beforeExit code=0\) uptime=\d+s/);
    expect(child.text()).toMatch(/alias-proxy: exit code=0 uptime=\d+s/);
    expect(code).toBe(0);
  });

  it('logs an uncaught error by name and message, never a stack, and exits 1', async () => {
    const child = runScript(UNCAUGHT_FIXTURE, {});
    const code = await child.closed;
    expect(child.text()).toContain('alias-proxy: uncaught uncaughtException Error: fixture boom');
    expect(child.text()).toMatch(/alias-proxy: exit code=1 uptime=\d+s/);
    expect(child.text()).not.toMatch(/\n\s+at /);
    expect(code).toBe(1);
  });
});

describe('installDiagnostics with an in-process fake process', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)(
    '%s logs the signal, closes the server and exits 0',
    async (sig) => {
      const fake = new FakeProcess();
      const lines: string[] = [];
      await startProxy({
        listen: 0,
        upstreamHost: '127.0.0.1',
        upstreamPort: 9,
        aliasesFile: undefined,
        log: () => {},
        onServer: (s) => installDiagnostics(fake.asProcess(), (l) => lines.push(l), s),
      });
      fake.emit(sig);
      await vi.waitFor(() => expect(fake.codes).toEqual([0]));
      expect(lines).toContain(`alias-proxy: signal ${sig} uptime=42s`);
      expect(lines).toContain('alias-proxy: server closed uptime=42s');
      expect(lines).toContain('alias-proxy: exit code=0 uptime=42s');
    },
  );

  it('forces the exit 2 s after a signal when the server does not close', () => {
    vi.useFakeTimers();
    try {
      const fake = new FakeProcess();
      const hung = { close: () => undefined, on: () => undefined } as unknown as Server;
      installDiagnostics(fake.asProcess(), () => {}, hung);
      fake.emit('SIGTERM');
      vi.advanceTimersByTime(1999);
      expect(fake.codes).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(fake.codes).toEqual([0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs beforeExit as an empty event loop and does not exit by itself', () => {
    const fake = new FakeProcess();
    const lines: string[] = [];
    installDiagnostics(fake.asProcess(), (l) => lines.push(l));
    fake.emit('beforeExit', 0);
    expect(lines).toEqual(['alias-proxy: event loop empty (beforeExit code=0) uptime=42s']);
    expect(fake.codes).toEqual([]);
  });

  it('logs an uncaught error as name and message only, then exits 1', () => {
    const fake = new FakeProcess();
    const lines: string[] = [];
    installDiagnostics(fake.asProcess(), (l) => lines.push(l));
    const err = new TypeError('bad thing');
    err.stack = 'TypeError: bad thing\n    at secret (/private/place.ts:1:1)';
    fake.emit('uncaughtException', err, 'uncaughtException');
    expect(lines).toContain('alias-proxy: uncaught uncaughtException TypeError: bad thing');
    expect(lines.join('\n')).not.toContain('secret');
    expect(lines.join('\n')).not.toContain('    at ');
    expect(fake.codes).toEqual([1]);
  });

  it('logs an unhandled rejection, including a non-Error reason, then exits 1', () => {
    const fake = new FakeProcess();
    const lines: string[] = [];
    installDiagnostics(fake.asProcess(), (l) => lines.push(l));
    fake.emit('unhandledRejection', new RangeError('nope'), Promise.resolve());
    expect(lines).toContain('alias-proxy: uncaught unhandledRejection RangeError: nope');
    expect(fake.codes).toEqual([1]);
    fake.emit('unhandledRejection', 'text reason', Promise.resolve());
    expect(lines).toContain('alias-proxy: uncaught unhandledRejection non-Error value');
    expect(fake.codes).toEqual([1, 1]);
  });

  it('logs a server error code only and exits 1', () => {
    const fake = new FakeProcess();
    const lines: string[] = [];
    const server = createServer();
    installDiagnostics(fake.asProcess(), (l) => lines.push(l), server);
    server.emit(
      'error',
      Object.assign(new Error('listen EADDRINUSE: 127.0.0.1:8102'), { code: 'EADDRINUSE' }),
    );
    expect(lines).toContain('alias-proxy: server error EADDRINUSE');
    expect(lines.join('\n')).not.toContain('8102');
    expect(fake.codes).toEqual([1]);
  });

  it('the alias-file load line carries no path and no alias contents', async () => {
    const upstream = createServer((_req, res) => res.end(PLAYERS_JSON));
    await new Promise<void>((ok) => upstream.listen(0, '127.0.0.1', ok));
    const lines: string[] = [];
    const proxy = await startProxy({
      listen: 0,
      upstreamHost: '127.0.0.1',
      upstreamPort: (upstream.address() as AddressInfo).port,
      aliasesFile: aliasesPath,
      log: (l) => lines.push(l),
    });
    try {
      const res = await fetch(`http://127.0.0.1:${proxy.port()}/maps/overworld/live/players.json`);
      expect(await res.text()).toContain(FAKE_ALIAS);
      expect(lines).toContain('alias-proxy: alias file loaded');
      expect(lines.join('\n')).not.toContain(aliasesPath);
      expect(lines.join('\n')).not.toContain(FAKE_ALIAS);
    } finally {
      proxy.close();
      upstream.close();
    }
  });
});
