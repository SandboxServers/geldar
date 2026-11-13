import { describe, expect, it } from 'vitest';
import {
  defaultBlock,
  OAK_DOOR_OPEN_LOWER,
  OAK_DOOR_OPEN_UPPER,
  realBlock,
} from './door-blocks.fakes.ts';
import { block, scriptedBot } from './escape-ladder.fakes.ts';
import { inPit } from './escape-stairs.ts';

/** A bot on a stone floor with a two-high wall on its east side, made of `wall` blocks. */
const pitWith = (lower: unknown, upper: unknown) =>
  scriptedBot({
    blocks: {
      '0,63,0': block('stone'),
      '1,64,0': lower as never,
      '1,65,0': upper as never,
    },
  }).asBot;

describe('inPit: doors and fence gates are not pit walls', () => {
  it('a two-high stone wall beside the bot is a pit', () => {
    expect(inPit(pitWith(block('stone'), block('stone')))).toBe(true);
  });

  it('a two-high wall of real open oak door halves is not a pit wall', () => {
    expect(inPit(pitWith(realBlock(OAK_DOOR_OPEN_LOWER), realBlock(OAK_DOOR_OPEN_UPPER)))).toBe(
      false,
    );
  });

  it('a two-high wall of iron doors is a pit wall: iron needs redstone, so it stays a wall', () => {
    expect(inPit(pitWith(defaultBlock('iron_door'), defaultBlock('iron_door')))).toBe(true);
  });

  it('a two-high fence gate beside the bot is not a pit wall', () => {
    expect(inPit(pitWith(block('oak_fence_gate'), block('oak_fence_gate')))).toBe(false);
  });
});
