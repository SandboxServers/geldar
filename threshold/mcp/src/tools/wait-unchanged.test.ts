import type { Snapshot, WaitResult } from '@geldar/contract';
import { FakeClock } from '@geldar/mcp-mock';
import { describe, expect, it, vi } from 'vitest';
import { RingEventLog } from '../events/player-log.ts';
import { createWaitState, type WaitDeps, type WaitOutcome, wait } from './wait.ts';
import { parseWaitDeltaLives, WAIT_DELTA_FULL_EVERY } from './wait-delta.ts';

const LIFE = 'ag_jason_01';
const RECIPES = ['oak_planks', 'stick', 'crafting_table'];
const BLOCKS = [{ x: 1, y: 64, z: 2, block: 'furnace', lit: true }];

interface Shown {
  unlocked_recipes: unknown;
  notable_blocks: unknown;
}

/** The sections a result carries, as the play view sends them. */
function shown(result: WaitResult): Shown {
  const snap = result.snapshot as unknown as {
    self: { unlocked_recipes?: unknown };
    surroundings: { notable_blocks?: unknown };
  };
  return {
    unlocked_recipes: snap.self.unlocked_recipes,
    notable_blocks: snap.surroundings.notable_blocks,
  };
}

const UNCHANGED_RECIPES = { unchanged: true, count: RECIPES.length };
const UNCHANGED_BLOCKS = { unchanged: true, count: BLOCKS.length };

/** One rig per test: a body whose recipes and blocks the test sets, and a clock the waits advance. */
function rig(waitDelta: boolean) {
  const clock = new FakeClock(0);
  const body = {
    recipes: [...RECIPES],
    blocks: BLOCKS.map((b) => ({ ...b })),
    position: { x: 10, y: 64, z: -3 },
  };
  const snapshot = async (): Promise<Snapshot> => {
    return {
      world_time: { day: 1, time_of_day: 6000, weather: 'clear' },
      self: { position: { ...body.position }, unlocked_recipes: [...body.recipes] },
      heard: [],
      events_since_last_thought: [],
      surroundings: { notable_blocks: body.blocks.map((b) => ({ ...b })) },
    } as unknown as Snapshot;
  };
  const deps: WaitDeps = {
    clock,
    keepAlive: { start: vi.fn(() => () => undefined) },
    log: new RingEventLog(),
    body: { snapshot: vi.fn(snapshot) },
    budget: { balance: vi.fn(async () => 5) },
    sleeps: { read: vi.fn(async () => ({ lastSleepDay: 1, cursor: 0 })) },
    runs: new Map(),
    config: { minSpacingMs: 0, intentRunTooLongMs: 600_000 },
    state: createWaitState(),
    waitDelta: waitDelta ? parseWaitDeltaLives('all') : undefined,
    pollMs: 1000,
  };
  return { clock, body, deps };
}

/** One `wait` of five seconds with no events: it times out and returns the play view. */
async function waitOnce(
  r: ReturnType<typeof rig>,
  session: string | undefined,
  cursor?: string,
): Promise<WaitResult> {
  const pending = wait(r.deps, {
    lifeId: LIFE,
    session,
    maxSeconds: 5,
    ...(cursor === undefined ? {} : { cursor }),
  });
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    await r.clock.advance(1000);
  }
  const out: WaitOutcome = await pending;
  if (!out.ok) throw new Error(`wait failed: ${out.error}`);
  return out.result;
}

describe('wait with unchanged sections (decision 0221)', () => {
  it('the first wait of a session is full, a second with the same cursor and session is unchanged', async () => {
    const r = rig(true);
    const first = await waitOnce(r, 'session-a');
    expect(shown(first)).toEqual({ unlocked_recipes: RECIPES, notable_blocks: expect.any(Array) });
    const second = await waitOnce(r, 'session-a', first.cursor);
    expect(shown(second)).toEqual({
      unlocked_recipes: UNCHANGED_RECIPES,
      notable_blocks: UNCHANGED_BLOCKS,
    });
  });

  it('a different session id gets a full first wait, even with the same cursor', async () => {
    const r = rig(true);
    const first = await waitOnce(r, 'session-a');
    const other = await waitOnce(r, 'session-b', first.cursor);
    expect(shown(other).unlocked_recipes).toEqual(RECIPES);
    expect(shown(other).notable_blocks).toEqual(expect.any(Array));
  });

  it('with the flag off every wait is full', async () => {
    const r = rig(false);
    const first = await waitOnce(r, 'session-a');
    const second = await waitOnce(r, 'session-a', first.cursor);
    expect(shown(second).unlocked_recipes).toEqual(RECIPES);
    expect(shown(second).notable_blocks).toEqual(expect.any(Array));
  });

  it('a wait with no session id is full', async () => {
    const r = rig(true);
    const first = await waitOnce(r, undefined);
    const second = await waitOnce(r, undefined, first.cursor);
    expect(shown(second).unlocked_recipes).toEqual(RECIPES);
  });

  it('every 10th wait of a session is full again, and the waits between stay unchanged', async () => {
    const r = rig(true);
    let result = await waitOnce(r, 'session-a');
    const unchanged: boolean[] = [];
    for (let n = 2; n <= WAIT_DELTA_FULL_EVERY + 1; n++) {
      result = await waitOnce(r, 'session-a', result.cursor);
      unchanged.push(!Array.isArray(shown(result).unlocked_recipes));
    }
    // waits 2 to 9 are unchanged, wait 10 is full, wait 11 is unchanged again
    expect(unchanged.slice(0, WAIT_DELTA_FULL_EVERY - 2).every(Boolean)).toBe(true);
    expect(unchanged[WAIT_DELTA_FULL_EVERY - 2]).toBe(false);
    expect(unchanged[WAIT_DELTA_FULL_EVERY - 1]).toBe(true);
  });

  it('a recipe unlocked mid-session sends the full recipe list, the blocks stay unchanged', async () => {
    const r = rig(true);
    const first = await waitOnce(r, 'session-a');
    r.body.recipes.push('wooden_pickaxe');
    const second = await waitOnce(r, 'session-a', first.cursor);
    expect(shown(second).unlocked_recipes).toEqual([...RECIPES, 'wooden_pickaxe']);
    expect(shown(second).notable_blocks).toEqual(UNCHANGED_BLOCKS);
  });

  it('a moved agent gets the notable blocks in full, the recipes stay unchanged', async () => {
    const r = rig(true);
    const first = await waitOnce(r, 'session-a');
    r.body.position = { x: 11, y: 64, z: -3 };
    const second = await waitOnce(r, 'session-a', first.cursor);
    expect(shown(second).unlocked_recipes).toEqual(UNCHANGED_RECIPES);
    expect(shown(second).notable_blocks).toEqual(BLOCKS);
  });

  it('two world sessions for the same life have different session ids', async () => {
    const { newSessionId } = await import('../world-session.ts');
    const a = newSessionId();
    const b = newSessionId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  }, 60_000);
});
