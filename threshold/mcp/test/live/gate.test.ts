import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { integrationEnabled, liveEnabled } from './gate.ts';

/**
 * The guard for the WM-12 live cases. They cannot run in `check`, so this pins the gate rules and that every
 * live case file gates on liveEnabled() (skipIf), with no case that runs without it.
 */
const here = dirname(fileURLToPath(import.meta.url));

describe('the Wave M live gate', () => {
  it('is off when the env is unset', () => {
    expect(liveEnabled({})).toBe(false);
    expect(integrationEnabled({})).toBe(false);
  });

  it('needs both GELDAR_IT and GELDAR_MCP_LIVE, not one of them', () => {
    expect(liveEnabled({ GELDAR_IT: '1' })).toBe(false);
    expect(liveEnabled({ GELDAR_MCP_LIVE: '1' })).toBe(false);
    expect(liveEnabled({ GELDAR_IT: '1', GELDAR_MCP_LIVE: '1' })).toBe(true);
    expect(liveEnabled({ GELDAR_IT: 'true', GELDAR_MCP_LIVE: '1' })).toBe(false);
  });

  it('every live case file is skipped unless liveEnabled() is true', () => {
    const cases = readdirSync(here).filter((name) => name.endsWith('.live.test.ts'));
    expect(cases.length).toBeGreaterThan(0);
    for (const name of cases) {
      const source = readFileSync(join(here, name), 'utf8');
      expect(source, name).toMatch(/describe\.skipIf\(!liveEnabled\(\)\)/);
    }
  });
});
