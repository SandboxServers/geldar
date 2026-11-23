import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeTool, pwshCommand, toolAvailable } from './tool-probe';

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
