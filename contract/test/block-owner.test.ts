import { describe, expect, it } from 'vitest';
import { validateBlockOwner } from '../src/generated/validators.js';

const query = { world: 'world', chunk_x: -3, chunk_z: 7 };
const block = { x: 16, y: 64, z: -20, owner: 'kestrel_01' };
const reply = { world: 'world', chunk_x: -3, chunk_z: 7, blocks: [block], truncated: false };
const changed = { world: 'world', x: 16, y: 64, z: -20, owner: 'kestrel_01' };

/** A list of `count` owned blocks, distinct cells of one chunk, for the maxItems checks. */
const blocks = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    x: i % 16,
    y: 64,
    z: Math.floor(i / 16) % 16,
    owner: 'a',
  }));

describe('BlockOwner schema (block-owner.schema.json)', () => {
  it('accepts a query, a reply and a change', () => {
    expect(validateBlockOwner(query)).toBe(true);
    expect(validateBlockOwner(reply)).toBe(true);
    expect(validateBlockOwner(changed)).toBe(true);
  });

  it('accepts a change that clears the owner with null', () => {
    expect(validateBlockOwner({ ...changed, owner: null })).toBe(true);
  });

  it('accepts a reply with the maximum of 4096 blocks and truncated true', () => {
    expect(validateBlockOwner({ ...reply, blocks: blocks(4096), truncated: true })).toBe(true);
  });

  it('rejects a reply with 4097 blocks, even when truncated is true', () => {
    expect(validateBlockOwner({ ...reply, blocks: blocks(4097), truncated: true })).toBe(false);
  });

  it('rejects a non-string owner in a block and in a change', () => {
    expect(validateBlockOwner({ ...reply, blocks: [{ ...block, owner: 7 }] })).toBe(false);
    expect(validateBlockOwner({ ...changed, owner: 7 })).toBe(false);
    expect(validateBlockOwner({ ...changed, owner: ['kestrel_01'] })).toBe(false);
  });

  it('rejects an empty owner', () => {
    expect(validateBlockOwner({ ...changed, owner: '' })).toBe(false);
    expect(validateBlockOwner({ ...reply, blocks: [{ ...block, owner: '' }] })).toBe(false);
  });

  it('rejects extra keys at every level', () => {
    expect(validateBlockOwner({ ...query, extra: 1 })).toBe(false);
    expect(validateBlockOwner({ ...reply, extra: 1 })).toBe(false);
    expect(validateBlockOwner({ ...changed, extra: 1 })).toBe(false);
    expect(validateBlockOwner({ ...reply, blocks: [{ ...block, extra: 1 }] })).toBe(false);
  });

  it('rejects a missing field in each message and in a block', () => {
    const { world: _w, ...noWorld } = query;
    const { truncated: _t, ...noTruncated } = reply;
    const { owner: _o, ...noOwner } = changed;
    const { owner: _b, ...noBlockOwner } = block;
    expect(validateBlockOwner(noWorld)).toBe(false);
    expect(validateBlockOwner(noTruncated)).toBe(false);
    expect(validateBlockOwner(noOwner)).toBe(false);
    expect(validateBlockOwner({ ...reply, blocks: [noBlockOwner] })).toBe(false);
  });

  it('rejects a non-integer or out-of-range coordinate', () => {
    expect(validateBlockOwner({ ...query, chunk_x: 1.5 })).toBe(false);
    expect(validateBlockOwner({ ...query, chunk_z: 2000000 })).toBe(false);
    expect(validateBlockOwner({ ...changed, y: 2049 })).toBe(false);
    expect(validateBlockOwner({ ...changed, x: '16' })).toBe(false);
  });

  it('rejects a world name that is empty', () => {
    expect(validateBlockOwner({ ...query, world: '' })).toBe(false);
  });

  it('rejects a value that is none of the three messages', () => {
    expect(validateBlockOwner({ world: 'world' })).toBe(false);
    expect(validateBlockOwner('geldar')).toBe(false);
  });
});
