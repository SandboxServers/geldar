import { describe, expect, it } from 'vitest';
import {
  canonicalBlockRef,
  parseBlockRef,
  placeStateOf,
  propsHold,
  storedProps,
  takesProps,
} from './block-ref.ts';

describe('parseBlockRef', () => {
  it('reads a bare block name with no properties', () => {
    expect(parseBlockRef('stone')).toEqual({ name: 'stone', props: {} });
  });

  it('reads a name and the properties in brackets', () => {
    expect(parseBlockRef('oak_stairs[facing=north,half=bottom]')).toEqual({
      name: 'oak_stairs',
      props: { facing: 'north', half: 'bottom' },
    });
  });

  it('refuses a property with no value, an empty bracket, and a malformed name', () => {
    expect(() => parseBlockRef('oak_stairs[facing]')).toThrow('not a block reference');
    expect(() => parseBlockRef('oak_stairs[]')).toThrow('not a block reference');
    expect(() => parseBlockRef('Oak Stairs')).toThrow('not a block reference');
    expect(() => parseBlockRef('oak_stairs[facing=north=south]')).toThrow('not a block reference');
  });
});

describe('canonicalBlockRef', () => {
  it('sorts the properties so one block has one spelling', () => {
    expect(canonicalBlockRef(parseBlockRef('oak_stairs[half=bottom,facing=north]'))).toBe(
      'oak_stairs[facing=north,half=bottom]',
    );
  });

  it('is the bare name when there are no properties', () => {
    expect(canonicalBlockRef(parseBlockRef('stone'))).toBe('stone');
  });
});

describe('propsHold', () => {
  it('holds when every listed property of the live block matches', () => {
    expect(
      propsHold({ facing: 'north', half: 'bottom', waterlogged: 'false' }, { facing: 'north' }),
    ).toBe(true);
  });

  it('fails when a listed property differs or is missing', () => {
    expect(propsHold({ facing: 'south' }, { facing: 'north' })).toBe(false);
    expect(propsHold({}, { facing: 'north' })).toBe(false);
  });

  it('holds for a bare name whatever the properties are, and fails for a listed one with none', () => {
    expect(propsHold(null, {})).toBe(true);
    expect(propsHold({ facing: 'north' }, {})).toBe(true);
    expect(propsHold(null, { facing: 'north' })).toBe(false);
  });
});

describe('takesProps and storedProps (review F2)', () => {
  it('takes the keys the place action sets, and a slab half under its stored name type', () => {
    expect(takesProps(parseBlockRef('oak_planks'))).toBe(true);
    expect(takesProps(parseBlockRef('oak_log[axis=y]'))).toBe(true);
    expect(takesProps(parseBlockRef('oak_stairs[half=top]'))).toBe(true);
    expect(takesProps(parseBlockRef('oak_slab[half=top]'))).toBe(true);
    expect(takesProps(parseBlockRef('oak_slab[type=top]'))).toBe(true);
  });

  it('refuses a key the place action cannot set, on every kind of block', () => {
    expect(takesProps(parseBlockRef('oak_door[open=true]'))).toBe(false);
    expect(takesProps(parseBlockRef('oak_stairs[waterlogged=true]'))).toBe(false);
    expect(takesProps(parseBlockRef('oak_stairs[type=top]'))).toBe(false);
    expect(takesProps(parseBlockRef('oak_stairs[facing=north]'))).toBe(false);
    expect(takesProps(parseBlockRef('oak_planks[axis=y]'))).toBe(false);
  });

  it('stores a slab half as type, and leaves every other key as written', () => {
    expect(storedProps(parseBlockRef('oak_slab[half=top]'))).toEqual({ type: 'top' });
    expect(storedProps(parseBlockRef('oak_slab[type=top]'))).toEqual({ type: 'top' });
    expect(storedProps(parseBlockRef('oak_stairs[half=top,axis=x]'))).toEqual({
      half: 'top',
      axis: 'x',
    });
  });

  it('reads a slab type as its half for the place state', () => {
    expect(placeStateOf(parseBlockRef('oak_slab[type=top]'))).toEqual({ half: 'top' });
    expect(placeStateOf(parseBlockRef('oak_slab[half=bottom]'))).toEqual({ half: 'bottom' });
  });
});

describe('placeStateOf', () => {
  it('maps the properties the place action can ask for, on every key', () => {
    expect(placeStateOf(parseBlockRef('oak_log[axis=x]'))).toEqual({ axis: 'x' });
    expect(placeStateOf(parseBlockRef('oak_stairs[facing=west,half=top]'))).toEqual({
      facing: 'west',
      half: 'top',
    });
    expect(placeStateOf(parseBlockRef('oak_stairs[facing=south]'))).toEqual({ facing: 'south' });
  });

  it('is undefined for a bare name and for a property the place action does not ask for', () => {
    expect(placeStateOf(parseBlockRef('stone'))).toBeUndefined();
    expect(placeStateOf(parseBlockRef('oak_door[open=true]'))).toBeUndefined();
  });
});
