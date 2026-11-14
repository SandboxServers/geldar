import { Vec3 } from 'vec3';
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

  it('a jump that moves the bot but leaves it in water is not worked', async () => {
    const fake = scriptedBot({
      water: true,
      physics: (s) => {
        if (s.controls.jump && !s.controls.sprint) s.position.x += 0.5;
      },
    });
    const { result, lines } = run(fake);
    await result;
    expect(rungs(lines)).toContainEqual(['jump', false]);
    expect(rungs(lines)).not.toContainEqual(['jump', true]);
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

  it('rung 3 digs stone bare-handed when no pickaxe is held', async () => {
    const fake = scriptedBot({
      blocks: { '1,64,0': block('stone', { harvestTools: { 270: true } }) },
      physics: walkEast,
    });
    const { result } = run(fake);
    expect(await result).toEqual({ ok: true, rung: 'dig' });
    expect(fake.bot.dig).toHaveBeenCalledTimes(1);
    expect(fake.bot.equip).not.toHaveBeenCalled();
  });

  it('rung 3 refuses an unbreakable block, naming it', async () => {
    const fake = scriptedBot({ blocks: { '1,64,0': block('bedrock') }, physics: walkEast });
    const { result, lines } = run(fake);
    const outcome = await result;
    expect(outcome).toMatchObject({ ok: false, reason: 'needs_rescue' });
    expect((outcome as { refusal?: string }).refusal).toBe(
      'bedrock cannot be broken by anyone, with any tool',
    );
    expect(fake.bot.dig).not.toHaveBeenCalled();
    expect(lines.find((l) => l.rung === 'dig')).toMatchObject({ worked: false });
  });

  it('rung 3 refuses a block with lava beside it', async () => {
    const fake = scriptedBot({
      blocks: { '1,64,0': block('stone'), '2,64,0': block('lava') },
      physics: walkEast,
    });
    const { result } = run(fake);
    expect(await result).toMatchObject({
      ok: false,
      refusal: 'stone is unsafe to dig: lava would flow in on you',
    });
    expect(fake.bot.dig).not.toHaveBeenCalled();
  });

  it("rung 3 refuses dirt that touches someone else's built block, and digs nothing", async () => {
    // The dirt ahead touches planks: built material, not this bot's, so the dig rung protects it.
    const fake = scriptedBot({
      blocks: { '1,64,0': block('dirt'), '2,64,0': block('oak_planks') },
      physics: walkEast,
    });
    const { result } = run(fake);
    const outcome = await result;
    expect(outcome).toMatchObject({ ok: false, reason: 'needs_rescue' });
    expect((outcome as { refusal?: string }).refusal).toContain("someone else's work");
    expect(fake.bot.dig).not.toHaveBeenCalled();
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
    expect(rungs(lines).map(([r]) => r)).toEqual([
      'jump',
      'sprint_jump',
      'dig',
      'stairs',
      'pillar',
    ]);
    expect(fake.bot.equip).toHaveBeenCalledWith({ name: 'dirt', count: 1 }, 'hand');
    expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
  });

  it('pillar places only once the feet are a full block up, along a real jump curve', async () => {
    // Feet height above the start on each tick of a jump: 0.42, 0.75, 1.0, then the apex.
    const curve = [0.42, 0.753, 1.0, 1.166, 1.249];
    let airTicks = 0;
    let heightAtPlace = Number.NaN;
    const fake = scriptedBot({
      items: ['dirt'],
      blocks: { '0,63,0': block('stone') },
      physics: (s) => {
        if (!s.held || !s.controls.jump || fake.bot.placeBlock.mock.calls.length > 0) return;
        s.position.y = 64 + (curve[Math.min(airTicks, curve.length - 1)] ?? 1.249);
        airTicks++;
      },
    });
    fake.bot.placeBlock.mockImplementation(async () => {
      heightAtPlace = fake.state.position.y - 64;
    });
    const { result } = run(fake);
    expect(await result).toEqual({ ok: true, rung: 'pillar' });
    expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
    expect(heightAtPlace).toBeGreaterThanOrEqual(1.0);
  });

  it('pillar digs a diggable ceiling cell first, then jumps and places', async () => {
    const ceiling = block('stone');
    const fake = scriptedBot({
      items: ['dirt'],
      blocks: { '0,63,0': block('stone'), '0,66,0': ceiling },
      physics: (s) => {
        if (s.held && s.controls.jump && !fake.bot.placeBlock.mock.calls.length)
          s.position.y += 0.3;
        if (fake.bot.placeBlock.mock.calls.length) s.position.y = 65;
      },
    });
    const { result } = run(fake);
    expect(await result).toEqual({ ok: true, rung: 'pillar' });
    expect(fake.bot.dig).toHaveBeenCalledWith(ceiling, true);
    expect(fake.bot.dig.mock.invocationCallOrder[0]).toBeLessThan(
      fake.bot.placeBlock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('pillar with a low ceiling it cannot dig skips the jump, naming the headroom', async () => {
    const fake = scriptedBot({
      items: ['dirt'],
      blocks: { '0,63,0': block('stone'), '0,66,0': block('bedrock') },
    });
    const { result, lines } = run(fake);
    expect(await result).toMatchObject({
      ok: false,
      refusal: expect.stringContaining('no headroom'),
    });
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
    // Only the plain jump and the sprint-jump rungs jump: the pillar does not.
    const jumps = fake.bot.setControlState.mock.calls.filter(([c, on]) => c === 'jump' && on);
    expect(jumps).toHaveLength(2);
    expect(lines.find((l) => l.rung === 'pillar')).toMatchObject({ worked: false });
  });

  it('returns a typed needs_rescue with facts only when every rung fails', async () => {
    const fake = scriptedBot({});
    const { result, lines } = run(fake);
    expect(await result).toEqual({
      ok: false,
      reason: 'needs_rescue',
      message: 'no way out: tried jump, sprint_jump, dig, stairs, pillar',
    });
    expect(rungs(lines)).toHaveLength(5);
  });

  describe('stairs', () => {
    /** A pit at (0,64,0): stone floor and walls, with a tall wall of stone to the east. */
    function pit(extra: Record<string, ReturnType<typeof block>> = {}, water = false) {
      const blocks: Record<string, ReturnType<typeof block>> = { '0,63,0': block('stone') };
      for (let y = 64; y <= 66; y++) {
        for (const key of [`-1,${y},0`, `0,${y},1`, `0,${y},-1`]) blocks[key] = block('stone');
      }
      for (let x = 1; x <= 3; x++) {
        for (let y = 64; y <= 70; y++) blocks[`${x},${y},0`] = block('stone');
      }
      const fake: ReturnType<typeof scriptedBot> = scriptedBot({
        water,
        blocks: { ...blocks, ...extra },
        physics: (s) => {
          if (!(s.controls.jump && s.controls.forward)) return;
          // Before the first dig the water holds the bot: only the stairs get it out.
          if (s.entity.isInWater && fake.bot.dig.mock.calls.length === 0) return;
          const x = Math.floor(s.position.x) + 1;
          const y = Math.floor(s.position.y);
          const at = (dy: number) => s.blockAt(new Vec3(x, y + dy, 0)).boundingBox;
          if (at(0) === 'block' && at(1) !== 'block' && at(2) !== 'block') {
            s.position.x += 1;
            s.position.y += 1;
          }
        },
      });
      return fake;
    }

    it('a stair dig that aborts the move digs no second cell of that step', async () => {
      const controller = new AbortController();
      const fake = pit();
      fake.bot.dig.mockImplementationOnce(async () => {
        controller.abort();
      });
      const out = await escapeLadder(fake.asBot, {
        signal: controller.signal,
        toward: TOWARD,
        sink: { log: () => undefined, now: () => 0 },
      });
      expect(out.ok).toBe(false);
      expect(fake.bot.dig).toHaveBeenCalledTimes(1);
    });

    it('climbs a one-wide staircase out of a pit, one block per two digs, logging each step', async () => {
      const fake = pit();
      const { result, lines } = run(fake);
      expect(await result).toEqual({ ok: true, rung: 'stairs' });
      expect(fake.state.position.y).toBe(67);
      expect(fake.bot.dig).toHaveBeenCalledTimes(6);
      const steps = lines.filter((l) => l.reason === 'escape_stairs' && l.step !== undefined);
      expect(steps.map((l) => [l.step, l.dug])).toEqual([
        [1, 2],
        [2, 2],
        [3, 2],
      ]);
      // The dig rung did not tunnel along the floor of a pit first.
      expect(rungs(lines)).toEqual([
        ['jump', false],
        ['sprint_jump', false],
        ['dig', false],
        ['stairs', true],
      ]);
    });

    it('digs a stair out of an L-shaped cavity whose open side is not standable', async () => {
      // Floor under the bot; stone walls west, north and south; east is air over a hole, so no
      // neighbour is standable. The goal lies east, so the stairs must take the walled west side.
      const blocks: Record<string, ReturnType<typeof block>> = { '0,63,0': block('stone') };
      for (let y = 64; y <= 66; y++) {
        for (const key of [`-1,${y},0`, `0,${y},1`, `0,${y},-1`]) blocks[key] = block('stone');
      }
      const fake = scriptedBot({
        blocks,
        physics: (s) => {
          if (!(s.controls.jump && s.controls.forward)) return;
          const x = Math.floor(s.position.x) - 1;
          const y = Math.floor(s.position.y);
          const at = (dy: number) => s.blockAt(new Vec3(x, y + dy, 0)).boundingBox;
          if (at(0) === 'block' && at(1) !== 'block' && at(2) !== 'block') {
            s.position.x -= 1;
            s.position.y += 1;
          }
        },
      });
      const { result, lines } = run(fake);
      expect(await result).toEqual({ ok: true, rung: 'stairs' });
      expect(fake.bot.dig).toHaveBeenCalledTimes(2);
      expect(rungs(lines)).toEqual([
        ['jump', false],
        ['sprint_jump', false],
        ['dig', false],
        ['stairs', true],
      ]);
    });

    it('in water runs the water exit first, then the stairs', async () => {
      const fake = pit({}, true);
      const { result, lines } = run(fake);
      expect(await result).toEqual({ ok: true, rung: 'stairs' });
      expect(rungs(lines)[0]).toEqual(['water_exit', false]);
    });

    it('stops with the typed reason when gravel is above the step', async () => {
      const fake = pit({ '1,67,0': block('gravel') });
      const { result, lines } = run(fake);
      const outcome = await result;
      expect(outcome).toMatchObject({
        ok: false,
        refusal: 'stone is unsafe to dig: gravel above it would fall on you',
      });
      // Step 1 dug nothing past the hazard: only the cells it checked first were dug.
      expect(fake.state.position.y).toBeLessThan(67);
      expect(lines.some((l) => l.reason === 'escape_stairs' && l.stopped === 'refused')).toBe(true);
    });

    it('does nothing when the bot is not in a pit', async () => {
      const fake = scriptedBot({ blocks: { '1,64,0': block('stone') } });
      const { result, lines } = run(fake);
      await result;
      expect(lines.find((l) => l.rung === 'stairs')).toMatchObject({ worked: false });
      expect(lines.some((l) => l.reason === 'escape_stairs')).toBe(false);
    });
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

  it('a dig that aborts the move ends the dig: the cell above it is not dug', async () => {
    const controller = new AbortController();
    const fake = scriptedBot({ blocks: { '1,64,0': block('dirt'), '1,65,0': block('dirt') } });
    fake.bot.dig.mockImplementationOnce(async () => {
      controller.abort();
    });
    const out = await escapeLadder(fake.asBot, {
      signal: controller.signal,
      toward: TOWARD,
      sink: { log: () => undefined, now: () => 0 },
    });
    expect(out.ok).toBe(false);
    expect(fake.bot.dig).toHaveBeenCalledTimes(1);
  });

  it('a pillar whose move is aborted while it rises places nothing', async () => {
    const controller = new AbortController();
    const fake = scriptedBot({ items: ['dirt'], blocks: { '0,63,0': block('stone') } });
    fake.bot.waitForTicks.mockImplementation(async () => {
      if (!fake.state.held) return;
      // The bot rises a full block, and the move is superseded on that same tick.
      fake.state.position.y = 65.2;
      controller.abort();
    });
    const out = await escapeLadder(fake.asBot, {
      signal: controller.signal,
      toward: TOWARD,
      sink: { log: () => undefined, now: () => 0 },
    });
    expect(out.ok).toBe(false);
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('a pillar digs no second headroom cell once its first dig aborts the move', async () => {
    const controller = new AbortController();
    const fake = scriptedBot({
      items: ['dirt'],
      blocks: { '0,63,0': block('stone'), '0,66,0': block('stone'), '0,67,0': block('stone') },
    });
    fake.bot.dig.mockImplementationOnce(async () => {
      controller.abort();
    });
    const out = await escapeLadder(fake.asBot, {
      signal: controller.signal,
      toward: TOWARD,
      sink: { log: () => undefined, now: () => 0 },
    });
    expect(out.ok).toBe(false);
    expect(fake.bot.dig).toHaveBeenCalledTimes(1);
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
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
