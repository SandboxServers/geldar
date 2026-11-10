import { callTool, type FakeClock, type ToolContext, type ToolHandlers } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import type { FakeJournalStore, RecordingCallRecorder } from './fakes/stores.fakes.ts';
import {
  type FakeBody,
  type MemoryPresenceBucket,
  NO_BOOK,
  worldFixture,
} from './fakes/world.fakes.ts';
import type { PlayerRecord } from './ports.ts';
import { WORLD_TEXT_NOTE } from './tools/look.ts';
import { NOT_AVAILABLE_MESSAGE } from './tools/unavailable.ts';
import { createWorld } from './world.ts';

const GOTO = { do: 'goto', target: { x: 1, y: 64, z: 1 } };

const PLAYER: PlayerRecord = {
  playerId: 'ag-ranger-01',
  lifeId: 'ag_ranger_01',
  ownerId: 'owner_01',
  displayName: 'Jason',
  harness: 'claude-code',
  status: 'active',
};
const OTHER: PlayerRecord = { ...PLAYER, playerId: 'ag-other-01', lifeId: 'ag_other_01' };
const UNAVAILABLE = [
  'write_book',
  'define_skill',
  'use_skill',
  'offer',
  'propose',
  'vote',
] as const;
/** Inputs the mock's schema accepts for each stubbed tool, so the handler is reached. */
const VALID_INPUT: Record<string, unknown> = {
  write_book: { title: 'Log', text: 'Dusk.' },
  define_skill: { name: 'shout', description: 'Shout.', code: 'return 1;' },
  use_skill: { name: 'shout', args: {} },
  offer: { item: 'stone', count: 1 },
  propose: { rule: 'quiet_hours', value: 'night', reason: 'Too loud.' },
  vote: { proposal_id: 'pr_1', vote: 'yes' },
  act: { say: 'Hi.' },
  say: { text: 'Hi.' },
  wait: { max_seconds: 30 },
};

interface Rig {
  tools: ToolHandlers;
  body: FakeBody;
  journal: FakeJournalStore;
  recorder: RecordingCallRecorder;
}

function rig(): Rig {
  const fx = worldFixture([PLAYER, OTHER]);
  fx.budget.seed(PLAYER.lifeId, 37, 0);
  return {
    tools: createWorld(fx.deps).tools,
    body: fx.body,
    journal: fx.journal,
    recorder: fx.recorder,
  };
}

function ctx(playerId = PLAYER.playerId): ToolContext {
  return { playerId, signal: new AbortController().signal };
}

/** Runs one tool through the mock's registry, so input and result validation apply. */
async function run(tools: ToolHandlers, name: string, args: unknown = {}, playerId?: string) {
  const response = await callTool(tools, name, args, ctx(playerId));
  return { isError: response.isError === true, text: response.content[0]?.text ?? '' };
}

describe('the read-only handlers', () => {
  it('answers look with a fresh snapshot and the world text note', async () => {
    const { tools } = rig();
    const reply = await run(tools, 'look');
    expect(reply.isError, reply.text).toBe(false);
    const body = JSON.parse(reply.text) as { note: string; snapshot: unknown };
    expect(body.note).toBe(WORLD_TEXT_NOTE);
    expect(body.snapshot).toBeDefined();
  });

  it('answers status with the budget and the days since sleep', async () => {
    const { tools } = rig();
    const reply = await run(tools, 'status');
    expect(reply.isError, reply.text).toBe(false);
    const body = JSON.parse(reply.text) as Record<string, number>;
    expect(body.budget_remaining_thoughts).toBe(37);
    expect(typeof body.days_alive).toBe('number');
    expect(typeof body.days_since_sleep).toBe('number');
  });

  it('mirrors a journal line and records one journal call', async () => {
    const { tools, journal, recorder } = rig();
    const reply = await run(tools, 'journal', { text: 'Dusk.' });
    expect(reply.isError, reply.text).toBe(false);
    expect(JSON.parse(reply.text)).toEqual({ ok: true, mirrored_chars: 5 });
    expect((await journal.recent(PLAYER.lifeId, 10)).map((e) => e.text)).toEqual(['Dusk.']);
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]).toMatchObject({ tool: 'journal', outcome: 'ok', journal: 'Dusk.' });
  });

  it('returns the held book under untrusted_world_text, never in a typed field', async () => {
    const { tools, body } = rig();
    body.setBook(PLAYER.lifeId, { status: 'ok', title: 'Log', author: 'Billy', text: 'Canary-7' });
    const reply = await run(tools, 'read_book');
    expect(reply.isError, reply.text).toBe(false);
    const parsed = JSON.parse(reply.text) as { book_id: string; untrusted_world_text: unknown };
    expect(parsed.book_id).toMatch(/^bk_[a-f0-9]{26}$/);
    expect(parsed.untrusted_world_text).toEqual({ book: { title: 'Log', text: 'Canary-7' } });
    expect(reply.text).not.toContain('Billy');
  });

  it('answers a book-less Body with no_book as a tool error', async () => {
    const { tools, body } = rig();
    body.setBook(PLAYER.lifeId, NO_BOOK);
    const reply = await run(tools, 'read_book');
    expect(reply.isError).toBe(true);
    expect(reply.text.startsWith('no_book: ')).toBe(true);
  });

  it('answers a Body that does not answer with body_unavailable and no old view', async () => {
    const { tools, body } = rig();
    body.setOffline(PLAYER.lifeId, true);
    const reply = await run(tools, 'look');
    expect(reply.isError).toBe(true);
    expect(reply.text.startsWith('body_unavailable: ')).toBe(true);
  });
});

describe('the unavailable tools', () => {
  it.each(UNAVAILABLE)(
    'answers %s with the fixed not_available message and records it',
    async (name) => {
      const { tools, recorder } = rig();
      const reply = await run(tools, name, VALID_INPUT[name]);
      expect(reply.isError).toBe(true);
      expect(reply.text).toBe(`not_available: ${NOT_AVAILABLE_MESSAGE}`);
      expect(recorder.calls.at(-1)).toMatchObject({
        tool: name,
        outcome: 'rejected',
        credits_charged: 0,
      });
    },
  );
});

describe('the player comes from the bound session', () => {
  it('ignores another player id in the arguments and writes to the bound life only', async () => {
    const { tools, journal } = rig();
    const reply = await run(
      tools,
      'journal',
      { text: 'Dusk.', player_id: OTHER.playerId },
      PLAYER.playerId,
    );
    // The schema may refuse the extra key; either way nothing lands on the other life.
    if (!reply.isError) {
      expect((await journal.recent(PLAYER.lifeId, 10)).map((e) => e.text)).toEqual(['Dusk.']);
    }
    expect(await journal.recent(OTHER.lifeId, 10)).toEqual([]);
  });

  it('calls the handler with the bound id even when the arguments name another player', async () => {
    const { tools, journal } = rig();
    await tools.journal({ text: 'Dusk.', player_id: OTHER.playerId }, ctx(PLAYER.playerId));
    expect(await journal.recent(OTHER.lifeId, 10)).toEqual([]);
    expect((await journal.recent(PLAYER.lifeId, 10)).map((e) => e.text)).toEqual(['Dusk.']);
  });

  it('refuses a session whose bound player is not in the directory', async () => {
    const { tools } = rig();
    const reply = await run(tools, 'look', {}, 'ag-nobody-01');
    expect(reply.isError).toBe(true);
    expect(reply.text.startsWith('unknown_player: ')).toBe(true);
  });
});

/** A world over both players, with PLAYER's budget seeded; the world's handlers are `tools`. */
function wired() {
  const fx = worldFixture([PLAYER, OTHER]);
  fx.budget.seed(PLAYER.lifeId, 37, 0);
  const world = createWorld(fx.deps);
  return { ...fx, world, tools: world.tools };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Moves the fake clock one second at a time, letting each step's timers and handlers run first. */
async function passSeconds(clock: FakeClock, seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i++) {
    await flush();
    await clock.advance(1000);
  }
  await flush();
}

/** The presence record the bucket holds for a life, as the Body and the settle timer leave it. */
function storedPresence(bucket: MemoryPresenceBucket, lifeId: string) {
  const value = bucket.values.get(lifeId);
  if (value === undefined) throw new Error(`no presence record for ${lifeId}`);
  return JSON.parse(value) as { state: string; desired_body: string };
}

describe('the bound life is the only one a handler reaches', () => {
  it.each(['look', 'status'])('answers %s from the bound life Body, not another', async (name) => {
    const { tools, body } = wired();
    body.setOffline(OTHER.lifeId, true);
    const reply = await run(tools, name);
    expect(reply.isError, reply.text).toBe(false);
  });

  it('sends an act to the bound life even when the arguments name another player', async () => {
    const { tools, body } = wired();
    await tools.act({ reasoning: 'ok', actions: [GOTO] }, ctx(PLAYER.playerId));
    // The act schema refuses the extra key, so this one submits nothing.
    const other = await tools.act(
      { reasoning: 'ok', actions: [GOTO], player_id: OTHER.playerId },
      ctx(PLAYER.playerId),
    );
    expect(other).toMatchObject({ accepted: [] });
    expect(body.plans.map((p) => p.lifeId)).toEqual([PLAYER.lifeId]);
  });

  it('answers an act with a Body that does not answer with body_unavailable', async () => {
    const { tools, body } = wired();
    body.setOffline(PLAYER.lifeId, true);
    const reply = await run(tools, 'act', { reasoning: 'ok', actions: [GOTO] });
    expect(reply.isError).toBe(true);
    expect(reply.text.startsWith('body_unavailable: ')).toBe(true);
  });
});

describe('the wait poll keeps the life awake', () => {
  it('touches the bound life presence on each poll', async () => {
    const { tools, bucket, clock } = wired();
    const waiting = run(tools, 'wait', { max_seconds: 5 }, PLAYER.playerId);
    await passSeconds(clock, 5);
    const reply = await waiting;
    expect(reply.isError, reply.text).toBe(false);
    const touches = bucket.puts.filter((put) => put.key === PLAYER.lifeId);
    expect(touches.length).toBeGreaterThan(1);
    expect(bucket.puts.every((put) => put.key === PLAYER.lifeId)).toBe(true);
  });
});

describe('the settle timer', () => {
  it('dims an awake life after a minute and hibernates it after ten, on the injected clock', async () => {
    const { world, tools, bucket, clock, deps } = wired();
    await run(tools, 'look');
    await deps.presence.wantBody(PLAYER.lifeId, clock.nowMs());
    await passSeconds(clock, 60);
    expect(storedPresence(bucket, PLAYER.lifeId)).toMatchObject({
      state: 'dim',
      desired_body: 'up',
    });
    await passSeconds(clock, 540);
    expect(storedPresence(bucket, PLAYER.lifeId)).toMatchObject({
      state: 'hibernating',
      desired_body: 'down',
    });
    world.close();
  });

  it('stops settling once close runs', async () => {
    const { world, tools, bucket, clock, deps } = wired();
    await run(tools, 'look');
    await deps.presence.wantBody(PLAYER.lifeId, clock.nowMs());
    world.close();
    const before = bucket.puts.length;
    await passSeconds(clock, 600);
    expect(bucket.puts.length).toBe(before);
  });
});

describe('every bound call keeps the presence right', () => {
  it('keeps an act-only player awake for 10 minutes, with no wait', async () => {
    const { world, tools, bucket, clock } = wired();
    for (let i = 0; i < 20; i++) {
      await run(tools, 'act', { reasoning: 'ok', actions: [GOTO] });
      await passSeconds(clock, 30);
      expect(storedPresence(bucket, PLAYER.lifeId)).toMatchObject({ state: 'awake', desired_body: 'up' });
    }
    world.close();
  });

  it('a look on a down Body leaves the life wanting its Body up', async () => {
    const { world, tools, bucket, clock, deps, body } = wired();
    await run(tools, 'look');
    await passSeconds(clock, 700);
    expect(storedPresence(bucket, PLAYER.lifeId)).toMatchObject({ desired_body: 'down' });
    body.setOffline(PLAYER.lifeId, true);
    const reply = await run(tools, 'look');
    expect(reply.text.startsWith('body_unavailable: ')).toBe(true);
    expect(storedPresence(bucket, PLAYER.lifeId)).toMatchObject({ state: 'awake', desired_body: 'up' });
    world.close();
  });

  it('a call revives a hibernated life', async () => {
    const { world, tools, bucket, clock, deps } = wired();
    await run(tools, 'look');
    await passSeconds(clock, 700);
    expect(storedPresence(bucket, PLAYER.lifeId)).toMatchObject({ state: 'hibernating' });
    await run(tools, 'status');
    expect(storedPresence(bucket, PLAYER.lifeId)).toMatchObject({ state: 'awake', desired_body: 'up' });
    world.close();
  });
});