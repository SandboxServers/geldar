/**
 * Live case (b) of WM-12: a local stub client drives ag-test-01 through `look`, `act` (gather oak_log) and `wait`.
 * Written, not run. It needs the shard, the MCP container on GELDAR_MCP_URL (default 127.0.0.1:8788) and the test
 * player's token file (GELDAR_MCP_TEST_TOKEN_FILE, outside the repo). Run it with `./geldar.ps1 mcp smoke`.
 * Deterministic: the case names the intent itself and waits in bounded steps; no model chooses anything. It asserts
 * that each tool answers and that the wait returns within its bound. The token is read, never printed.
 * The request bodies come from live-requests.ts, which a unit test checks against the contract (ActInput, WaitInput).
 */
import { describe, expect, it } from 'vitest';
import { connectAs, geldar, readTokenFile, TEST_PLAYER } from './client.ts';
import { liveEnabled } from './gate.ts';
import { actCall, lookCall, WAIT_SECONDS, waitCall } from './live-requests.ts';
import { attemptOf, waitForWake } from './live-wake.ts';

/** Waits of WAIT_SECONDS each: 8 of 25 s is 200 s, past the intent's 2400-tick limit (about 120 s). */
const WAIT_STEPS = 8;
const ENDS = ['goal_completed', 'precondition_failed', 'intent_run_too_long'];

/**
 * The presence state of the test player, as `players status` prints it, for a wake timeout. It needs
 * GELDAR_NATS_URL; without it the message says the record was not read.
 */
function presenceState(): string {
  if ((process.env.GELDAR_NATS_URL ?? '').trim() === '') {
    return 'The presence record was not read (GELDAR_NATS_URL is not set).';
  }
  const line = geldar('players', 'status')
    .split('\n')
    .find((text) => text.includes(TEST_PLAYER));
  const state = line?.match(/presence: (\w+)/)?.[1];
  return `The presence record is ${state ?? 'not printed by players status'}.`;
}

describe.skipIf(!liveEnabled())('MCP stub client: look, act gather oak_log, wait', () => {
  it('wakes the Body from any presence state, answers look, takes an act, and each wait returns within its bound until the intent ends', async () => {
    const client = await connectAs(TEST_PLAYER, readTokenFile('GELDAR_MCP_TEST_TOKEN_FILE'));
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names, `tools seen: ${names.join(', ')}`).toEqual(
        expect.arrayContaining(['look', 'act', 'wait']),
      );

      // A hibernated life answers body_unavailable until the Body is up; that is the wake signal here only.
      await waitForWake({
        attempt: async () => attemptOf(await client.callTool(lookCall())),
        clock: {
          now: () => Date.now(),
          sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
        },
        describeState: presenceState,
      });

      const looked = await client.callTool(lookCall());
      expect(looked.isError, `look failed: ${JSON.stringify(looked).slice(0, 300)}`).not.toBe(true);

      const acted = await client.callTool(actCall());
      expect(acted.isError, `act failed: ${JSON.stringify(acted).slice(0, 300)}`).not.toBe(true);

      let cursor: unknown;
      let ended = false;
      for (let step = 0; step < WAIT_STEPS && !ended; step += 1) {
        const started = Date.now();
        const waited = await client.callTool(waitCall(cursor));
        const elapsed = Date.now() - started;
        expect(waited.isError, `wait failed: ${JSON.stringify(waited).slice(0, 300)}`).not.toBe(
          true,
        );
        expect(
          elapsed,
          `wait ${step} ran ${elapsed} ms, past its ${WAIT_SECONDS} s bound`,
        ).toBeLessThanOrEqual((WAIT_SECONDS + 10) * 1000);
        const structured = waited.structuredContent as
          | { cursor?: unknown; wake_reason?: string }
          | undefined;
        cursor = structured?.cursor ?? cursor;
        ended = ENDS.includes(structured?.wake_reason ?? '');
      }
      expect(ended, 'the intent did not end within the bounded waits').toBe(true);
    } finally {
      await client.close();
    }
  }, 420_000);
});
