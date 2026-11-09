import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/actions/index.ts';
import { runCell } from '../../src/bench/runner.ts';
import { food } from '../../src/bench/scenarios/food.ts';
import { gotoSmoke } from '../../src/bench/scenarios/goto-smoke.ts';
import { shelter } from '../../src/bench/scenarios/shelter.ts';
import { woodToStoneTools } from '../../src/bench/scenarios/wood-to-stone-tools.ts';
import type { Scenario } from '../../src/bench/types.ts';
import { withLiveBot } from './fixture.ts';

/**
 * Scenarios wood-to-stone-tools, food and shelter, once each at 20 TPS through the real runner. A failing
 * verdict with a failed action in its note is a Body finding (blocked): the note names the step.
 */
const NAME = 'GolemBenchA';
const SLOT = 6;

describe('benchmark scenarios A at 20 TPS', () => {
  const scenarios: Scenario[] = [woodToStoneTools, food, shelter];
  for (const scenario of scenarios) {
    it(`${scenario.name} runs to a verdict`, { timeout: 420_000 }, async () => {
      await withLiveBot({ name: NAME, slot: SLOT }, async ({ ctl, manager }) => {
        const deps = {
          ctl,
          manager,
          registry: createRegistry(),
          botName: NAME,
          slot: SLOT,
          warmup: gotoSmoke,
          log: (line: string) => console.log(line),
        };
        const cell = await runCell(scenario, 20, 1, deps);
        console.log(`${scenario.name}: passed ${cell.passed}/1 ${JSON.stringify(cell.notes)}`);
        console.log(`${scenario.name} actions: ${JSON.stringify(cell.actionStats)}`);
        expect(cell.passed, JSON.stringify(cell.failures)).toBe(1);
      });
    });
  }
});
