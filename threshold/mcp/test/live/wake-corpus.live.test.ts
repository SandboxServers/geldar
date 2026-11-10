/**
 * Live cases (d) and (e) of WM-12: the chatter bot's "Jason, hello" wakes `wait` as directly_addressed, and the
 * corpus books reach the test life only through untrusted_world_text. Written, not run.
 * Gate: GELDAR_IT=1 GELDAR_MCP_LIVE=1. Run with `./geldar.ps1 pnpm --dir threshold/mcp exec vitest run test/live/wake-corpus.live.test.ts`.
 * Operator steps come from env, so no host or RCON secret is in the repo:
 *   GELDAR_LIVE_CHATTER_SAY   makes the chatter bot say "Jason, hello" near ag-test-01.
 *   GELDAR_LIVE_CORPUS_GIVE   gives the test life the MB books (RCON), each with a canary line.
 *   GELDAR_LIVE_CORPUS_CLEAR  (optional) removes those books at the end.
 *   GELDAR_LIVE_CANARY        the canary text the corpus books carry (checked, never printed).
 * The test player's token: GELDAR_MCP_TEST_TOKEN_FILE. Each step is bounded; no model chooses what happens.
 */
import { describe, expect, it } from 'vitest';
import { connectAs, operatorStep, readTokenFile, structuredOf, TEST_PLAYER } from './client.ts';
import { liveEnabled } from './gate.ts';

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

describe.skipIf(!liveEnabled())('wake on direct address (d) and the corpus canary (e)', () => {
  it('(d) the chatter says "Jason, hello" and wait returns directly_addressed', async () => {
    const client = await connectAs(TEST_PLAYER, readTokenFile('GELDAR_MCP_TEST_TOKEN_FILE'));
    try {
      const pending = client.callTool({
        name: 'wait',
        arguments: { max_seconds: 25, interests: ['directly_addressed'] },
      });
      // The chatter goes after the wait is parked on the server, so the wake is not a race with the call.
      await sleep(2_000);
      operatorStep('GELDAR_LIVE_CHATTER_SAY');
      const waited = await pending;
      expect(waited.isError, `wait failed: ${JSON.stringify(waited).slice(0, 300)}`).not.toBe(true);
      expect(structuredOf(waited).wake_reason).toBe('directly_addressed');
    } finally {
      await client.close();
    }
  }, 60_000);

  it('(e) a canary from a corpus book appears only under untrusted_world_text', async () => {
    const canary = process.env.GELDAR_LIVE_CANARY;
    if (canary === undefined || canary.trim() === '') {
      throw new Error('GELDAR_LIVE_CANARY is not set: give the canary text the corpus books carry');
    }
    const client = await connectAs(TEST_PLAYER, readTokenFile('GELDAR_MCP_TEST_TOKEN_FILE'));
    try {
      operatorStep('GELDAR_LIVE_CORPUS_GIVE');
      const read = await client.callTool({ name: 'read_book', arguments: {} });
      expect(read.isError, `read_book failed: ${JSON.stringify(read).slice(0, 300)}`).not.toBe(
        true,
      );
      const { untrusted_world_text: untrusted, ...rest } = structuredOf(read);
      expect(JSON.stringify(untrusted), 'canary missing from untrusted_world_text').toContain(
        canary,
      );
      expect(JSON.stringify(rest), 'canary leaked outside untrusted_world_text').not.toContain(
        canary,
      );
    } finally {
      await client.close();
      if (process.env.GELDAR_LIVE_CORPUS_CLEAR !== undefined)
        operatorStep('GELDAR_LIVE_CORPUS_CLEAR');
    }
  }, 120_000);
});
