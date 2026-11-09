import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/actions/index.ts';
import { findingsOf, meanLatencyMs } from '../../src/bench/results.ts';
import { runCell } from '../../src/bench/runner.ts';
import { gotoSmoke } from '../../src/bench/scenarios/goto-smoke.ts';
import { parseTargetRate, setTps } from '../../src/bench/tps.ts';
import type { Scenario } from '../../src/bench/types.ts';
import { loadConfig, readRconPassword } from '../../src/config.ts';
import { RconClient } from '../../src/rcon.ts';
import { TestControl } from '../../src/test-control.ts';
import { withLiveBot } from './fixture.ts';

/** The benchmark harness on 26.1: the world-age clock at 20 and 5 TPS, then `goto-smoke` through the runner. */
const NAME = 'GolemBench';

/** Samples `bot.time.age` every 50 ms for `ms` and reports the step and the rate it saw. */
async function sampleAge(bot: Bot, ms: number) {
  const readings: Array<{ age: number; at: number }> = [];
  const start = Date.now();
  while (Date.now() - start < ms) {
    readings.push({ age: bot.time.age, at: Date.now() });
    await new Promise((r) => setTimeout(r, 50));
  }
  const steps: number[] = [];
  let previous = readings[0];
  for (const reading of readings) {
    if (previous && reading.age !== previous.age) {
      steps.push(reading.age - previous.age);
      previous = reading;
    }
  }
  const first = readings[0];
  const last = readings.at(-1);
  const seconds = first && last ? (last.at - first.at) / 1000 : 0;
  const rate = first && last && seconds > 0 ? (last.age - first.age) / seconds : 0;
  return {
    changes: steps.length,
    minStep: steps.length > 0 ? Math.min(...steps) : 0,
    maxStep: steps.length > 0 ? Math.max(...steps) : 0,
    rate,
  };
}

describe('bench harness on 26.1', () => {
  it('measures the world clock, then runs goto-smoke at 20 and 5 TPS through the runner', async () => {
    await withLiveBot({ name: NAME, slot: 9 }, async ({ bot, ctl, manager }) => {
      // The clock first: does `age` advance one tick at a time, and at what rate per TPS?
      await setTps(ctl, 20);
      const at20 = await sampleAge(bot, 5_000);
      await setTps(ctl, 5);
      const at5 = await sampleAge(bot, 5_000);
      await ctl.tickRate(20);
      console.log(`bot.time.age at 20 TPS: ${JSON.stringify(at20)}`);
      console.log(`bot.time.age at 5 TPS: ${JSON.stringify(at5)}`);
      // Characterisation of decision 0038: the server sends time every 20 ticks, so the age moves in
      // steps of 20. If this fails the premise of 0038 changed: report to the orchestrator.
      console.log(`FINDING: age-step: ${at20.minStep}`);
      expect([at20.minStep, at20.maxStep], 'age step (decision 0038)').toEqual([20, 20]);

      // The probe is goto-smoke plus the server's tick reply in its note; it reads the full ctl.
      const probe: Scenario = {
        ...gotoSmoke,
        name: 'goto-probe',
        async run(env) {
          const result = await gotoSmoke.run(env);
          const reply = (await ctl.tickQuery()).replace(/\s+/g, ' ').trim();
          return { passed: result.passed, note: `${result.note}; ${reply}` };
        },
      };
      const deps = {
        ctl,
        manager,
        registry: createRegistry(),
        botName: NAME,
        slot: 9,
        warmup: gotoSmoke,
        log: (line: string) => console.log(line),
      };
      const fast = await runCell(probe, 20, 2, deps);
      const slow = await runCell(probe, 5, 1, deps);
      console.log(`20 TPS: ${JSON.stringify(fast.notes)} wall ${JSON.stringify(fast.runWallMs)}`);
      console.log(`5 TPS: ${JSON.stringify(slow.notes)} wall ${JSON.stringify(slow.runWallMs)}`);

      // A 20 TPS failure of goto-smoke is blocked (a goto defect); a 5 TPS failure is a finding.
      expect(fast.passed, `goto at 20 TPS: ${JSON.stringify(fast.failures)}`).toBe(2);
      expect(slow.notes[0]).toMatch(/Target tick rate: 5\.0 per second/);
      // These lines are what the results JSON carries as meta.findings.
      for (const finding of findingsOf([fast, slow])) console.log(`FINDING: ${finding}`);
      if (slow.passed !== 1) {
        console.warn(`FINDING: goto-smoke failed at 5 TPS: ${JSON.stringify(slow.failures)}`);
      }
      // Characterisation of decision 0038: Mineflayer's physics runs on its own 50 ms timer, so the
      // same walk takes about as long at 5 TPS as at 20 (dilation would be 4x). If this fails the
      // premise of 0038 changed: report to the orchestrator.
      const mean20 = meanLatencyMs(fast);
      const mean5 = meanLatencyMs(slow);
      expect(mean20, 'goto actions at 20 TPS').not.toBeNull();
      expect(mean5, 'goto actions at 5 TPS').not.toBeNull();
      expect((mean5 as number) / (mean20 as number), 'wall-time ratio 5 vs 20 TPS').toBeLessThan(3);
      expect(parseTargetRate(await ctl.tickQuery())).toBe(20);

      // The reset heals: run 1 damages the bot, run 2 must start at full health.
      let healthRuns = 0;
      const healthProbe: Scenario = {
        ...gotoSmoke,
        name: 'health-probe',
        async run(env) {
          healthRuns++;
          if (healthRuns === 1) {
            await ctl.command(`damage ${NAME} 10`);
            await new Promise((r) => setTimeout(r, 1_000));
            return { passed: env.bot.health < 20, note: `damaged to ${env.bot.health}` };
          }
          await new Promise((r) => setTimeout(r, 1_000));
          return { passed: env.bot.health === 20, note: `health ${env.bot.health}` };
        },
      };
      const healed = await runCell(healthProbe, 20, 2, deps);
      expect(healed.passed, `reset health: ${JSON.stringify(healed.notes)}`).toBe(2);
    });

    // A fresh connection: the fixture's finally has restored the world by now.
    const cfg = loadConfig();
    const rcon = await RconClient.connect({
      host: cfg.rconHost,
      port: cfg.rconPort,
      password: await readRconPassword(cfg),
    });
    try {
      const control = new TestControl(rcon);
      expect(parseTargetRate(await control.tickQuery())).toBe(20);
      expect(await control.gamerule('advance_time')).toMatch(/true/);
      expect(await control.gamerule('spawn_mobs')).toMatch(/true/);
    } finally {
      await rcon.close();
    }
  }, 600_000);
});
