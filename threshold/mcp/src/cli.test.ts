import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { type CliDeps, configFileOf, EXIT, runCli, type Signal } from './cli.ts';
import { repoRoot } from './config.ts';
import type { McpPorts, RunningMcp } from './main.ts';

const SHARD_FILE = join(repoRoot(), 'shards', 'phase0.yaml');
/** The secret file paths the shipped shard needs; the files are never read because startup is faked. */
const ENV = {
  GELDAR_MCP_DB_PASSWORD_FILE: '/run/secrets/pg',
  GELDAR_MCP_PEPPER_FILE: '/run/secrets/pepper',
};

/** Deps for runCli with a fake start: `stops` counts the stop calls, `handlers` holds the signal handlers. */
function cliDeps(overrides: Partial<CliDeps> = {}) {
  const handlers: Partial<Record<Signal, () => void>> = {};
  const logs: string[] = [];
  const stops = { count: 0 };
  const running: RunningMcp = {
    port: 8443,
    stop: async () => {
      stops.count += 1;
    },
  };
  const deps: CliDeps = {
    ports: {} as McpPorts,
    start: async () => running,
    onSignal: (signal, handler) => {
      handlers[signal] = handler;
    },
    log: (line) => logs.push(JSON.stringify(line)),
    setTimer: () => ({ unref: () => undefined }),
    ...overrides,
  };
  return { deps, handlers, logs, stops };
}

describe('runCli', () => {
  it('stops in order on SIGTERM and exits 0; a second signal does nothing more', async () => {
    const { deps, handlers, stops } = cliDeps();
    const exit = runCli(['node', 'cli.ts', 'start', SHARD_FILE], ENV, deps);
    await vi.waitFor(() => expect(handlers.SIGTERM).toBeDefined());
    handlers.SIGTERM?.();
    handlers.SIGTERM?.();
    expect(await exit).toBe(EXIT.stopped);
    expect(stops.count).toBe(1);
  });

  it('treats SIGINT the same way', async () => {
    const { deps, handlers, stops } = cliDeps();
    const exit = runCli(['node', 'cli.ts', 'start', SHARD_FILE], ENV, deps);
    await vi.waitFor(() => expect(handlers.SIGINT).toBeDefined());
    handlers.SIGINT?.();
    expect(await exit).toBe(EXIT.stopped);
    expect(stops.count).toBe(1);
  });

  it('exits 78 and logs the rule, not a stack, when the shard is refused', async () => {
    const { deps, logs } = cliDeps({
      start: async () => {
        throw new Error('must not start');
      },
    });
    const exit = await runCli(
      ['node', 'cli.ts', 'start', join(repoRoot(), 'pnpm-workspace.yaml')],
      {},
      deps,
    );
    expect(exit).toBe(EXIT.config);
    expect(logs.join('\n')).toContain('config_error');
  });

  it('refuses a sovereign shard without identity_mode: watched, and names the rule', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'geldar-mcp-cli-'));
    try {
      const file = join(dir, 'phase0.yaml');
      writeFileSync(
        file,
        readFileSync(SHARD_FILE, 'utf8').replace(/^identity_mode: watched.*\n/m, ''),
      );
      const { deps, logs } = cliDeps({
        start: async () => {
          throw new Error('must not start');
        },
      });
      expect(await runCli(['node', 'cli.ts', 'start', file], ENV, deps)).toBe(EXIT.config);
      expect(logs.join('\n')).toContain('config_rejected');
      expect(logs.join('\n')).toContain('sovereign allowed requires identity_mode: watched');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('exits 1 when startup fails, without the error message', async () => {
    const { deps, logs } = cliDeps({
      start: async () => {
        throw new Error('password authentication failed for user geldar_mcp');
      },
    });
    expect(await runCli(['node', 'cli.ts', 'start', SHARD_FILE], ENV, deps)).toBe(EXIT.failed);
    expect(logs.join('\n')).toContain('startup_failed');
    expect(logs.join('\n')).not.toContain('password');
  });

  it('exits 2 for any command other than start', async () => {
    const { deps } = cliDeps();
    expect(await runCli(['node', 'cli.ts', 'stop'], {}, deps)).toBe(EXIT.usage);
  });

  it('takes the config file from the argument, then GELDAR_SHARD_FILE, then the shard name', () => {
    expect(
      configFileOf(['node', 'cli.ts', 'start', '/x.yaml'], { GELDAR_SHARD_FILE: '/y.yaml' }),
    ).toBe('/x.yaml');
    expect(configFileOf(['node', 'cli.ts', 'start'], { GELDAR_SHARD_FILE: '/y.yaml' })).toBe(
      '/y.yaml',
    );
    expect(configFileOf(['node', 'cli.ts', 'start'], {})).toBe(
      join(repoRoot(), 'shards', 'phase0.yaml'),
    );
  });
});
