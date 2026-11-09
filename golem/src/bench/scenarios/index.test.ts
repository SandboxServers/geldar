import { describe, expect, it } from 'vitest';
import type { RunEnv, Scenario } from '../types.ts';
import { gotoSmoke } from './goto-smoke.ts';
import { findScenario, scenarios, visibleScenarios } from './index.ts';

describe('scenario registry', () => {
  it('has unique names that are lower-case words with hyphens', () => {
    const names = scenarios.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z-]*$/);
  });

  it('leaves hidden scenarios out of all', () => {
    expect(findScenario('goto-smoke')?.hidden).toBe(true);
    expect(visibleScenarios().map((s) => s.name)).not.toContain('goto-smoke');
    expect(visibleScenarios().every((s) => !s.hidden)).toBe(true);
  });

  it('lists the six visible scenarios and keeps bed-clear hidden', () => {
    expect(visibleScenarios().map((s) => s.name)).toEqual([
      'wood-to-stone-tools',
      'food',
      'shelter',
      'bed',
      'chest',
      'blocked-path',
    ]);
    expect(findScenario('bed-clear')?.hidden).toBe(true);
    expect(visibleScenarios().map((s) => s.name)).not.toContain('bed-clear');
  });

  it('finds a scenario by name', () => {
    expect(findScenario('goto-smoke')?.name).toBe('goto-smoke');
    expect(findScenario('nope')).toBeUndefined();
  });

  it('works on an injected list, as the cli does', () => {
    const list = [{ name: 'a' }, { name: 'b', hidden: true }] as unknown as Scenario[];
    expect(visibleScenarios(list).map((s) => s.name)).toEqual(['a']);
    expect(findScenario('b', list)?.name).toBe('b');
    expect(findScenario('goto-smoke', list)).toBeUndefined();
  });
});

describe('goto-smoke', () => {
  const envWith = (state: 'completed' | 'failed') => {
    const calls: unknown[] = [];
    const env = {
      tps: 20,
      arena: { center: { x: 800, y: 200, z: 800 } },
      async run(action: unknown) {
        calls.push(action);
        return {
          state,
          result: { status: state, latency_ms: 5, world_ticks: 3, detail: {}, reason: 'blocked' },
        };
      },
    } as unknown as RunEnv;
    return { env, calls };
  };

  it('walks 12 blocks and passes only when goto completes', async () => {
    const ok = envWith('completed');
    expect((await gotoSmoke.run(ok.env)).passed).toBe(true);
    expect(ok.calls).toEqual([{ do: 'goto', target: { x: 812, y: 200, z: 800 } }]);
    expect((await gotoSmoke.run(envWith('failed').env)).passed).toBe(false);
  });
});
