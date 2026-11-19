import { describe, expect, it } from 'vitest';
import type { ProgramCheckpoint, ProgramContext } from '../program.ts';
import { ExploreProgram } from './explore.ts';
import { contextFor, newWorld } from './programs.fakes.ts';

/** A context in which every column is loaded and no block is solid. */
function openContext(): ProgramContext {
  const ctx = contextFor(newWorld());
  Object.assign(ctx.bot, { world: { getColumn: () => ({}) }, blockAt: () => undefined });
  return ctx;
}

/** A valid checkpoint at the origin chunk, with the given fields replaced. */
function checkpointWith(overrides: Record<string, unknown>): ProgramCheckpoint {
  return {
    legs_done: 0,
    legs: 6,
    leg_blocks: 24,
    avoid_water: true,
    chunks_new: 0,
    visited: [[0, 0]],
    heading: null,
    ...overrides,
  };
}

describe('ExploreProgram resume validation', () => {
  it.each([
    [{ heading: 'x' }],
    [{ legs_done: 13 }],
    [{ legs_done: -1 }],
    [{ chunks_new: 13 }],
    [{ legs: 0 }],
    [{ leg_blocks: 7 }],
    [{ leg_blocks: 49 }],
    [{ avoid_water: 'yes' }],
    [{ visited: [[0]] }],
    [{ visited: [[0.5, 0]] }],
  ])('rejects checkpoint %j on resume', async (overrides) => {
    const ctx = openContext();
    await expect(new ExploreProgram().resume(checkpointWith(overrides), ctx)).rejects.toThrow();
  });

  it('a checkpoint taken before a step does not change when the step runs', async () => {
    const ctx = openContext();
    const program = new ExploreProgram();
    await program.start({ legs: 2 }, ctx);
    const before = program.checkpoint();
    const snapshot = JSON.stringify(before);
    await program.step(ctx);
    expect(program.checkpoint()?.visited).toHaveLength(2);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
