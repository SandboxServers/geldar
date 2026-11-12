import { callTool, type ToolContext, type ToolHandlers } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { type FakeBody, worldFixture } from './fakes/world.fakes.ts';
import type { PlayerRecord } from './ports.ts';
import { createWorld } from './world.ts';

const PLAYER: PlayerRecord = {
  playerId: 'ag-ranger-01',
  lifeId: 'ag_ranger_01',
  ownerId: 'owner_01',
  displayName: 'Jason',
  harness: 'claude-code',
  status: 'active',
};

/** Inputs the mock's schema accepts for each tool, so the handler is reached. */
const VALID_INPUT: Record<string, unknown> = {
  act: { say: 'Hi.' },
  say: { text: 'Hi.' },
  wait: { max_seconds: 30 },
  journal: { text: 'Dusk.' },
  view: {},
  write_book: { title: 'Log', text: 'Dusk.' },
  define_skill: { name: 'shout', description: 'Shout.', code: 'return 1;' },
  use_skill: { name: 'shout', args: {} },
  offer: { item: 'stone', count: 1 },
  propose: { rule: 'quiet_hours', value: 'night', reason: 'Too loud.' },
  vote: { proposal_id: 'pr_1', vote: 'yes' },
};

/** Runs one tool through the mock's dispatcher: input and result validation apply, as in production. */
async function dispatch(tools: ToolHandlers, name: string, args: unknown = {}) {
  const signal = new AbortController().signal;
  const ctx: ToolContext = { playerId: PLAYER.playerId, signal };
  const response = await callTool(tools, name, args, ctx);
  const first = response.content[0];
  return { isError: response.isError === true, text: first?.type === 'text' ? first.text : '' };
}

/** A world whose one bound life has its Body up or down, through the mock's dispatcher. */
function world(body?: (fake: FakeBody) => void) {
  const fx = worldFixture([PLAYER]);
  body?.(fx.body);
  return createWorld(fx.deps).tools;
}

describe('a Body that does not answer is a typed error, never invalid_output', () => {
  it('answers every registered tool with a typed reply when the Body is offline', async () => {
    const fx = worldFixture([PLAYER]);
    fx.body.setOffline(PLAYER.lifeId, true);
    const tools = createWorld(fx.deps).tools;
    // `wait` holds its own offline test (wait.test.ts): it parks on the stream, so it is not walked here.
    for (const name of Object.keys(tools).filter((tool) => tool !== 'wait')) {
      const reply = await dispatch(tools, name, VALID_INPUT[name]);
      expect(reply.text, name).not.toMatch(/^invalid_output/);
      expect(reply.text, name).not.toMatch(/^internal_error/);
    }
  });

  it('answers view with body_unavailable when the Body is offline', async () => {
    const tools = world((body) => body.setOffline(PLAYER.lifeId, true));
    const reply = await dispatch(tools, 'view', {});
    expect(reply.isError).toBe(true);
    expect(reply.text.startsWith('body_unavailable: ')).toBe(true);
  });

  it('answers view with body_unavailable when the Body replies {error:"unavailable"}', async () => {
    const tools = world((body) => {
      const refused: FakeBody['view'] = async () => ({ error: 'unavailable' });
      body.view = refused;
    });
    const reply = await dispatch(tools, 'view', {});
    expect(reply.isError).toBe(true);
    expect(reply.text.startsWith('body_unavailable: ')).toBe(true);
  });

  it('answers look with body_unavailable when the Body is offline', async () => {
    const tools = world((body) => body.setOffline(PLAYER.lifeId, true));
    const reply = await dispatch(tools, 'look', {});
    expect(reply.text.startsWith('body_unavailable: ')).toBe(true);
  });

  it('still answers view with the viewport text when the Body is up', async () => {
    const tools = world();
    const reply = await dispatch(tools, 'view', {});
    expect(reply.isError).toBe(false);
    const body = JSON.parse(reply.text) as { text: string };
    expect(body.text).toContain('Open ground');
    expect(Object.keys(body)).toEqual(['text']);
  });
});
