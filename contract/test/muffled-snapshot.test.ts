/**
 * Muffled notices in the snapshots (decision 0199, step 8): the Body's optional top-level heard_muffled list,
 * the PlaySnapshot's muffled sentences, and the drift between the two direction sets.
 */
import { readFileSync } from 'node:fs';
import ajv2020Module from 'ajv/dist/2020.js';
import ajvFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { heardMuffledSentence, validateSnapshot } from '../src/index.ts';

const Ajv2020 = ajv2020Module.default;
const addFormats = ajvFormatsModule.default;

type Json = Record<string, unknown>;

const COMPASS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const VERTICAL = ['overhead', 'below'];
const DIRECTIONS = [...COMPASS, ...VERTICAL];
const BANDS = ['near', 'mid', 'far'];

function load(file: string): Json {
  return JSON.parse(readFileSync(new URL(`../schemas/${file}`, import.meta.url), 'utf8')) as Json;
}

const commonSchema = load('common.schema.json');
const snapshotSchema = load('snapshot.schema.json');
const eventSchema = load('heard-muffled-event.schema.json');
const mcpCommonSchema = load('mcp-common.schema.json');

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(commonSchema);
ajv.addSchema(snapshotSchema);
ajv.addSchema(mcpCommonSchema);
const playSnapshot = ajv.getSchema(
  'https://geldar.dev/schemas/mcp-common.schema.json#/$defs/PlaySnapshot',
);
if (playSnapshot === undefined)
  throw new Error('PlaySnapshot is missing from mcp-common.schema.json');

/** A valid Body snapshot with no muffled notices (the Appendix A shape, as in perception-fields.test.ts). */
const BODY: Json = {
  snapshot_id: 'sn_01HZX3V9Q4M2K8R7T6Y5W4E3D2',
  agent_id: 'ag_kestrel_01',
  shard: 'baseline',
  world_time: { day: 14, time_of_day: 'dusk', ticks: 12400, weather: 'clear' },
  self: {
    position: { x: 120, y: 64, z: -45, biome: 'plains' },
    health: 14,
    hunger: 9,
    armor: 2,
    held_item: 'stone_pickaxe',
    inventory: [{ item: 'wheat', count: 12 }],
    effects: [],
    budget_remaining_thoughts: 61,
    days_since_sleep: 1,
  },
  surroundings: { blocks_summary: 'grass plains', notable_blocks: [], entities: [], agents: [] },
  heard: [],
  events_since_last_thought: [],
  revision: 0,
};

/** A valid PlaySnapshot with no muffled notices (the wait result shape from mcp-bundle.test.ts). */
const PLAY: Json = {
  agent_id: 'ag_kestrel_01',
  world_time: { day: 14, time_of_day: 'dusk', weather: 'clear' },
  self: {
    position: { x: 120, y: 64, z: -45, biome: 'plains' },
    health: 14,
    hunger: 9,
    armor: 2,
    held_item: 'stone_pickaxe',
    inventory: [{ item: 'wheat', count: 12 }],
    effects: [],
    budget_remaining_thoughts: 61,
    days_since_sleep: 1,
  },
  surroundings: { blocks_summary: 'grass plains', notable_blocks: [], entities: [], agents: [] },
  heard: [],
  events_since_last_thought: [],
  current_plan: null,
  stuck: null,
  revision: 0,
};

function body(heardMuffled: unknown): Json {
  return { ...structuredClone(BODY), heard_muffled: heardMuffled };
}

function play(extra: Json): Json {
  return { ...structuredClone(PLAY), ...extra };
}

function notice(direction: string, band = 'near'): Json {
  return { direction, band };
}

describe('Body snapshot heard_muffled (decision 0199, step 8)', () => {
  it('still validates a snapshot without the field', () => {
    expect(validateSnapshot(BODY).ok).toBe(true);
  });

  it('accepts 0 to 3 notices, including overhead and below', () => {
    expect(validateSnapshot(body([])).ok).toBe(true);
    expect(validateSnapshot(body([notice('n')])).ok).toBe(true);
    expect(
      validateSnapshot(
        body([notice('overhead', 'near'), notice('ne', 'far'), notice('below', 'mid')]),
      ).ok,
    ).toBe(true);
  });

  it('accepts every direction and band on a single notice', () => {
    for (const direction of DIRECTIONS) {
      for (const band of BANDS) {
        expect(validateSnapshot(body([notice(direction, band)])).ok).toBe(true);
      }
    }
  });

  it('rejects a fourth notice', () => {
    const four = [notice('n'), notice('e'), notice('s'), notice('w')];
    expect(validateSnapshot(body(four)).ok).toBe(false);
  });

  it('rejects coordinates, a speaker and words on a notice', () => {
    for (const extra of [{ x: 4 }, { speaker: 'Sage' }, { words: 'hello' }]) {
      expect(validateSnapshot(body([{ ...notice('n'), ...extra }])).ok).toBe(false);
    }
  });

  it('rejects an unknown direction or band, and a notice without a band', () => {
    expect(validateSnapshot(body([notice('up')])).ok).toBe(false);
    expect(validateSnapshot(body([notice('above')])).ok).toBe(false);
    expect(validateSnapshot(body([notice('n', 'close')])).ok).toBe(false);
    expect(validateSnapshot(body([{ direction: 'n' }])).ok).toBe(false);
  });
});

describe('PlaySnapshot muffled sentences (decision 0199, step 8)', () => {
  it('accepts a snapshot without muffled, and 0, 1 or 3 sentences', () => {
    expect(playSnapshot(PLAY)).toBe(true);
    expect(playSnapshot(play({ muffled: [] }))).toBe(true);
    expect(playSnapshot(play({ muffled: ['You hear a muffled voice close to the north.'] }))).toBe(
      true,
    );
    expect(playSnapshot(play({ muffled: ['a', 'b', 'c'] }))).toBe(true);
  });

  it('rejects a fourth sentence', () => {
    expect(playSnapshot(play({ muffled: ['a', 'b', 'c', 'd'] }))).toBe(false);
  });

  it('rejects a non-string sentence', () => {
    expect(playSnapshot(play({ muffled: [5] }))).toBe(false);
    expect(playSnapshot(play({ muffled: [{ text: 'You hear a muffled voice.' }] }))).toBe(false);
  });

  it('rejects a sentence over 64 characters and accepts exactly 64', () => {
    expect(playSnapshot(play({ muffled: ['a'.repeat(64)] }))).toBe(true);
    expect(playSnapshot(play({ muffled: ['a'.repeat(65)] }))).toBe(false);
  });

  it('keeps heard empty and does not take the Body field heard_muffled', () => {
    expect(playSnapshot(play({ heard: [{ from: 'Pike', text: 'Hi', age_seconds: 1 }] }))).toBe(
      false,
    );
    expect(playSnapshot(play({ heard_muffled: [notice('n')] }))).toBe(false);
  });

  it('fits every heardMuffledSentence in 64 characters, in a muffled list', () => {
    for (const direction of DIRECTIONS) {
      for (const band of BANDS) {
        const sentence = heardMuffledSentence(direction, band);
        expect(sentence.length).toBeLessThanOrEqual(64);
        expect(playSnapshot(play({ muffled: [sentence] }))).toBe(true);
      }
    }
  });
});

describe('muffled direction values stay in step (decision 0199, step 8)', () => {
  /** The compass points and the vertical words a direction property allows, sorted. */
  function directionValues(direction: Json): string[] {
    const branches = direction.anyOf as Json[];
    const values: string[] = [];
    for (const branch of branches) {
      if (typeof branch.$ref === 'string') {
        expect(branch.$ref).toBe('common.schema.json#/$defs/CompassPoint');
        const compass = (commonSchema.$defs as Json).CompassPoint as Json;
        values.push(...(compass.enum as string[]));
      } else {
        values.push(...(branch.enum as string[]));
      }
    }
    return values.sort();
  }

  it('the snapshot and the heard-muffled event list the same direction values', () => {
    const snapshotNotice = (snapshotSchema.$defs as Json).MuffledNotice as Json;
    const snapshotDirection = (snapshotNotice.properties as Json).direction as Json;
    const eventPayload = (eventSchema.$defs as Json).HeardMuffledEvent as Json;
    const eventDirection = (eventPayload.properties as Json).direction as Json;

    expect(directionValues(snapshotDirection)).toEqual(directionValues(eventDirection));
    expect(directionValues(snapshotDirection)).toEqual([...DIRECTIONS].sort());
  });
});
