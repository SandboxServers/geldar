import { callTool, type FakeClock, type ToolContext, ToolError } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { worldFixture } from './fakes/world.fakes.ts';
import { BodyUnavailable, type PlayerRecord } from './ports.ts';
import { BODY_AWAKE_TEXT } from './tools/wait.ts';
import { BODY_RETRY_AFTER_S, BODY_UNAVAILABLE_MESSAGE, createWorld } from './world.ts';

const PLAYER: PlayerRecord = {
  playerId: 'ag-ranger-01',
  lifeId: 'ag_ranger_01',
  ownerId: 'owner_01',
  displayName: 'Jason',
  harness: 'claude-code',
  status: 'active',
};

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function rig(log?: (line: Record<string, unknown>) => void) {
  const fx = worldFixture([PLAYER]);
  fx.budget.seed(PLAYER.lifeId, 37, 0);
  const deps = log === undefined ? fx.deps : { ...fx.deps, log };
  const world = createWorld(deps);
  const clock = fx.deps.clock as FakeClock;
  return { tools: world.tools, body: fx.body, clock };
}

function ctxOf(signal = new AbortController().signal): ToolContext {
  return { playerId: PLAYER.playerId, signal };
}

async function advance(clock: FakeClock, seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i++) {
    await flush();
    await clock.advance(1000);
  }
  await flush();
}

describe('wait with a waking body', () => {
  it('holds, then returns normally with a plain line when the body becomes ready', async () => {
    const { tools, body, clock } = rig();
    body.setOffline(PLAYER.lifeId, true);
    const pending = callTool(tools, 'wait', { max_seconds: 60 }, ctxOf());
    await advance(clock, 3);
    body.setOffline(PLAYER.lifeId, false);
    await advance(clock, 2);
    const reply = await pending;
    expect(reply.isError).not.toBe(true);
    const first = reply.content[0];
    const text = first?.type === 'text' ? first.text : '';
    const result = JSON.parse(text) as { events: { text: string }[] };
    expect(result.events.map((e) => e.text)).toContain(BODY_AWAKE_TEXT);
  });

  it('times out cleanly with the waking words when the body never comes', async () => {
    const { tools, body, clock } = rig();
    body.setOffline(PLAYER.lifeId, true);
    const pending = callTool(tools, 'wait', { max_seconds: 5 }, ctxOf());
    await advance(clock, 7);
    const reply = await pending;
    expect(reply.isError).toBe(true);
    const first = reply.content[0];
    expect(first?.type === 'text' ? first.text : '').toBe(
      `body_unavailable: ${BODY_UNAVAILABLE_MESSAGE}`,
    );
  });

  it('ends with session_superseded when the session aborts during the hold', async () => {
    const { tools, body, clock } = rig();
    body.setOffline(PLAYER.lifeId, true);
    const abort = new AbortController();
    const pending = callTool(tools, 'wait', { max_seconds: 60 }, ctxOf(abort.signal));
    await advance(clock, 2);
    abort.abort();
    await advance(clock, 2);
    const reply = await pending;
    const first = reply.content[0];
    expect(first?.type === 'text' ? first.text : '').toMatch(/^session_superseded: /);
  });
});

describe('transient errors', () => {
  it('carries retry_after_s on body_unavailable and says it in words', async () => {
    const { tools, body } = rig();
    body.setOffline(PLAYER.lifeId, true);
    const err = await (async () => tools.look({}, ctxOf()))().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).retryAfterS).toBe(BODY_RETRY_AFTER_S);
    expect((err as ToolError).message).toContain(`about ${BODY_RETRY_AFTER_S} seconds`);
  });

  it('looks again at call time: a body that came up during the call is not called waking', async () => {
    const { tools, body } = rig();
    const real = body.snapshot.bind(body);
    let calls = 0;
    body.snapshot = async (lifeId: string) => {
      calls += 1;
      if (calls === 1) throw new BodyUnavailable('waking');
      return real(lifeId);
    };
    const reply = await callTool(tools, 'look', {}, ctxOf());
    expect(reply.isError).not.toBe(true);
    expect(calls).toBe(3);
  });
});

describe('session end log', () => {
  it('logs the last tool and outcome code when the session ends, only to the operator log', async () => {
    const lines: Record<string, unknown>[] = [];
    const { tools, body } = rig((line) => lines.push(line));
    const abort = new AbortController();
    body.setOffline(PLAYER.lifeId, true);
    const reply = await callTool(tools, 'look', {}, ctxOf(abort.signal));
    abort.abort();
    expect(lines).toContainEqual({
      event: 'session_end',
      player_id: PLAYER.playerId,
      tool: 'look',
      outcome: 'body_unavailable',
    });
    expect(JSON.stringify(reply)).not.toContain('session_end');
  });
});
