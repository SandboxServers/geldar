import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { AIR, block, type FakeBlock, type State, scriptedBot } from './escape-ladder.fakes.ts';
import { escapeLadder } from './escape-ladder.ts';
import { inPit } from './escape-stairs.ts';

const TOWARD = { x: 10.5, z: 0.5 };

function run(fake: ReturnType<typeof scriptedBot>, toward = TOWARD) {
  const lines: Array<Record<string, unknown>> = [];
  const result = escapeLadder(fake.asBot, {
    signal: new AbortController().signal,
    toward,
    sink: { log: (line) => lines.push(JSON.parse(line)), now: () => 0 },
  });
  return { result, lines };
}

const rungs = (lines: Array<Record<string, unknown>>) =>
  lines.filter((l) => l.reason === 'escape_ladder').map((l) => [l.rung, l.worked]);

const stairLines = (lines: Array<Record<string, unknown>>) =>
  lines.filter((l) => l.reason === 'escape_stairs');

/** With jump and forward held, the bot climbs onto the cell one step `dir` away when it is a block with air above. */
function climb(dir: Vec3) {
  return (s: State): void => {
    if (!(s.controls.jump && s.controls.forward)) return;
    const x = Math.floor(s.position.x) + dir.x;
    const z = Math.floor(s.position.z) + dir.z;
    const y = Math.floor(s.position.y);
    const at = (dy: number) => s.blockAt(new Vec3(x, y + dy, z)).boundingBox;
    if (at(0) === 'block' && at(1) !== 'block' && at(2) !== 'block') {
      s.position.x += dir.x;
      s.position.z += dir.z;
      s.position.y += 1;
    }
  };
}

/** The Colo pit (diag-pit-sleep.md section 1): stone floor at y58, every cell not listed here is stone. */
const COLO_OPEN: ReadonlyArray<readonly [number, number, number]> = [
  [-224, 59, 346],
  [-224, 60, 346],
  [-224, 59, 347],
  [-224, 60, 347],
  [-224, 61, 347],
  [-223, 59, 347],
  [-223, 60, 347],
  [-223, 61, 347],
  [-224, 59, 348],
  [-224, 60, 348],
  [-223, 60, 348],
  [-223, 61, 348],
  [-223, 62, 348],
  [-223, 63, 348],
  [-222, 60, 347],
  [-222, 61, 347],
  [-222, 62, 347],
  [-222, 63, 347],
];

function coloBlocks(): Record<string, FakeBlock> {
  const open = new Set(COLO_OPEN.map(([x, y, z]) => `${x},${y},${z}`));
  const blocks: Record<string, FakeBlock> = {};
  for (let x = -226; x <= -221; x++) {
    for (let y = 57; y <= 64; y++) {
      for (let z = 345; z <= 349; z++) {
        const key = `${x},${y},${z}`;
        blocks[key] = open.has(key) ? AIR : block('stone');
      }
    }
  }
  return blocks;
}

const SIDES: ReadonlyArray<readonly [string, Vec3]> = [
  ['east', new Vec3(1, 0, 0)],
  ['west', new Vec3(-1, 0, 0)],
  ['north', new Vec3(0, 0, -1)],
  ['south', new Vec3(0, 0, 1)],
];

/** Goal toward the walled side: the side opposite `open`. */
const towardWall = (open: Vec3) => ({ x: 0.5 - 10 * open.x, z: 0.5 - 10 * open.z });

/**
 * A pit at (0,64,0) on a stone floor: stone walls three high on every side but `open`. The open side
 * is a flat floor (or, with `ledge`, a one-high block the jump rung can climb onto).
 */
function sideBlocks(open: Vec3, ledge: boolean): Record<string, FakeBlock> {
  const blocks: Record<string, FakeBlock> = { '0,63,0': block('stone') };
  for (const [, d] of SIDES) {
    if (d.equals(open)) continue;
    for (let y = 64; y <= 66; y++) blocks[`${d.x},${y},${d.z}`] = block('stone');
  }
  blocks[`${open.x},63,${open.z}`] = block('stone');
  if (ledge) blocks[`${open.x},64,${open.z}`] = block('stone');
  return blocks;
}

describe('stairs gate: the pit test', () => {
  it('digs a step out of the Colo pit: flat stone floor with connected open floor cells', async () => {
    const west = new Vec3(-1, 0, 0);
    const fake = scriptedBot({ blocks: coloBlocks(), physics: climb(west) });
    fake.state.position.set(-223.33, 59, 347.5);
    expect(inPit(fake.asBot)).toBe(true);
    const { result, lines } = run(fake, { x: -300.5, z: 347.5 });
    expect(await result).toEqual({ ok: true, rung: 'stairs' });
    expect(stairLines(lines)[0]).toMatchObject({ step: 1, dug: 2 });
    expect(rungs(lines)).toEqual([
      ['jump', false],
      ['sprint_jump', false],
      ['dig', false],
      ['stairs', true],
    ]);
  });

  it.each(SIDES)(
    'digs a step out of a pit open to the %s on a flat floor, toward the walled side',
    async (_name, open) => {
      const wall = new Vec3(-open.x, 0, -open.z);
      const fake = scriptedBot({ blocks: sideBlocks(open, false), physics: climb(wall) });
      expect(inPit(fake.asBot)).toBe(true);
      const { result, lines } = run(fake, towardWall(open));
      expect(await result).toEqual({ ok: true, rung: 'stairs' });
      expect(stairLines(lines)[0]).toMatchObject({ step: 1, dug: 2 });
    },
  );

  it.each(SIDES)(
    'does not dig a stair in a pit whose %s side is a ledge the jump rung can use',
    async (_name, open) => {
      const fake = scriptedBot({ blocks: sideBlocks(open, true) });
      expect(inPit(fake.asBot)).toBe(false);
      const { result, lines } = run(fake, towardWall(open));
      await result;
      expect(stairLines(lines)).toEqual([]);
      expect(lines.find((l) => l.rung === 'stairs')).toMatchObject({ worked: false });
    },
  );

  it('does nothing on flat grass: not a pit, no stairs, no dig', async () => {
    const blocks: Record<string, FakeBlock> = {};
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) blocks[`${x},63,${z}`] = block('grass_block');
    }
    const fake = scriptedBot({ blocks });
    expect(inPit(fake.asBot)).toBe(false);
    const { result, lines } = run(fake);
    expect(await result).toMatchObject({ ok: false, reason: 'needs_rescue' });
    expect(stairLines(lines)).toEqual([]);
    expect(lines.find((l) => l.rung === 'stairs')).toMatchObject({ worked: false });
    expect(fake.bot.dig).not.toHaveBeenCalled();
  });
});

describe('pillar headroom', () => {
  it('refuses a pillar when bedrock sits three cells up with air at two, naming the headroom', async () => {
    const fake = scriptedBot({
      items: ['dirt'],
      blocks: { '0,63,0': block('stone'), '0,67,0': block('bedrock') },
    });
    const { result } = run(fake);
    expect(await result).toMatchObject({
      ok: false,
      refusal: expect.stringContaining('no headroom for a pillar'),
    });
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it.each([
    ['water', 'water would flow in on you'],
    ['lava', 'lava would flow in on you'],
    ['sand', 'sand above it would fall on you'],
  ])(
    'refuses to dig a ceiling cell with %s just above it, before any jump',
    async (name, reason) => {
      const hazard = name === 'sand' ? block('sand') : block(name, { boundingBox: 'empty' });
      const fake = scriptedBot({
        items: ['dirt'],
        blocks: { '0,63,0': block('stone'), '0,66,0': block('stone'), '0,67,0': hazard },
      });
      const { result } = run(fake);
      expect(await result).toMatchObject({
        ok: false,
        refusal: `no headroom for a pillar: stone is unsafe to dig: ${reason}`,
      });
      expect(fake.bot.dig).not.toHaveBeenCalled();
      expect(fake.bot.placeBlock).not.toHaveBeenCalled();
    },
  );

  it('reports a refused placement as not worked, even when the bot rose past the threshold', async () => {
    const fake = scriptedBot({
      items: ['dirt'],
      blocks: { '0,63,0': block('stone') },
      physics: (s) => {
        if (s.held && s.controls.jump && fake.bot.placeBlock.mock.calls.length === 0)
          s.position.y += 0.3;
      },
    });
    fake.bot.placeBlock.mockRejectedValue(
      new Error('Server refused to place dirt at 0,63,0: the block is still air'),
    );
    const { result, lines } = run(fake);
    expect(await result).toEqual({
      ok: false,
      reason: 'needs_rescue',
      message: 'no way out: tried jump, sprint_jump, dig, stairs, pillar',
    });
    expect(fake.state.position.y).toBeGreaterThanOrEqual(65);
    expect(lines.find((l) => l.rung === 'pillar')).toMatchObject({ worked: false });
    expect(lines.find((l) => l.reason === 'escape_pillar_failed')).toMatchObject({
      error: expect.stringContaining('Server refused'),
    });
  });
});
