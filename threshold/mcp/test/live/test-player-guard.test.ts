import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertTestPlayer } from './guards.ts';

/**
 * The guard for the WM-12 live cases that act on a player the operator names in env. The cases cannot run in
 * `check`, so this pins the helper and scans the live files: every read of those env names must go through
 * assertTestPlayer() first, so no case acts on a player without the test marker.
 */
const here = dirname(fileURLToPath(import.meta.url));
const PLAYER_ENV = ['GELDAR_LIVE_REVOKE_PLAYER', 'GELDAR_LIVE_RANGER'];
const UNGUARDED = new RegExp(`(?<!assertTestPlayer\\()env\\('(${PLAYER_ENV.join('|')})'\\)`, 'g');
const GUARDED = /assertTestPlayer\(env\('(GELDAR_LIVE_REVOKE_PLAYER|GELDAR_LIVE_RANGER)'\)\)/g;

describe('the test-player guard', () => {
  it('accepts the test marker and refuses any other player id', () => {
    expect(assertTestPlayer('ag-test-01')).toBe('ag-test-01');
    expect(() => assertTestPlayer('ag-jason-01')).toThrow(/ag-test-/);
    expect(() => assertTestPlayer('')).toThrow();
  });

  it('every live case that reads a named player from env passes it through assertTestPlayer()', () => {
    const cases = readdirSync(here).filter((name) => name.endsWith('.live.test.ts'));
    expect(cases).toContain('revoke-kill-hibernate.live.test.ts');
    for (const name of cases) {
      const source = readFileSync(join(here, name), 'utf8');
      expect(
        [...source.matchAll(UNGUARDED)].map((m) => m[0]),
        name,
      ).toEqual([]);
    }
  });

  it('the revoke-kill-hibernate cases (f), (g) and (h) each call the guard on their player', () => {
    const source = readFileSync(join(here, 'revoke-kill-hibernate.live.test.ts'), 'utf8');
    expect(source).toMatch(/import \{ assertTestPlayer \} from '\.\/guards\.ts';/);
    expect([...source.matchAll(GUARDED)]).toHaveLength(3);
  });
});
