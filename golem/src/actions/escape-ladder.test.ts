import { describe, expect, it } from 'vitest';
import { AIR, block, type State, scriptedBot } from './escape-ladder.fakes.ts';
import { escapeLadder } from './escape-ladder.ts';
import { MAX_LADDERS, moveNear } from './pathing.ts';

const TOWARD = { x: 10.5, z: 0.5 };

function run(fake: ReturnType<typeof scriptedBot>) {
  const lines: Array<Record<string, unknown>> = [];
  const result = escapeLadder(fake.asBot, {
    signal: new AbortController().signal,
    toward: TOWARD,
    sink: { log: (line) => lines.push(JSON.parse(line)), now: () => 0 },
  });
  return { result, lines };
}

const rungs = (lines: Array<Record<string, unknown>>) =>
  lines.filter((l) => l.reason === 'escape_ladder').map((l) => [l.rung, l.worked]);

/** Forward moves east unless a solid block is ahead. */
const walkEast = (s: State): void => {
  if (!s.controls.forward) return;
  if (s.blockAt(s.position.offset(0.6, 0, 0)).boundingBox === 'block') return;
  s.position.x += 0.3;
};

describe('escapeLadder', () => {
  it('rung 1: a plain jump frees the bot and nothing later runs', async () => {
    const fake = scriptedBot({
      physics: (s) => {
        if (s.controls.jump && !s.controls.sprint) s.position.x += 0.5;
      },
    });
    const { result, lines } = run(fake);
    expect(await result).toEqual({ ok: true, rung: 'jump' });
    expect(rungs(lines)).toEqual([['jump', true]]);
    expect(fake.bot.dig).not.toHaveBeenCalled();
  });

  it('rung 2: sprint-jump toward the goal runs only after the plain jump failed', async () => {
    const fake = scriptedBot({
      physics: (s) => {
        if (s.controls.jump && s.controls.sprint && s.controls.forward) s.position.x += 0.5;
      },
    });
    const { result, lines } = run(fake);
    expect(await result).toEqual({ ok: true, rung: 'sprint_jump' });
    expect(rungs(lines)).toEqual([
      ['jump', false],
      ['sprint_jump', true],
    ]);
    expect(fake.bot.lookAt).toHaveBeenCalledWith(expect.objectContaining({ x: 4.5 }), true);
  });

  it('rung 3: digs dirt ahead with bare hands, after jump and sprint-jump fail', async () => {
    const fake = scriptedBot({
      blocks: { '1,64,0': block('dirt'), '1,65,0': AIR },
      physics: walkEast,
    });
    const { result, lines } = run(fake);
    expect(await result).toEqual({ ok: true, rung: 'dig' });
    expect(rungs(lines)).toEqual([
      ['jump', false],
      ['sprint_jump', false],
      ['dig', true],
    ]);
    expect(fake.bot.dig).toHaveBeenCalledTimes(1);
    expect(fake.bot.equip).not.toHaveBeenCalled();
  });

  it('rung 3: equips the best tool before the dig when the inventory has one', async () => {
    const pick = { name: 'wooden_pickaxe' };
    const fake = scriptedBot({
      blocks: { '1,64,0': block('stone', { harvestTools: { 270: true } }) },
      tool: pick,
      physics: walkEast,
    });
    const { result } = run(fake);
    expect(await result).toEqual({ ok: true, rung: 'dig' });
    expect(fake.bot.equip).toHaveBeenCalledWith(pick, 'hand');
    expect(fake.bot.equip.mock.invocationCallOrder[0]).toBeLessThan(
      fake.bot.dig.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('rung 3 refuses stone with no pickaxe, naming the block and the tool class', async () => {
    const fake = scriptedBot({
      blocks: { '1,64,0': block('stone', { harvestTools: { 270: true } }) },
      physics: walkEast,
    });
    const { result, lines } = run(fake);
    const outcome = await result;
    expect(outcome).toMatchObject({ ok: false, reason: 'needs_rescue' });
    expect((outcome as { refusal?: string }).refusal).toMatch(/^stone needs a pickaxe/);
    expect(fake.bot.dig).not.toHaveBeenCalled();
    expect(lines.find((l) => l.rung === 'dig')).toMatchObject({ worked: false });
  });

  it('rung 4: places a held block under the feet and climbs; needs_rescue only after it fails', async () => {
    const fake = scriptedBot({
      items: ['dirt'],
      blocks: { '0,63,0': block('stone') },
      physics: (s) => {
        if (s.held && s.controls.jump && !fake.bot.placeBlock.mock.calls.length)
          s.position.y += 0.3;
        if (fake.bot.placeBlock.mock.calls.length) s.position.y = 65;
      },
    });
    const { result, lines } = run(fake);
    expect(await result).toEqual({ ok: true, rung: 'pillar' });
    expect(rungs(lines).map(([r]) => r)).toEqual(['jump', 'sprint_jump', 'dig', 'pillar']);
    expect(fake.bot.equip).toHaveBeenCalledWith({ name: 'dirt', count: 1 }, 'hand');
    expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
  });

  it('returns a typed needs_rescue with facts only when every rung fails', async () => {
    const fake = scriptedBot({});
    const { result, lines } = run(fake);
    expect(await result).toEqual({
      ok: false,
      reason: 'needs_rescue',
      message: 'no way out: tried jump, sprint_jump, dig, pillar',
    });
    expect(rungs(lines)).toHaveLength(4);
  });

  it('water exit: holds jump to swim up, then jumps toward the nearest ledge, before any dig', async () => {
    let up = 0;
    const fake = scriptedBot({
      water: true,
      blocks: { '1,64,0': block('sandstone'), '0,63,0': block('water') },
      physics: (s) => {
        if (s.controls.jump && s.entity.isInWater && ++up >= 3) {
          s.entity.isInWater = false;
          s.position.y = 65;
        }
        if (s.controls.forward && !s.entity.isInWater) s.position.x += 0.4;
      },
    });
    const { result, lines } = run(fake);
    expect(await result).toEqual({ ok: true, rung: 'water_exit' });
    expect(rungs(lines)).toEqual([['water_exit', true]]);
    expect(fake.bot.dig).not.toHaveBeenCalled();
    expect(fake.bot.setControlState.mock.calls[0]).toEqual(['jump', true]);
    // It looked east, toward the ledge cell, not at the goal-less default.
    expect(fake.bot.lookAt).toHaveBeenCalledWith(expect.objectContaining({ x: 4.5 }), true);
  });

  it('stops at once when the signal is already aborted', async () => {
    const fake = scriptedBot({});
    const controller = new AbortController();
    controller.abort();
    const out = await escapeLadder(fake.asBot, {
      signal: controller.signal,
      toward: TOWARD,
      sink: { log: () => undefined, now: () => 0 },
    });
    expect(out.ok).toBe(false);
    expect(fake.bot.setControlState).not.toHaveBeenCalled();
  });
});

describe('moveNear with the ladder', () => {
  function stuckInWater() {
    const fake = scriptedBot({ water: true });
    const noPath = Object.assign(new Error('no path'), { name: 'NoPath' });
    fake.bot.pathfinder.goto.mockRejectedValue(noPath);
    return fake;
  }

  it('runs the ladder when goto is blocked in water, and ends needs_rescue when all rungs fail', async () => {
    const fake = stuckInWater();
    const lines: string[] = [];
    const result = await moveNear(fake.asBot, { x: 10, y: 64, z: 0 }, 1, {
      signal: new AbortController().signal,
      timeScale: 1,
      diag: { log: (line) => lines.push(line), now: () => 0 },
    });
    expect(result).toMatchObject({ ok: false, reason: 'needs_rescue' });
    expect(lines.some((line) => line.includes('"rung":"water_exit"'))).toBe(true);
  });

  it('caps the ladder runs per move at MAX_LADDERS, then plain blocked stands', async () => {
    const fake = scriptedBot({
      water: true,
      physics: (s) => {
        // Every rung seems to work, so the move restarts its walk, which is blocked again.
        if (s.controls.jump) {
          s.entity.isInWater = false;
          s.position.x += 2;
        }
      },
    });
    const noPath = Object.assign(new Error('no path'), { name: 'NoPath' });
    fake.bot.pathfinder.goto.mockImplementation(async () => {
      fake.state.entity.isInWater = true;
      throw noPath;
    });
    const lines: string[] = [];
    const result = await moveNear(fake.asBot, { x: 10, y: 64, z: 0 }, 1, {
      signal: new AbortController().signal,
      timeScale: 1,
      diag: { log: (line) => lines.push(line), now: () => 0 },
    });
    expect(result).toMatchObject({ ok: false, reason: 'blocked' });
    expect(lines.filter((l) => l.includes('"worked":true'))).toHaveLength(MAX_LADDERS);
  });
});
