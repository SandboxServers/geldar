/**
 * Live cases (f), (g) and (h) of WM-12: revoke during a wait then 401, kill a ranger Body mid-intent, and
 * hibernation then a call that brings the Body back. Written, not run. Destructive to the named players only.
 * Gate: GELDAR_IT=1 GELDAR_MCP_LIVE=1. Run with `./geldar.ps1 pnpm --dir threshold/mcp exec vitest run test/live/revoke-kill-hibernate.live.test.ts`.
 * Env (outside the repo, the operator's): GELDAR_LIVE_REVOKE_PLAYER, GELDAR_LIVE_REVOKE_TOKEN_FILE and
 * GELDAR_LIVE_REVOKE_TOKEN_ID (a throwaway player and its token, so the test token is not revoked);
 * GELDAR_LIVE_RANGER and GELDAR_LIVE_RANGER_TOKEN_FILE (one ranger for g and h). The hibernation case needs the
 * override of 60 s set by the operator. Each run uses a unique goal name, and the cases wait in bounded steps.
 * Presence reads NATS: `./geldar.ps1 players status` defaults GELDAR_NATS_URL to nats://127.0.0.1:4222 when it is unset.
 */
import { describe, expect, it } from 'vitest';
import { connectAs, geldar, readTokenFile, runId, structuredOf } from './client.ts';
import { liveEnabled } from './gate.ts';
import { assertTestPlayer } from './guards.ts';

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') throw new Error(`${name} is not set`);
  return value.trim();
};
/** The presence state `players status` prints for one ranger ('awake', 'dim', 'hibernating'), or undefined. */
const presenceOf = (status: string, id: string): string | undefined =>
  status
    .split('\n')
    .find((line) => line.trimStart().startsWith(id))
    ?.match(/presence: (\w+)/)?.[1];

describe.skipIf(!liveEnabled())('revoke (f), kill mid-intent (g), hibernate (h)', () => {
  it('(f) a revoke during a wait ends the wait, and the next call with that token is a 401', async () => {
    const player = assertTestPlayer(env('GELDAR_LIVE_REVOKE_PLAYER'));
    const tokenId = env('GELDAR_LIVE_REVOKE_TOKEN_ID');
    const token = readTokenFile('GELDAR_LIVE_REVOKE_TOKEN_FILE');
    const client = await connectAs(player, token);
    try {
      const pending = client.callTool({ name: 'wait', arguments: { max_seconds: 25 } }).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      await sleep(2_000);
      geldar('mcp-tokens', 'token', 'revoke', tokenId);
      const outcome = await Promise.race([pending, sleep(35_000).then(() => 'hung' as const)]);
      expect(outcome, 'the wait did not end after the revoke').not.toBe('hung');
    } finally {
      await client.close().catch(() => undefined);
    }
    const again = connectAs(player, token);
    await expect(again).rejects.toThrow(/401/);
  }, 120_000);

  it('(g) a ranger Body killed mid-intent comes back at generation +1, and the next act is accepted', async () => {
    const ranger = assertTestPlayer(env('GELDAR_LIVE_RANGER'));
    const client = await connectAs(ranger, readTokenFile('GELDAR_LIVE_RANGER_TOKEN_FILE'));
    const goal = `gather_kill_${runId()}`;
    try {
      const first = await client.callTool({
        name: 'act',
        arguments: {
          reasoning: 'kill case',
          intent: {
            goal,
            program: 'gather',
            arguments: { block: 'oak_log', count: 4 },
            wake_on: [],
          },
        },
      });
      expect(first.isError, 'the first act failed').not.toBe(true);
      const before = structuredOf(await client.callTool({ name: 'look', arguments: {} }))
        .snapshot as { generation?: number } | undefined;

      geldar('players', 'down', '--player', ranger);
      geldar('players', 'up', '--player', ranger);

      const waited = await client.callTool({ name: 'wait', arguments: { max_seconds: 30 } });
      expect(waited.isError, 'the wait after the restart failed').not.toBe(true);
      const after = structuredOf(waited).snapshot as { generation?: number } | undefined;
      if (typeof before?.generation === 'number' && typeof after?.generation === 'number') {
        expect(after.generation).toBe(before.generation + 1);
      }

      const next = await client.callTool({
        name: 'act',
        arguments: {
          reasoning: 'kill case, next act',
          intent: { goal: `${goal}_next`, program: 'rest', arguments: {}, wake_on: [] },
        },
      });
      expect(structuredOf(next).accepted, 'the next act was not accepted').toContain(0);
    } finally {
      await client.close().catch(() => undefined);
    }
  }, 300_000);

  it('(h) after hibernation the next call brings the Body back within 20 s', async () => {
    const ranger = assertTestPlayer(env('GELDAR_LIVE_RANGER'));
    const client = await connectAs(ranger, readTokenFile('GELDAR_LIVE_RANGER_TOKEN_FILE'));
    try {
      // The lease lapses on its own (override 60 s). The Body process stays up while hibernating, so poll the
      // presence record that `players status` prints, not the process.
      const deadline = Date.now() + 240_000;
      while (presenceOf(geldar('players', 'status'), ranger) !== 'hibernating') {
        expect(Date.now(), 'the presence never reached hibernating').toBeLessThan(deadline);
        await sleep(5_000);
      }
      const started = Date.now();
      const looked = await client.callTool({ name: 'look', arguments: {} });
      const elapsed = Date.now() - started;
      expect(looked.isError, 'look after hibernation failed').not.toBe(true);
      expect(elapsed, `look took ${elapsed} ms to wake the Body`).toBeLessThanOrEqual(20_000);
    } finally {
      await client.close().catch(() => undefined);
    }
  }, 600_000);
});
