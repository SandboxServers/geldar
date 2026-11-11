import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  validateByeMessage,
  validateChunkSectionMessage,
  validateKinoClient,
  validateKinoFeed,
} from '../src/generated/validators.js';

const hello = {
  type: 'hello',
  feed_version: 1,
  world: 'world',
  target_agent_id: 'kestrel_01',
  view_radius: 4,
};
const section = {
  type: 'chunk_section',
  chunk_x: -3,
  chunk_z: 7,
  section_y: 4,
  palette: ['minecraft:air', 'minecraft:oak_log[axis=y]'],
  bits: 1,
  data: Buffer.alloc(512).toString('base64'),
};
const update = { type: 'block_update', pos: { x: 1, y: 70, z: -2 }, state: 'minecraft:stone' };
const entities = {
  type: 'entity_positions',
  entities: [
    {
      id: 'e1',
      type: 'minecraft:player',
      agent_id: 'kestrel_01',
      x: 1.5,
      y: 64,
      z: 2,
      yaw: 90,
      pitch: -10,
    },
    { id: 'e2', type: 'minecraft:zombie', x: 0, y: 64, z: 0, yaw: 0, pitch: 0 },
  ],
};
const moved = { type: 'target_moved', target_agent_id: 'kestrel_01', x: 10.5, y: 64, z: -3 };
const bye = { type: 'bye', reason: 'unsubscribed' };
const serverMessages = [hello, section, update, entities, moved, bye];

/** The documented palette-v1 packing: LSB first, cell i at bit i*bits. */
function pack(indices: number[], bits: number): Buffer {
  const out = Buffer.alloc(Math.ceil((indices.length * bits) / 8));
  indices.forEach((value, i) => {
    for (let b = 0; b < bits; b++) {
      const k = i * bits + b;
      if ((value >> b) & 1) out[k >> 3] = (out[k >> 3] ?? 0) | (1 << (k & 7));
    }
  });
  return out;
}

describe('kino feed, server to browser', () => {
  it.each(serverMessages.map((m) => [m.type, m]))(
    'round-trips %s through JSON',
    (_name, message) => {
      const again = JSON.parse(JSON.stringify(message));
      expect(validateKinoFeed(again)).toBe(true);
      expect(again).toEqual(message);
    },
  );

  it('rejects an unknown message type', () => {
    expect(validateKinoFeed({ type: 'teleport', x: 1 })).toBe(false);
  });

  it.each(serverMessages.map((m) => [m.type, m]))(
    'rejects an extra field on %s',
    (_name, message) => {
      expect(validateKinoFeed({ ...message, token: 'x' })).toBe(false);
    },
  );

  it('rejects hello with a feed_version other than 1 or a radius out of range', () => {
    expect(validateKinoFeed({ ...hello, feed_version: 2 })).toBe(false);
    expect(validateKinoFeed({ ...hello, view_radius: 0 })).toBe(false);
    expect(validateKinoFeed({ ...hello, view_radius: 9 })).toBe(false);
  });

  it('rejects a block state that is not a namespaced id with optional states', () => {
    expect(validateKinoFeed({ ...update, state: 'stone.png' })).toBe(false);
    expect(validateKinoFeed({ ...update, state: 'minecraft:stone[axis]' })).toBe(false);
    expect(
      validateKinoFeed({ ...update, state: 'minecraft:oak_log[axis=y,waterlogged=false]' }),
    ).toBe(true);
  });

  it('rejects a chunk section with bits above 12, an empty palette or bad base64', () => {
    expect(validateChunkSectionMessage({ ...section, bits: 13 })).toBe(false);
    expect(validateChunkSectionMessage({ ...section, palette: [] })).toBe(false);
    expect(validateChunkSectionMessage({ ...section, data: 'not base64!' })).toBe(false);
  });

  it('accepts bits 0 with empty data for a one-entry palette', () => {
    expect(
      validateChunkSectionMessage({ ...section, palette: ['minecraft:air'], bits: 0, data: '' }),
    ).toBe(true);
  });

  it('documents a packing whose size matches ceil(4096 * bits / 8) for every width', () => {
    for (let bits = 1; bits <= 12; bits++) {
      const indices = Array.from({ length: 4096 }, (_, i) => i % 2 ** bits);
      const data = pack(indices, bits).toString('base64');
      expect(Buffer.from(data, 'base64').length).toBe(Math.ceil((4096 * bits) / 8));
      expect(validateChunkSectionMessage({ ...section, bits, data })).toBe(true);
    }
  });

  it('packs least significant bit first', () => {
    expect([...pack([1, 0, 1, 1], 1)]).toEqual([0b1101]);
    expect([...pack([3, 1], 4)]).toEqual([0x13]);
  });

  it('rejects an entity position with a pitch beyond 90 or a UUID-style extra', () => {
    const bad = { ...entities, entities: [{ ...entities.entities[1], pitch: 91 }] };
    expect(validateKinoFeed(bad)).toBe(false);
    const extra = { ...entities, entities: [{ ...entities.entities[1], uuid: 'x' }] };
    expect(validateKinoFeed(extra)).toBe(false);
  });

  it('rejects an unknown bye reason', () => {
    expect(validateByeMessage({ type: 'bye', reason: 'banned' })).toBe(false);
  });
});

describe('kino client, browser to server', () => {
  const subscribe = { type: 'subscribe', target_agent_id: 'kestrel_01', mode: 'follow' };
  const unsubscribe = { type: 'unsubscribe' };

  it('round-trips subscribe and unsubscribe', () => {
    for (const message of [subscribe, unsubscribe]) {
      expect(validateKinoClient(JSON.parse(JSON.stringify(message)))).toBe(true);
    }
  });

  it('rejects any server message type from the browser', () => {
    for (const message of [hello, section, update, entities, moved, bye]) {
      expect(validateKinoClient(message)).toBe(false);
    }
  });

  it.each(['x', 'pos', 'command', 'chat', 'input', 'block', 'entity', 'token'])(
    'rejects a world-input field %s on either message',
    (key) => {
      expect(validateKinoClient({ ...subscribe, [key]: 1 })).toBe(false);
      expect(validateKinoClient({ ...unsubscribe, [key]: 1 })).toBe(false);
    },
  );

  it('rejects a bad mode', () => {
    expect(validateKinoClient({ ...subscribe, mode: 'fly' })).toBe(false);
  });

  it('declares exactly two messages, with no field beyond the allowed ones', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../schemas/kino-client.schema.json', import.meta.url), 'utf8'),
    );
    expect(schema.oneOf).toHaveLength(2);
    expect(Object.keys(schema.$defs).sort()).toEqual(['SubscribeMessage', 'UnsubscribeMessage']);
    const fields = (name: string) => Object.keys(schema.$defs[name].properties).sort();
    expect(fields('SubscribeMessage')).toEqual(['mode', 'target_agent_id', 'type']);
    expect(fields('UnsubscribeMessage')).toEqual(['type']);
    for (const def of Object.values<{ additionalProperties: boolean }>(schema.$defs)) {
      expect(def.additionalProperties).toBe(false);
    }
  });
});
