import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateObservationPayload, validateProvenance } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { FakeWorld } from '../perception.fakes.ts';
import { TakeKeyLru } from './container-take.ts';
import { type BreakContext, type BreakProvenance, observeBreak } from './property-break.ts';
import { observedActor } from './visible-actor.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/break-real.json', import.meta.url));
const WORKNOTE = fileURLToPath(
  new URL('../../../../docs/analysis/harness/worknotes/AN-27a.md', import.meta.url),
);

/** The Body's name in these tests, and the broken cell (the captured break's coordinates). */
const SELF = 'ag_capa_01';
const CELL = { x: 1313, y: 200, z: 800 };

/** The centre of the cell at (x, y, z), the point reach is measured to. */
const centreOf = (x: number, y: number, z: number) => new Vec3(x + 0.5, y + 0.5, z + 0.5);

const asBot = (world: FakeWorld) => world.bot as unknown as Bot;

/** A world with the Body 10 blocks from the cell, on the cell's level. */
function bench(at = new Vec3(1313.5, 200, 790.5)): FakeWorld {
  const world = new FakeWorld();
  world.me.position = at;
  return world;
}

/** A player at `position` (3 blocks east of the Body by default, so it is in sight). */
function playerAt(world: FakeWorld, username: string, position = new Vec3(1316.5, 200, 790.5)) {
  world.entities[2] = { type: 'player', username, position };
}

/** A break of the cell by `ag_capb_02`, owned by `owner`, as the plugin sends it. */
function brk(owner: string | null, overrides: Partial<BreakProvenance> = {}): BreakProvenance {
  return {
    kind: 'break',
    world: 'world',
    x: CELL.x,
    y: CELL.y,
    z: CELL.z,
    actor: 'ag_capb_02',
    prior_owner: owner,
    block: 'cobblestone',
    tick: 2064,
    ...overrides,
  } as BreakProvenance;
}

/** The Body's break context, with a fresh LRU, the cell in sight, and the real visible-actor rule. */
function ctxFor(
  world: FakeWorld,
  selfName = SELF,
  overrides: Partial<BreakContext> = {},
): BreakContext {
  const bot = asBot(world);
  return {
    selfName,
    bot,
    seen: new TakeKeyLru(),
    resolve: (username) => observedActor(bot, username),
    canSee: () => true,
    ...overrides,
  };
}

describe('observeBreak', () => {
  it('a visible breaker of an owned block is named', () => {
    const world = bench();
    playerAt(world, 'ag_capb_02');
    const out = observeBreak(brk(SELF), ctxFor(world));
    expect(out).toEqual({
      kind: 'property_broken',
      actor: { name: 'ag_capb_02', life: 'ag_capb_02' },
      block: 'cobblestone',
      key: 'brk:2064:1313:200:800:ag_capb_02',
    });
    expect(validateObservationPayload(out)).toBe(true);
  });

  it('a breaker out of sight gives an unattributed observation', () => {
    const out = observeBreak(brk(SELF), ctxFor(bench()));
    expect(out).toEqual({
      kind: 'property_broken',
      block: 'cobblestone',
      key: 'brk:2064:1313:200:800:none',
    });
    expect(out).not.toHaveProperty('actor');
    expect(validateObservationPayload(out)).toBe(true);
  });

  it('a block out of sight gives nothing', () => {
    const world = bench();
    playerAt(world, 'ag_capb_02');
    expect(observeBreak(brk(SELF), ctxFor(world, SELF, { canSee: () => false }))).toBeNull();
    // Only a true sight check counts: a truthy non-boolean does not.
    const truthy = ctxFor(world, SELF, { canSee: () => 1 as unknown as boolean });
    expect(observeBreak(brk(SELF), truthy)).toBeNull();
  });

  it("someone else's block gives nothing", () => {
    const world = bench();
    playerAt(world, 'ag_capb_02');
    expect(observeBreak(brk('ag_other_01'), ctxFor(world))).toBeNull();
  });

  it('an unowned block gives nothing', () => {
    const world = bench();
    playerAt(world, 'ag_capb_02');
    expect(observeBreak(brk(null), ctxFor(world))).toBeNull();
  });

  it('breaking your own block gives nothing', () => {
    const world = bench();
    playerAt(world, SELF);
    expect(observeBreak(brk(SELF, { actor: SELF }), ctxFor(world))).toBeNull();
  });

  it('breaking your own block under other capitals gives nothing', () => {
    // Minecraft names are not case-sensitive: the server may send the Body's own name in other capitals.
    const world = bench();
    playerAt(world, SELF.toUpperCase());
    expect(observeBreak(brk(SELF, { actor: SELF.toUpperCase() }), ctxFor(world))).toBeNull();
    // Out of sight the breaker is unnamed; the Body must not take its own break for someone else's.
    expect(observeBreak(brk(SELF, { actor: 'Ag_Capa_01' }), ctxFor(bench()))).toBeNull();
  });

  it('the same message twice gives one', () => {
    const world = bench();
    playerAt(world, 'ag_capb_02');
    const ctx = ctxFor(world);
    expect(observeBreak(brk(SELF), ctx)).not.toBeNull();
    expect(observeBreak(brk(SELF), ctx)).toBeNull();
  });

  it('prior_owner null (CoreProtect missing) gives nothing', () => {
    const world = bench();
    playerAt(world, 'ag_capb_02');
    expect(observeBreak(brk(null, { tick: 411 }), ctxFor(world))).toBeNull();
  });

  it('reach is measured from the cell centre to 24 blocks, on every axis and sign', () => {
    const cell = centreOf(CELL.x, CELL.y, CELL.z);
    const from = (dx: number, dy: number, dz: number) => {
      const world = new FakeWorld();
      world.me.position = cell.offset(dx, dy, dz);
      return ctxFor(world);
    };
    const inside: Array<[number, number, number]> = [
      [23, 0, 0],
      [-23, 0, 0],
      [0, 0, 23],
      [0, 0, -23],
      [0, 23, 0],
      [0, -23, 0],
      [16, 0, 16],
      [-16, 0, -16],
      [24, 0, 0],
      [0, 0, -24],
      [0, -24, 0],
    ];
    const outside: Array<[number, number, number]> = [
      [25, 0, 0],
      [-25, 0, 0],
      [0, 0, 25],
      [0, 0, -25],
      [0, 25, 0],
      [0, -25, 0],
      [17, 0, 17],
      [-17, 0, -17],
    ];
    for (const [dx, dy, dz] of inside) {
      expect(observeBreak(brk(SELF), from(dx, dy, dz))).toMatchObject({ kind: 'property_broken' });
    }
    for (const [dx, dy, dz] of outside) {
      expect(observeBreak(brk(SELF), from(dx, dy, dz))).toBeNull();
    }
  });

  it('a Body with no position gives nothing', () => {
    const ctx = ctxFor(bench());
    (ctx.bot as unknown as { entity?: unknown }).entity = undefined;
    expect(observeBreak(brk(SELF), ctx)).toBeNull();
  });

  it('a malformed break gives nothing, refused by the bounds and integer checks themselves', () => {
    // Each Body stands at the odd cell, so reach passes and only the break's own numbers can refuse it.
    const home = centreOf(CELL.x, CELL.y, CELL.z);
    const hostile: Array<[Partial<BreakProvenance>, Vec3]> = [
      [{ x: 1e-7 }, centreOf(1e-7, CELL.y, CELL.z)],
      [{ x: 1.5 }, centreOf(1.5, CELL.y, CELL.z)],
      [{ y: 1e-7 }, centreOf(CELL.x, 1e-7, CELL.z)],
      [{ y: Number.NaN }, home],
      [{ z: '800' as unknown as number }, home],
      [{ tick: -1 }, home],
      [{ tick: 2.5 }, home],
      [{ tick: 1e-7 }, home],
      [{ block: 'Cobblestone' }, home],
      [{ block: 'minecraft:cobblestone' }, home],
      [{ block: '' }, home],
      [{ x: 30_000_001 }, centreOf(30_000_001, CELL.y, CELL.z)],
      [{ x: -30_000_001 }, centreOf(-30_000_001, CELL.y, CELL.z)],
      [{ y: 2049 }, centreOf(CELL.x, 2049, CELL.z)],
      [{ y: -2049 }, centreOf(CELL.x, -2049, CELL.z)],
      [{ z: 30_000_001 }, centreOf(CELL.x, CELL.y, 30_000_001)],
      [{ z: -30_000_001 }, centreOf(CELL.x, CELL.y, -30_000_001)],
    ];
    for (const [overrides, at] of hostile) {
      expect(observeBreak(brk(SELF, overrides), ctxFor(bench(at)))).toBeNull();
    }
  });

  it('a breaker with capitals in the name is keyed in lower case', () => {
    const world = bench();
    playerAt(world, 'Ag_Mixed_09');
    const out = observeBreak(brk(SELF, { actor: 'Ag_Mixed_09' }), ctxFor(world));
    expect(out).toMatchObject({
      kind: 'property_broken',
      actor: { name: 'Ag_Mixed_09' },
      key: 'brk:2064:1313:200:800:ag_mixed_09',
    });
    expect(validateObservationPayload(out)).toBe(true);
  });

  it('negative and edge coordinates are keyed as written and validate', () => {
    for (const cell of [
      { x: -5, y: -60, z: -7 },
      { x: 30_000_000, y: 64, z: -30_000_000 },
    ]) {
      const world = new FakeWorld();
      world.me.position = centreOf(cell.x, cell.y, cell.z).offset(-10, 0, 0);
      playerAt(world, 'ag_capb_02', world.me.position.offset(3, 0, 0));
      const out = observeBreak(brk(SELF, cell), ctxFor(world));
      expect(out).toEqual({
        kind: 'property_broken',
        actor: { name: 'ag_capb_02', life: 'ag_capb_02' },
        block: 'cobblestone',
        key: `brk:2064:${cell.x}:${cell.y}:${cell.z}:ag_capb_02`,
      });
      expect(validateObservationPayload(out)).toBe(true);
    }
  });

  it('a tick too large for the key shape gives nothing (the contract refuses the key)', () => {
    // `${1e21}` renders as "1e+21": the '+' is outside the observation key pattern.
    expect(observeBreak(brk(SELF, { tick: 1e21 }), ctxFor(bench()))).toBeNull();
  });

  it('a refused key takes no slot in seen', () => {
    // The contract refuses this key, so the observation is null and the key was never admitted.
    const ctx = ctxFor(bench());
    expect(observeBreak(brk(SELF, { tick: 1e21 }), ctx)).toBeNull();
    expect(ctx.seen.admit('brk:1e+21:1313:200:800:none')).toBe(true);
  });

  it('a throwing resolver leaves the breaker unnamed, and a throwing sight check sees nothing', () => {
    const world = bench();
    playerAt(world, 'ag_capb_02');
    const unnamed = observeBreak(
      brk(SELF),
      ctxFor(world, SELF, {
        resolve: () => {
          throw new Error('resolver failed');
        },
      }),
    );
    expect(unnamed).toEqual({
      kind: 'property_broken',
      block: 'cobblestone',
      key: 'brk:2064:1313:200:800:none',
    });
    const blind = ctxFor(world, SELF, {
      canSee: () => {
        throw new Error('sight failed');
      },
    });
    expect(observeBreak(brk(SELF), blind)).toBeNull();
  });

  it('the raw breaker name never reaches the key or the payload when it is out of sight', () => {
    const out = observeBreak(brk(SELF, { actor: 'ag_hidden_09' }), ctxFor(bench()));
    expect(out?.key).toBe('brk:2064:1313:200:800:none');
    expect(JSON.stringify(out)).not.toContain('ag_hidden_09');
  });

  it('the captured real payloads validate with validateProvenance', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
      coreprotect_absent: BreakProvenance;
      coreprotect_present: BreakProvenance;
    };
    expect(validateProvenance(fixture.coreprotect_absent)).toBe(true);
    expect(validateProvenance(fixture.coreprotect_present)).toBe(true);

    // The fixture is the captured line, byte for byte as JSON: the worknote holds the two lines, absent first.
    const lines = readFileSync(WORKNOTE, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('{"kind":"break"'));
    expect(lines).toEqual([
      JSON.stringify(fixture.coreprotect_absent),
      JSON.stringify(fixture.coreprotect_present),
    ]);

    const world = bench();
    playerAt(world, 'ag_capb_02');
    expect(observeBreak(fixture.coreprotect_present, ctxFor(world, SELF))).toEqual({
      kind: 'property_broken',
      actor: { name: 'ag_capb_02', life: 'ag_capb_02' },
      block: 'cobblestone',
      key: 'brk:411:1313:200:800:ag_capb_02',
    });
    expect(observeBreak(fixture.coreprotect_absent, ctxFor(world, SELF))).toBeNull();
    expect(observeBreak(fixture.coreprotect_present, ctxFor(world, 'ag_other_01'))).toBeNull();
  });
});
