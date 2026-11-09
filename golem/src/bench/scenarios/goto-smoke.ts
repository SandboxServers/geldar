import type { Scenario } from '../types.ts';

/** How far the smoke test walks, in blocks. */
const DISTANCE = 12;

/**
 * Hidden: proves the harness itself. The bot walks 12 blocks on an empty arena; it passes when
 * `goto` completes within the timeout. The warm-up of every cell runs this scenario.
 */
export const gotoSmoke: Scenario = {
  name: 'goto-smoke',
  description: 'walk 12 blocks across an empty arena',
  timeoutMs: 60_000,
  hidden: true,
  async prepare() {
    // The runner has built the empty arena and put the bot at its center.
  },
  ready: () => true,
  async run(env) {
    const { center } = env.arena;
    const target = { x: center.x + DISTANCE, y: center.y, z: center.z };
    const run = await env.run({ do: 'goto', target });
    const { result } = run;
    const note = `goto ${result.status}${result.reason ? ` (${result.reason})` : ''} in ${result.latency_ms} ms, ${result.world_ticks ?? '?'} ticks at ${env.tps} TPS`;
    return { passed: run.state === 'completed', note };
  },
};
