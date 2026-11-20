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
    // A break where the named owner is also the breaker is refused whoever the owner is.
    expect(observeBreak(brk('ag_capb_02', { actor: 'ag_capb_02' }), ctxFor(world))).toBeNull();
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

  it('a cell 23 blocks away is in reach, one 25 blocks away is not', () => {
    const at = (z: number) => bench(new Vec3(1313.5, 200, z));
    expect(observeBreak(brk(SELF), ctxFor(at(777.5)))).toMatchObject({ kind: 'property_broken' });
    expect(observeBreak(brk(SELF), ctxFor(at(775.5)))).toBeNull();
  });

  it('a malformed break gives nothing', () => {
    const hostile: Array<Partial<BreakProvenance>> = [
      { x: 1.5 },
      { y: Number.NaN },
      { z: '800' as unknown as number },
      { tick: -1 },
      { tick: 2.5 },
      { block: 'Cobblestone' },
      { block: 'minecraft:cobblestone' },
      { block: '' },
      { x: 30_000_001 },
      { y: 2049 },
    ];
    for (const overrides of hostile) {
      expect(observeBreak(brk(SELF, overrides), ctxFor(bench()))).toBeNull();
    }
  });

  it('a tick too large for the key shape gives nothing (the contract refuses the key)', () => {
    // `${1e21}` renders as "1e+21": the '+' is outside the observation key pattern.
    expect(observeBreak(brk(SELF, { tick: 1e21 }), ctxFor(bench()))).toBeNull();
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
