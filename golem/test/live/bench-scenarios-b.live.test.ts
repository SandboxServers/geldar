import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/actions/index.ts';
import { runCell } from '../../src/bench/runner.ts';
import { bed, bedClear } from '../../src/bench/scenarios/bed.ts';
import { blockedPath, resetBlockedPathRuns } from '../../src/bench/scenarios/blocked-path.ts';
import { chest } from '../../src/bench/scenarios/chest.ts';
import { gotoSmoke } from '../../src/bench/scenarios/goto-smoke.ts';
import type { Scenario } from '../../src/bench/types.ts';
import { withLiveBot } from './fixture.ts';

/**
 * The bed, hidden bed-clear, chest and blocked-path scenarios once each at 20 TPS through the real runner
 * (blocked-path twice: one `detour` run, one `sealed` run). A failing verdict traced to an action
 * is a Body finding; a `timeout` outcome of blocked-path is a pathfinder-watchdog finding.
 */
const NAME = 'GolemBenchB';
const SLOT = 7;

describe('bench scenarios B at 20 TPS', () => {
  it('runs bed, chest and blocked-path to a verdict', async () => {
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
      const verdicts: Record<string, { passed: number; notes: string[] }> = {};
      const play = async (scenario: Scenario, runs: number) => {
        const cell = await runCell(scenario, 20, runs, deps);
        verdicts[scenario.name] = { passed: cell.passed, notes: cell.notes };
        console.log(`${scenario.name}: ${cell.passed}/${runs} ${JSON.stringify(cell.notes)}`);
        return cell;
      };
      resetBlockedPathRuns();
      await play(bed, 1);
      await play(bedClear, 1);
      await play(chest, 1);
      await play(blockedPath, 2);
      for (const [name, verdict] of Object.entries(verdicts)) {
        const runs = name === 'blocked-path' ? 2 : 1;
        expect(verdict.passed, `${name}: ${JSON.stringify(verdict.notes)}`).toBe(runs);
      }
    });
  }, 900_000);
});
