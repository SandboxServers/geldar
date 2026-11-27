import { readFileSync } from 'node:fs';
import { validateObservationPayload, validateProvenance } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { FakeWorld } from '../perception.fakes.ts';
import {
  type CombatProvenance,
  type FightContext,
  FightWindows,
  observeFight,
} from './fight-seen.ts';

/*
 * No captured combat provenance payload exists yet: the fixture is hand-made from the CombatProvenance
 * type (contract/src/generated/types.ts), as AN-47a's worknote describes the plugin's `engaged` shape.
 */

/** The Body's name in these tests (the bot's own username in FakeWorld is `Kestrel`). */
const SELF = 'ag_capa_01';
const BODY = new Vec3(100.5, 64, 100.5);
/** A visible player 3 blocks west; a hidden one 3 blocks east behind a wall; one 30 blocks away. */
const WEST = new Vec3(97.5, 64, 100.5);
const EAST = new Vec3(103.5, 64, 100.5);
const FAR_WEST = new Vec3(70.5, 64, 100.5);
/** A zombie 6 blocks south (in sight, not behind the wall), and one 30 blocks south (out of reach). */
const MOB = new Vec3(100.5, 64, 106.5);
const FAR_MOB = new Vec3(100.5, 64, 130.5);

const asBot = (world: FakeWorld) => world.bot as unknown as Bot;

/**
 * The Body's world: a stone wall between the Body and the east, so an eastern player is hidden; the
 * named players as given (entity ids 1..n); and an optional zombie.
 */
function scene(players: Record<string, Vec3>, mob: Vec3 | null = MOB): FakeWorld {
  const world = new FakeWorld();
  world.me.position = BODY.clone();
  // Two high, so no part of a body behind it is in sight (decision 0446).
  world.set('stone', 102, 64, 100);
  world.set('stone', 102, 65, 100);
  let id = 1;
  for (const [username, position] of Object.entries(players)) {
    world.entities[id++] = { type: 'player', username, position };
  }
  if (mob) world.entities[id] = { type: 'mob', name: 'zombie', position: mob };
  return world;
}

/** An `engaged` message: `ag_capb_02` hits a zombie, as the plugin sends it. */
function engaged(overrides: Partial<CombatProvenance> = {}): CombatProvenance {
  return {
    world: 'world',
    actor: 'ag_capb_02',
    target: 'zombie',
    kind: 'engaged',
    tick: 1200,
    ...overrides,
  };
}

/** The Body's fight context at tick 1210, with a fresh window. */
function ctxFor(world: FakeWorld, overrides: Partial<FightContext> = {}): FightContext {
  return { bot: asBot(world), tick: 1210, self: SELF, windows: new FightWindows(), ...overrides };
}

describe('observeFight', () => {
  it('a visible fight gives one observation', () => {
    const world = scene({ ag_capb_02: WEST });
    const out = observeFight(engaged(), ctxFor(world));
    expect(out).toEqual({
      kind: 'fight_seen',
      actor: { name: 'ag_capb_02', life: 'ag_capb_02' },
      target: 'zombie',
      key: 'fight:1200:ag_capb_02:zombie',
    });
    expect(validateObservationPayload(out)).toBe(true);
  });

  it('a hidden or far actor gives null', () => {
    const hidden = scene({ ag_capb_02: EAST });
    expect(observeFight(engaged(), ctxFor(hidden))).toBeNull();
    const far = scene({ ag_capb_02: FAR_WEST });
    expect(observeFight(engaged(), ctxFor(far))).toBeNull();
  });

  it('a mob behind a wall gives null; a mob in the open to the north or west is in sight', () => {
    const behind = scene({ ag_capb_02: WEST }, new Vec3(103.5, 64, 100.5));
    expect(observeFight(engaged(), ctxFor(behind))).toBeNull();
    const north = scene({ ag_capb_02: WEST }, new Vec3(100.5, 64, 94.5));
    expect(observeFight(engaged(), ctxFor(north))).not.toBeNull();
    const west = scene({ ag_capb_02: WEST }, new Vec3(94.5, 64, 100.5));
    expect(observeFight(engaged(), ctxFor(west))).not.toBeNull();
  });

  it('two attackers, only the visible one is observed', () => {
    const world = scene({ ag_hidden_09: EAST, ag_visible_01: WEST });
    const ctx = ctxFor(world);
    expect(observeFight(engaged({ actor: 'ag_hidden_09' }), ctx)).toBeNull();
    const out = observeFight(engaged({ actor: 'ag_visible_01' }), ctx);
    expect(out).toMatchObject({ kind: 'fight_seen', actor: { name: 'ag_visible_01' } });
    expect(JSON.stringify(out)).not.toContain('ag_hidden_09');
  });

  it('repeated engaged messages within 600 ticks give one observation', () => {
    const world = scene({ ag_capb_02: WEST });
    const windows = new FightWindows();
    const first = observeFight(engaged(), ctxFor(world, { windows, tick: 1210 }));
    expect(first).not.toBeNull();
    expect(
      observeFight(engaged({ tick: 1201 }), ctxFor(world, { windows, tick: 1300 })),
    ).toBeNull();
    expect(
      observeFight(engaged({ tick: 1202 }), ctxFor(world, { windows, tick: 1500 })),
    ).toBeNull();
  });

  it('after 600 ticks a new observation; 599 ticks is still refused, 600 is allowed', () => {
    const world = scene({ ag_capb_02: WEST });
    const windows = new FightWindows();
    expect(observeFight(engaged(), ctxFor(world, { windows, tick: 1210 }))).not.toBeNull();
    // The last tick still inside the window (599 ticks after the first observation).
    expect(
      observeFight(engaged({ tick: 1800 }), ctxFor(world, { windows, tick: 1809 })),
    ).toBeNull();
    // One tick past the window: a new observation.
    const again = observeFight(engaged({ tick: 1810 }), ctxFor(world, { windows, tick: 1810 }));
    expect(again).toMatchObject({ key: 'fight:1810:ag_capb_02:zombie' });
  });

  it('killed gives null', () => {
    const world = scene({ ag_capb_02: WEST });
    expect(observeFight(engaged({ kind: 'killed' }), ctxFor(world))).toBeNull();
  });

  it('the own fight of the Body gives null', () => {
    const world = scene({ [SELF]: WEST });
    expect(observeFight(engaged({ actor: SELF }), ctxFor(world))).toBeNull();
  });

  it('a null actor gives null', () => {
    const world = scene({ ag_capb_02: WEST });
    expect(observeFight(engaged({ actor: null }), ctxFor(world))).toBeNull();
  });

  it('a non-string actor gives null, not a throw', () => {
    const world = scene({ ag_capb_02: WEST });
    expect(observeFight(engaged({ actor: 5 as never }), ctxFor(world))).toBeNull();
  });

  it('the payload keys are exactly kind, actor, target and key', () => {
    const world = scene({ ag_capb_02: WEST });
    const out = observeFight(engaged(), ctxFor(world));
    expect(Object.keys(out ?? {}).sort()).toEqual(['actor', 'key', 'kind', 'target']);
  });

  it('a fight in another world gives null; the Body world gives the observation', () => {
    const world = scene({ ag_capb_02: WEST });
    expect(observeFight(engaged(), ctxFor(world, { world: 'nether' }))).toBeNull();
    expect(observeFight(engaged(), ctxFor(world, { world: 'world' }))).not.toBeNull();
  });

  it('a throwing resolver gives null', () => {
    const world = scene({ ag_capb_02: WEST });
    const resolve = () => {
      throw new Error('resolver failed');
    };
    expect(observeFight(engaged(), ctxFor(world, { resolve }))).toBeNull();
  });

  it('a throwing sight read gives null, not a throw', () => {
    const world = scene({ ag_capb_02: WEST });
    const ctx = ctxFor(world, { resolve: () => ({ name: 'ag_capb_02', life: 'ag_capb_02' }) });
    // The Body mid-respawn: no entity to read the sight line from.
    (ctx.bot as unknown as { entity?: unknown }).entity = undefined;
    expect(observeFight(engaged(), ctx)).toBeNull();
  });

  it('a payload the contract refuses gives null and takes no window slot', () => {
    const world = scene({ ag_capb_02: WEST });
    const windows = new FightWindows();
    const resolve = () => ({ name: 'ag_capb_02', life: 'BAD LIFE!' });
    expect(observeFight(engaged(), ctxFor(world, { windows, resolve }))).toBeNull();
    expect(windows.size).toBe(0);
  });

  it('a hostile or malformed name gives null', () => {
    const world = scene({ ag_capb_02: WEST });
    expect(observeFight(engaged({ actor: 'bad name!' }), ctxFor(world))).toBeNull();
    expect(observeFight(engaged({ target: 'Zombie' }), ctxFor(world))).toBeNull();
  });

  it.each([
    ['an empty world', { world: '' }],
    ['a negative tick', { tick: -1 }],
    ['a fractional tick', { tick: 1.5 }],
    ['a namespaced target', { target: 'minecraft:zombie' }],
  ] as const)('%s gives null even with a zombie in sight', (_label, overrides) => {
    const world = scene({ ag_capb_02: WEST });
    expect(observeFight(engaged(overrides), ctxFor(world))).toBeNull();
  });

  it('a player named like the target is not a mob, gives null', () => {
    const world = scene({ ag_capb_02: WEST }, null);
    world.entities[9] = { type: 'player', name: 'zombie', position: MOB };
    expect(observeFight(engaged(), ctxFor(world))).toBeNull();
  });

  it('a mob out of 24 blocks, or no such mob nearby, gives null', () => {
    const far = scene({ ag_capb_02: WEST }, FAR_MOB);
    expect(observeFight(engaged(), ctxFor(far))).toBeNull();
    const none = scene({ ag_capb_02: WEST }, null);
    expect(observeFight(engaged(), ctxFor(none))).toBeNull();
  });

  it('the captured real engaged payloads validate with validateProvenance and give one observation', () => {
    const path = new URL('./fixtures/combat-real.json', import.meta.url);
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, CombatProvenance>;
    expect(Object.keys(parsed)).toEqual(['kill_engaged', 'survived_engaged']);
    for (const msg of Object.values(parsed)) {
      expect(validateProvenance(msg)).toBe(true);
      const world = scene({ ag_capa_01: WEST });
      const out = observeFight(msg, ctxFor(world, { self: 'ag_capb_02', world: 'world' }));
      expect(out).toEqual({
        kind: 'fight_seen',
        actor: { name: 'ag_capa_01', life: 'ag_capa_01' },
        target: 'zombie',
        key: `fight:${msg.tick}:ag_capa_01:zombie`,
      });
    }
  });
});

describe('FightWindows', () => {
  it('holds 256 pairs and forgets the oldest', () => {
    const windows = new FightWindows();
    for (let i = 0; i < 300; i++) windows.admit(`ag_p${i}:zombie`, 0);
    expect(windows.size).toBe(256);
    // The first pair was dropped, so it is admitted again at the same tick.
    expect(windows.admit('ag_p0:zombie', 0)).toBe(true);
  });

  it('a re-admitted pair is the newest, so the next pair drops another', () => {
    const windows = new FightWindows();
    for (let i = 0; i < 256; i++) windows.admit(`ag_p${i}:zombie`, 0);
    expect(windows.admit('ag_p0:zombie', 600)).toBe(true);
    expect(windows.admit('ag_p256:zombie', 600)).toBe(true);
    expect(windows.size).toBe(256);
    // p0 was observed at tick 600, so at 601 it is still inside its window.
    expect(windows.admit('ag_p0:zombie', 601)).toBe(false);
    // p1 was the least recently observed, so it was dropped and is admitted again.
    expect(windows.admit('ag_p1:zombie', 601)).toBe(true);
  });
});
