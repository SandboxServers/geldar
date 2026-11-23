import type { SpawnSyncOptions } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeTool, pwshCommand, toolAvailable } from './tool-probe';

// Counts each spawnSync call and still runs the real one, so the lazy-probe tests see what the module starts.
const spawnSpy = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: (...args: [string, readonly string[], SpawnSyncOptions]) => {
      spawnSpy(args[0]);
      return actual.spawnSync(args[0], [...args[1]], args[2]);
    },
  };
});

const MISSING = 'geldar-no-such-tool-898';
const SAVED = { CI: process.env.CI, PWSH: process.env.GELDAR_TEST_PWSH };

afterEach(() => {
  vi.restoreAllMocks();
  if (SAVED.CI === undefined) delete process.env.CI;
  else process.env.CI = SAVED.CI;
  if (SAVED.PWSH === undefined) delete process.env.GELDAR_TEST_PWSH;
  else process.env.GELDAR_TEST_PWSH = SAVED.PWSH;
});

describe('probeTool', () => {
  it('reports a missing binary as not usable and names it, without throwing', () => {
    const probe = probeTool('fake tool', MISSING, ['--version']);
    expect(probe.ok).toBe(false);
    expect(probe.reason).toContain('fake tool is not usable');
    expect(probe.reason).toContain(MISSING);
  });

  it('reports a binary that exits 0 as usable, with no reason', () => {
    const probe = probeTool('node', process.execPath, ['--version']);
    expect(probe.ok).toBe(true);
    expect(probe.reason).toBe('');
  });

  it('reports a binary that exits non-zero as not usable', () => {
    const probe = probeTool('node', process.execPath, ['-e', 'process.exit(3)']);
    expect(probe.ok).toBe(false);
  });
});

describe('toolAvailable', () => {
  const missing = probeTool('fake tool', MISSING, []);
  const present = probeTool('node', process.execPath, ['--version']);

  it('returns true for a usable tool, even with CI set', () => {
    process.env.CI = 'true';
    expect(toolAvailable(present)).toBe(true);
  });

  it('returns false for a missing tool outside CI, so the tests skip', () => {
    delete process.env.CI;
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(toolAvailable(missing)).toBe(false);
    expect(write).toHaveBeenCalledWith(expect.stringContaining('fake tool'));
  });

  it('throws for a missing tool when CI is set, so CI cannot pass by skipping', () => {
    process.env.CI = 'true';
    expect(() => toolAvailable(missing)).toThrow(/CI is set: these tests must run, not skip/);
  });
});

describe('pwshCommand', () => {
  it('reads GELDAR_TEST_PWSH and falls back to pwsh', () => {
    delete process.env.GELDAR_TEST_PWSH;
    expect(pwshCommand()).toBe('pwsh');
    process.env.GELDAR_TEST_PWSH = MISSING;
    expect(pwshCommand()).toBe(MISSING);
  });
});

describe('lazy probes', () => {
  it('starts nothing on import, runs a probe once on first use, and reuses the result', async () => {
    spawnSpy.mockClear();
    vi.resetModules();
    const mod = await import('./tool-probe');
    expect(spawnSpy).not.toHaveBeenCalled();
    const first = mod.dockerComposeProbe();
    expect(mod.dockerComposeProbe()).toBe(first);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(spawnSpy).toHaveBeenCalledWith('docker');
  });

  it('reads GELDAR_TEST_PWSH when pwshProbe is first called, not at import', async () => {
    spawnSpy.mockClear();
    process.env.GELDAR_TEST_PWSH = MISSING;
    vi.resetModules();
    const mod = await import('./tool-probe');
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(mod.pwshProbe().ok).toBe(false);
    expect(spawnSpy).toHaveBeenCalledWith(MISSING);
  });
});
