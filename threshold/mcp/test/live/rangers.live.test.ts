/**
 * Live cases (a) and (i) of WM-12: the sovereign rangers online with their RSS, and 30 minutes with every Body
 * up (TPS and memory). Written, not run. Needs the shard, `./geldar.ps1 players up` and the operator's TPS
 * command. Gate: GELDAR_IT=1 GELDAR_MCP_LIVE=1. Run with `./geldar.ps1 pnpm --dir threshold/mcp exec vitest run test/live/rangers.live.test.ts`.
 * Env: GELDAR_LIVE_RANGER_COUNT (default 6), GELDAR_LIVE_TPS_CMD (prints the Paper 1-minute TPS, operator-set),
 * GELDAR_LIVE_RSS_CEILING_MB (default 512). The output format of `players status` is read on the first run.
 * Nothing is created or removed: the case only observes the rangers that `players up` started.
 */
import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { geldar } from './client.ts';
import { liveEnabled } from './gate.ts';

const RANGER_COUNT = Number(process.env.GELDAR_LIVE_RANGER_COUNT ?? '6');
const TPS_FLOOR = 19.5;
const RSS_CEILING_MB = Number(process.env.GELDAR_LIVE_RSS_CEILING_MB ?? '512');
const SAMPLES = 30;
const SAMPLE_GAP_MS = 60_000;

interface RangerLine {
  id: string;
  online: boolean;
  rssMb: number | null;
}

/** One line per ranger from `players status`: the id, the state word and the RSS in MB when it prints one. */
export function parseStatus(output: string): RangerLine[] {
  const lines: RangerLine[] = [];
  for (const line of output.split('\n')) {
    const match = /^\s*(ag-[a-z0-9-]+)\b/.exec(line);
    if (match === null) continue;
    const rss = /(\d+(?:\.\d+)?)\s*MB/i.exec(line);
    lines.push({
      id: match[1] ?? '',
      online: /\bonline\b/i.test(line),
      rssMb: rss === null ? null : Number(rss[1]),
    });
  }
  return lines;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

describe.skipIf(!liveEnabled())('rangers online (a) and the 30-minute run (i)', () => {
  it('(a) every ranger is online and prints its RSS', () => {
    const rangers = parseStatus(geldar('players', 'status'));
    expect(rangers.length, 'rangers listed').toBeGreaterThanOrEqual(RANGER_COUNT);
    for (const ranger of rangers) {
      expect(ranger.online, `${ranger.id} is not online`).toBe(true);
      expect(ranger.rssMb, `${ranger.id} printed no RSS`).not.toBeNull();
    }
  });

  it(
    '(i) for 30 minutes with every Body up: TPS at or above 19.5 and RSS under the ceiling',
    async () => {
      const tpsCommand = process.env.GELDAR_LIVE_TPS_CMD;
      if (tpsCommand === undefined || tpsCommand.trim() === '') {
        throw new Error(
          'GELDAR_LIVE_TPS_CMD is not set: give the operator command that prints the TPS',
        );
      }
      for (let sample = 0; sample < SAMPLES; sample += 1) {
        const rangers = parseStatus(geldar('players', 'status'));
        expect(
          rangers.every((ranger) => ranger.online),
          `sample ${sample}: a Body is down`,
        ).toBe(true);
        for (const ranger of rangers) {
          expect(ranger.rssMb ?? Number.POSITIVE_INFINITY, `${ranger.id} RSS`).toBeLessThanOrEqual(
            RSS_CEILING_MB,
          );
        }
        const tps = Number(execSync(tpsCommand, { encoding: 'utf8' }).trim());
        expect(Number.isFinite(tps), `sample ${sample}: TPS was not a number`).toBe(true);
        expect(tps, `sample ${sample}: TPS`).toBeGreaterThanOrEqual(TPS_FLOOR);
        if (sample < SAMPLES - 1) await sleep(SAMPLE_GAP_MS);
      }
    },
    35 * 60_000,
  );
});
