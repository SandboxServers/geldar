import { callTool, type ToolContext } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { worldFixture } from './fakes/world.fakes.ts';
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

const CANARY = 'Canary-7 secret words';

/** A world whose deps log into `lines`, with an optional logger that throws instead. */
function rig(logger: (line: Record<string, unknown>) => void) {
  const fx = worldFixture([PLAYER]);
  fx.budget.seed(PLAYER.lifeId, 37, 0);
  return createWorld({ ...fx.deps, log: logger }).tools;
}

function ctx(playerId = PLAYER.playerId): ToolContext {
  return { playerId, signal: new AbortController().signal };
}

describe('the tool_call log', () => {
  it('logs one tool_call line for a call, with the tool, the player, the outcome and a duration', async () => {
    const lines: Record<string, unknown>[] = [];
    const tools = rig((line) => lines.push(line));
    const response = await callTool(tools, 'look', {}, ctx());
    expect(response.isError).not.toBe(true);
    const calls = lines.filter((line) => line.event === 'tool_call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      event: 'tool_call',
      player_id: PLAYER.playerId,
      tool: 'look',
      outcome: 'ok',
      duration_ms: expect.any(Number),
    });
  });

  it('logs a failed call with its closed outcome code', async () => {
    const lines: Record<string, unknown>[] = [];
    const tools = rig((line) => lines.push(line));
    const response = await callTool(tools, 'look', {}, ctx('ag-nobody-01'));
    expect(response.isError).toBe(true);
    const calls = lines.filter((line) => line.event === 'tool_call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tool: 'look', outcome: 'unknown_player' });
  });

  it('never logs the arguments or the text a call carries', async () => {
    const lines: Record<string, unknown>[] = [];
    const tools = rig((line) => lines.push(line));
    await callTool(tools, 'journal', { text: CANARY }, ctx());
    const logged = JSON.stringify(lines);
    expect(lines.some((line) => line.event === 'tool_call')).toBe(true);
    expect(logged).not.toContain('Canary');
    expect(logged).not.toContain('secret');
  });

  it('does not fail the call when the logger throws', async () => {
    const tools = rig(() => {
      throw new Error('log sink is down');
    });
    const response = await callTool(tools, 'look', {}, ctx());
    expect(response.isError).not.toBe(true);
  });
});
