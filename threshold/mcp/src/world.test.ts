import { callTool, type ToolContext, type ToolHandlers } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import type { FakeJournalStore, RecordingCallRecorder } from './fakes/stores.fakes.ts';
import { type FakeBody, NO_BOOK, worldFixture } from './fakes/world.fakes.ts';
import type { PlayerRecord } from './ports.ts';
import { WORLD_TEXT_NOTE } from './tools/look.ts';
import { NOT_AVAILABLE_MESSAGE } from './tools/unavailable.ts';
import { createWorld } from './world.ts';

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
