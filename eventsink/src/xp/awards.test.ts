import type { WorldEvent } from '@geldar/contract';
import {
  validateActionOutcomePayload,
  validateActionRecord,
  validateChunkVisitedPayload,
  validateIntentEventPayload,
  validateWorldEvent,
} from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { awardsFor, BUILDING_XP_SOURCE_AVAILABLE, EVIDENCE_KEY_MAX } from './awards.ts';
import { XP_FIXTURES } from './fixtures.ts';
import { CROP_BLOCKS, CROP_ITEMS, isMiningItem, MINING_ITEMS } from './matrix.ts';

const LIFE = 'ag_kestrel_01';

function fixture(name: string): WorldEvent {
  const event = XP_FIXTURES[name];
  if (!event) throw new Error(`no fixture ${name}`);
  return event;
}

/** The evidence keys a fixture awards, in order. */
function keysOf(name: string): string[] {
  return awardsFor(fixture(name)).map((award) => award.evidenceKey);
}

/** A copy of a fixture with its payload replaced. */
function withPayload(name: string, change: Record<string, unknown>): WorldEvent {
  const event = fixture(name);
  return {
    ...event,
    payload: { ...(event.payload as object), ...change } as WorldEvent['payload'],
  };
}

/** A copy of a fixture with its outcome detail replaced. */
function withDetail(name: string, detail: Record<string, unknown>): WorldEvent {
  const result = (fixture(name).payload as { result: object }).result;
  return withPayload(name, { result: { ...result, detail } });
}

/** The action id of a fixture, read from its payload (the key is `<prefix>:<action_id>`). */
function actionIdOf(name: string): string {
  return (fixture(name).payload as { action_id: string }).action_id;
}

/*
 * The members of each matrix set, pinned as literals: a table driven by the exported set would
 * shrink with the set, so cutting a member would not fail. The set tests below fail on any change.
 */
const MINING_ITEM_NAMES = [
  'cobblestone',
  'stone',
  'deepslate',
  'cobbled_deepslate',
  'raw_iron',
  'raw_copper',
  'raw_gold',
  'coal',
  'diamond',
  'emerald',
  'lapis_lazuli',
  'redstone',
];
const CROP_ITEM_NAMES = ['wheat', 'carrot', 'potato', 'beetroot', 'melon_slice', 'pumpkin'];
const CROP_BLOCK_NAMES = [
  'wheat',
  'beetroots',
  'carrots',
  'potatoes',
  'pumpkin_stem',
  'melon_stem',
  'torchflower_crop',
  'pitcher_crop',
];

describe('matrix sets hold exactly the pinned members', () => {
  it('MINING_ITEMS', () => {
    expect(MINING_ITEMS).toEqual(new Set(MINING_ITEM_NAMES));
  });
  it('CROP_ITEMS', () => {
    expect(CROP_ITEMS).toEqual(new Set(CROP_ITEM_NAMES));
  });
  it('CROP_BLOCKS', () => {
    expect(CROP_BLOCKS).toEqual(new Set(CROP_BLOCK_NAMES));
  });
});

describe('combat row', () => {
  it('awards a kill of a mob', () => {
    expect(keysOf('kill_completed')).toEqual([`kill:${actionIdOf('kill_completed')}`]);
  });
  it('awards nothing for a failed or cancelled attack', () => {
    expect(keysOf('kill_failed')).toEqual([]);
    expect(keysOf('kill_cancelled')).toEqual([]);
  });
  it('awards no combat for a player target, or when the target kind is not set', () => {
    expect(keysOf('kill_player_completed')).toEqual([]);
    expect(keysOf('kill_unlabelled_completed')).toEqual([]);
  });
  it('awards nothing while the attack runs', () => {
    expect(keysOf('kill_running')).toEqual([]);
  });
});

describe('mining row', () => {
  it('awards one mining key per completed mine action', () => {
    expect(keysOf('mine_completed')).toEqual([`mine:${actionIdOf('mine_completed')}`]);
    expect(awardsFor(fixture('mine_completed'))[0]?.domain).toBe('mining');
  });
  it('one award per mine action: a 64-block batch is one award', () => {
    expect(awardsFor(fixture('mine_batch_completed'))).toHaveLength(1);
    expect(keysOf('mine_batch_completed')).toEqual([`mine:${actionIdOf('mine_batch_completed')}`]);
  });
  it('awards nothing for failed, cancelled, running, or a non-mining item', () => {
    for (const name of ['mine_failed', 'mine_cancelled', 'mine_running', 'mine_dirt_completed']) {
      expect(keysOf(name), name).toEqual([]);
    }
  });
  it('treats any name ending _ore as mining, and nothing else by suffix', () => {
    expect(isMiningItem('iron_ore')).toBe(true);
    expect(isMiningItem('deepslate_gold_ore')).toBe(true);
    expect(isMiningItem('dirt')).toBe(false);
    expect(isMiningItem('ore_block')).toBe(false);
  });
  it.each([...MINING_ITEM_NAMES, 'iron_ore', 'deepslate_gold_ore'])(
    'a mined %s is a mining award',
    (item) => {
      const event = withDetail('mine_completed', { mined: 1, collected: { [item]: 1 } });
      expect(awardsFor(event).map((award) => award.evidenceKey)).toEqual([
        `mine:${actionIdOf('mine_completed')}`,
      ]);
    },
  );
});

describe('farming rows', () => {
  it('a crop mined is harvest, not mining', () => {
    expect(keysOf('mine_crop_completed')).toEqual([`harvest:${actionIdOf('mine_crop_completed')}`]);
    expect(awardsFor(fixture('mine_crop_completed'))[0]?.domain).toBe('farming');
  });
  it('a crop harvest with no mined block (mined 0) still counts as harvest', () => {
    expect(keysOf('mine_crop_no_block_completed')).toEqual([
      `harvest:${actionIdOf('mine_crop_no_block_completed')}`,
    ]);
  });
  it.each(CROP_ITEM_NAMES)('a harvested %s is a harvest award', (item) => {
    const event = withDetail('mine_crop_no_block_completed', {
      mined: 0,
      collected: { [item]: 1 },
    });
    expect(awardsFor(event).map((award) => award.evidenceKey)).toEqual([
      `harvest:${actionIdOf('mine_crop_no_block_completed')}`,
    ]);
  });
  it('sowing a crop block placed on farmland is sow, one per action', () => {
    expect(keysOf('sow_completed')).toEqual([`sow:${actionIdOf('sow_completed')}`]);
    expect(awardsFor(fixture('sow_completed'))[0]?.domain).toBe('farming');
  });
  it.each(CROP_BLOCK_NAMES)('sowing %s is a sow award', (block) => {
    const event = withDetail('sow_completed', { block });
    expect(awardsFor(event).map((award) => award.evidenceKey)).toEqual([
      `sow:${actionIdOf('sow_completed')}`,
    ]);
  });
  it('placing a non-crop block awards nothing', () => {
    expect(keysOf('place_stone_completed')).toEqual([]);
  });
  it('awards nothing for a failed or cancelled sow', () => {
    expect(keysOf('sow_failed')).toEqual([]);
    expect(keysOf('sow_cancelled')).toEqual([]);
  });
  it('till is preparation and awards nothing', () => {
    expect(keysOf('till_completed')).toEqual([]);
  });
});

describe('crafting row', () => {
  it('awards one craft per completed craft operation, not per item', () => {
    expect(keysOf('craft_completed')).toEqual([`craft:${actionIdOf('craft_completed')}`]);
    expect(awardsFor(fixture('craft_completed'))[0]?.domain).toBe('crafting');
  });
  it('awards nothing for a failed or cancelled craft', () => {
    expect(keysOf('craft_failed')).toEqual([]);
    expect(keysOf('craft_cancelled')).toEqual([]);
  });
});

describe('building row', () => {
  it('the building row is enabled: a completed build intent that carries its program awards', () => {
    expect(BUILDING_XP_SOURCE_AVAILABLE).toBe(true);
    const event = withPayload('build_completed', { program: 'build' });
    expect(awardsFor(event).map((award) => award.evidenceKey)).toEqual([
      `build:${(event.payload as { intent_id: string }).intent_id}`,
    ]);
  });
  it('a completed build intent with no program awards nothing (an event from before AN-09c)', () => {
    expect(fixture('build_completed').payload).not.toHaveProperty('program');
    expect(keysOf('build_completed')).toEqual([]);
  });
  it('awards nothing for other programs or other states', () => {
    for (const name of ['wander_completed', 'build_accepted', 'build_failed', 'build_cancelled']) {
      expect(keysOf(name), name).toEqual([]);
    }
    expect(awardsFor(withPayload('build_completed', { program: 'wander' }))).toEqual([]);
  });
  it('awards nothing for a build intent with program build in any state but completed', () => {
    for (const state of ['failed', 'cancelled', 'interrupted', 'running', 'paused', 'accepted']) {
      expect(awardsFor(withPayload('build_completed', { program: 'build', state })), state).toEqual(
        [],
      );
    }
  });
});

describe('social row', () => {
  it('awards a completed give to someone else', () => {
    expect(keysOf('give_completed')).toEqual([`give:${actionIdOf('give_completed')}`]);
    expect(awardsFor(fixture('give_completed'))[0]?.domain).toBe('social');
  });
  it('a give to the life id is not detectable from the event (AN-09a worknote), so it awards', () => {
    expect(keysOf('give_self_completed')).toEqual([`give:${actionIdOf('give_self_completed')}`]);
  });
  it('awards nothing for an empty recipient', () => {
    expect(awardsFor(withDetail('give_completed', { to: '', item: 'bread', count: 2 }))).toEqual(
      [],
    );
  });
  it('awards nothing for a failed or cancelled give', () => {
    expect(keysOf('give_failed')).toEqual([]);
    expect(keysOf('give_cancelled')).toEqual([]);
  });
});

describe('exploring row', () => {
  it('awards one key per chunk, with the dimension and the chunk index', () => {
    expect(keysOf('chunk_overworld_origin')).toEqual(['chunk:minecraft:overworld:0:0']);
    expect(keysOf('chunk_nether_origin')).toEqual(['chunk:minecraft:the_nether:0:0']);
  });
  it('keeps negative chunk indexes as they are', () => {
    expect(keysOf('chunk_overworld_negative')).toEqual(['chunk:minecraft:overworld:-1:-1']);
  });
  it('an asymmetric chunk keeps cx and cz in their own places', () => {
    expect(keysOf('chunk_overworld_asymmetric')).toEqual(['chunk:minecraft:overworld:2:-5']);
  });
  it.each([
    [3, -7],
    [-7, 3],
    [-1, 0],
    [0, -1],
    [0, 1],
    [1, 0],
  ])('chunk (%i, %i) keeps its index order and sign', (cx, cz) => {
    const event = withPayload('chunk_overworld_origin', { cx, cz });
    expect(awardsFor(event).map((award) => award.evidenceKey)).toEqual([
      `chunk:minecraft:overworld:${cx}:${cz}`,
    ]);
  });
  it('a revisit of the same chunk yields the same key', () => {
    const first = awardsFor(fixture('chunk_overworld_origin'))[0];
    const again = awardsFor({ ...fixture('chunk_overworld_origin'), world_tick: 49_000 })[0];
    expect(again?.evidenceKey).toBe(first?.evidenceKey);
    expect(again?.worldTick).toBe(49_000);
  });
  it('a chunk index beyond the schema bound, or not a safe integer, awards nothing', () => {
    expect(awardsFor(withPayload('chunk_overworld_origin', { cx: 2_000_000 }))).toHaveLength(1);
    expect(awardsFor(withPayload('chunk_overworld_origin', { cx: 2_000_001 }))).toEqual([]);
    expect(awardsFor(withPayload('chunk_overworld_origin', { cz: -2_000_001 }))).toEqual([]);
    expect(awardsFor(withPayload('chunk_overworld_origin', { cz: 1e300 }))).toEqual([]);
  });
  it('a dimension outside the schema pattern awards nothing', () => {
    expect(
      awardsFor(withPayload('chunk_overworld_origin', { dimension: 'Minecraft:Overworld' })),
    ).toEqual([]);
    expect(awardsFor(withPayload('chunk_overworld_origin', { dimension: 'd'.repeat(65) }))).toEqual(
      [],
    );
  });
});

describe('key bounds (the ledger key CHECK is 1 to 200)', () => {
  it('a key of exactly the limit is kept, one character more is refused', () => {
    expect(EVIDENCE_KEY_MAX).toBe(200);
    const fits = 'a'.repeat(EVIDENCE_KEY_MAX - 'mine:'.length);
    expect(keysOf_(withPayload('mine_completed', { action_id: fits }))).toEqual([`mine:${fits}`]);
    const over = 'a'.repeat(EVIDENCE_KEY_MAX - 'mine:'.length + 1);
    expect(awardsFor(withPayload('mine_completed', { action_id: over }))).toEqual([]);
  });
  it('an oversized action id awards nothing and does not throw', () => {
    const huge = 'a'.repeat(1_000_000);
    expect(() => awardsFor(withPayload('mine_completed', { action_id: huge }))).not.toThrow();
    expect(awardsFor(withPayload('mine_completed', { action_id: huge }))).toEqual([]);
  });
});

function keysOf_(event: WorldEvent): string[] {
  return awardsFor(event).map((award) => award.evidenceKey);
}

describe('sources and shared fields', () => {
  it('a running record gives nothing; the completed record carries the life, source and tick', () => {
    const completed = fixture('mine_completed');
    const running = withPayload('mine_completed', { state: 'running', result: null });
    expect(awardsFor(running)).toEqual([]);
    const [award] = awardsFor(completed);
    expect(award?.lifeId).toBe(LIFE);
    expect(award?.sourceEventId).toBe(completed.source_event_id);
    expect(award?.worldTick).toBe(completed.world_tick);
  });

  it('the same action completed twice yields the same key, from two source events', () => {
    const first = awardsFor(fixture('mine_completed'))[0];
    const second = awardsFor({
      ...fixture('mine_completed'),
      source_event_id: 'ev_SECONDRECORD0000000000000',
      world_tick: 48_900,
    })[0];
    expect(second?.evidenceKey).toBe(first?.evidenceKey);
    expect(second?.sourceEventId).not.toBe(first?.sourceEventId);
  });

  it('outcome and receipt views award nothing, even with a life_id added', () => {
    expect(awardsFor(fixture('action_outcome'))).toEqual([]);
    expect(awardsFor(fixture('receipt'))).toEqual([]);
    const id = actionIdOf('mine_completed');
    const result = (fixture('mine_completed').payload as { result: object }).result;
    expect(
      awardsFor(
        withPayload('action_outcome', {
          life_id: LIFE,
          kind: 'mine',
          action_id: id,
          state: 'completed',
          result,
        }),
      ),
    ).toEqual([]);
    expect(
      awardsFor(
        withPayload('receipt', {
          life_id: LIFE,
          kind: 'mine',
          action_id: id,
          state: 'completed',
          result,
        }),
      ),
    ).toEqual([]);
  });

  it('an event whose agent_id is not the life awards nothing', () => {
    expect(awardsFor({ ...fixture('mine_completed'), agent_id: 'ag_other_02' })).toEqual([]);
  });

  it('an unknown kind gives []', () => {
    expect(keysOf('goto_completed')).toEqual([]);
    expect(awardsFor(withPayload('mine_completed', { kind: 'teleport' }))).toEqual([]);
  });

  it('a malformed payload gives [] and never throws', () => {
    const malformed: WorldEvent[] = [
      { ...fixture('mine_completed'), payload: null as unknown as WorldEvent['payload'] },
      { ...fixture('mine_completed'), payload: 'mine' as unknown as WorldEvent['payload'] },
      withPayload('mine_completed', { life_id: 7 }),
      withPayload('mine_completed', { result: 'done' }),
      withPayload('chunk_overworld_origin', { cx: 1.5 }),
    ];
    for (const event of malformed) {
      expect(() => awardsFor(event)).not.toThrow();
      expect(awardsFor(event)).toEqual([]);
    }
  });

  it('a getter that throws gives [] instead of throwing', () => {
    const payload = { ...(fixture('mine_completed').payload as object) };
    Object.defineProperty(payload, 'kind', {
      get() {
        throw new Error('boom');
      },
    });
    const event = { ...fixture('mine_completed'), payload } as WorldEvent;
    expect(awardsFor(event)).toEqual([]);
  });
});

describe('detail gates on a completed record', () => {
  it('a mining award needs at least one block mined, even with a mining item listed', () => {
    expect(
      awardsFor(withDetail('mine_completed', { mined: 0, collected: { cobblestone: 1 } })),
    ).toEqual([]);
  });
  it('a craft needs at least one item crafted', () => {
    expect(awardsFor(withDetail('craft_completed', { item: 'oak_planks', crafted: 0 }))).toEqual(
      [],
    );
  });
  it('a kill needs killed true, not only a mob target', () => {
    expect(awardsFor(withDetail('kill_completed', { target_kind: 'mob', killed: false }))).toEqual(
      [],
    );
  });
});

describe('fixtures are real-shaped: each validates against the contract', () => {
  function payloadOk(event: WorldEvent): boolean {
    switch (event.type) {
      case 'action':
        return validateActionRecord(event.payload).ok;
      case 'intent':
        return validateIntentEventPayload(event.payload).ok;
      case 'chunk_visited':
        return validateChunkVisitedPayload(event.payload).ok;
      case 'action_outcome':
        return validateActionOutcomePayload(event.payload).ok;
      default:
        return true;
    }
  }
  it.each(Object.keys(XP_FIXTURES))('%s', (name) => {
    const event = fixture(name);
    expect(validateWorldEvent(event).ok, name).toBe(true);
    expect(payloadOk(event), name).toBe(true);
  });
});
