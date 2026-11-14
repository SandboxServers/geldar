import { describe, expect, it } from 'vitest';
import {
  applyWaitDelta,
  canonicalJson,
  type DeltaSections,
  parseWaitDeltaLives,
  type SentMark,
  WAIT_DELTA_FULL_EVERY,
  waitDeltaOn,
} from './wait-delta.ts';

const RECIPES = ['oak_planks', 'stick', 'crafting_table'];
const BLOCKS = [{ type: 'furnace', x: 1, y: 64, z: 2, lit: true }];

interface Turn {
  session?: string | undefined;
  cursor?: string | undefined;
  resultCursor?: string;
  recipes?: string[];
  blocks?: { type: string; x: number; y: number; z: number; lit?: boolean }[];
  position?: { x: number; y: number; z: number };
  on?: boolean;
  trimmed?: { unlocked_recipes: boolean; notable_blocks: boolean };
}

/** One `wait` of one life: applies the delta to fresh sections and returns them. */
function turn(sent: Map<string, SentMark>, t: Turn = {}): DeltaSections {
  const sections: DeltaSections = {
    self: {
      unlocked_recipes: [...(t.recipes ?? RECIPES)],
      position: t.position ?? { x: 10, y: 64, z: -3 },
    },
    surroundings: { notable_blocks: (t.blocks ?? BLOCKS).map((b) => ({ ...b })) },
  };
  applyWaitDelta(
    sent,
    {
      lifeId: 'life-1',
      session: 'session-a',
      cursor: undefined,
      resultCursor: 'c1',
      trimmed: { unlocked_recipes: false, notable_blocks: false },
      ...t,
    },
    sections,
    t.on ?? true,
  );
  return sections;
}

/**
 * The wait after wait number n: it carries the cursor wait n returned (c<n>) and returns c<n+1>.
 * The first wait returns c1 (the default of `turn`).
 */
function next(sent: Map<string, SentMark>, n: number, extra: Turn = {}): DeltaSections {
  return turn(sent, { cursor: `c${n}`, resultCursor: `c${n + 1}`, ...extra });
}

const UNCHANGED_RECIPES = { unchanged: true, count: RECIPES.length };
const UNCHANGED_BLOCKS = { unchanged: true, count: BLOCKS.length };

describe('wait deduplicates unchanged sections (decision 0221)', () => {
  it('the first wait of a session is full', () => {
    const sent = new Map<string, SentMark>();
    const first = turn(sent);
    expect(first.self.unlocked_recipes).toEqual(RECIPES);
    expect(first.surroundings.notable_blocks).toEqual(BLOCKS);
  });

  it('a second wait with the same cursor and state marks both sections unchanged', () => {
    const sent = new Map<string, SentMark>();
    turn(sent);
    const second = next(sent, 1);
    expect(second.self.unlocked_recipes).toEqual(UNCHANGED_RECIPES);
    expect(second.surroundings.notable_blocks).toEqual(UNCHANGED_BLOCKS);
  });

  it('a recipe added gives the full recipe list, and notable blocks stay unchanged', () => {
    const sent = new Map<string, SentMark>();
    turn(sent);
    const added = next(sent, 1, { recipes: [...RECIPES, 'furnace'] });
    expect(added.self.unlocked_recipes).toEqual([...RECIPES, 'furnace']);
    expect(added.surroundings.notable_blocks).toEqual(UNCHANGED_BLOCKS);
  });

  it('a changed position gives the full notable-block list, and recipes stay unchanged', () => {
    const sent = new Map<string, SentMark>();
    turn(sent);
    const moved = next(sent, 1, { position: { x: 11, y: 64, z: -3 } });
    expect(moved.surroundings.notable_blocks).toEqual(BLOCKS);
    expect(moved.self.unlocked_recipes).toEqual(UNCHANGED_RECIPES);
  });

  it('a stale or missing cursor gives both sections full', () => {
    const sent = new Map<string, SentMark>();
    turn(sent);
    const stale = turn(sent, { cursor: 'c0-old', resultCursor: 'c1' });
    expect(stale.self.unlocked_recipes).toEqual(RECIPES);
    expect(stale.surroundings.notable_blocks).toEqual(BLOCKS);
    const none = turn(sent, { cursor: undefined, resultCursor: 'c2' });
    expect(none.self.unlocked_recipes).toEqual(RECIPES);
    expect(none.surroundings.notable_blocks).toEqual(BLOCKS);
  });

  it('every 10th wait of a session is full again, and the wait after it is unchanged', () => {
    const sent = new Map<string, SentMark>();
    turn(sent);
    // wait k (1-based) is next(sent, k - 1); waits 2 to 9 are unchanged
    for (let k = 2; k < WAIT_DELTA_FULL_EVERY; k++) {
      const s = next(sent, k - 1);
      expect(s.self.unlocked_recipes).toEqual(UNCHANGED_RECIPES);
    }
    const tenth = next(sent, WAIT_DELTA_FULL_EVERY - 1);
    expect(tenth.self.unlocked_recipes).toEqual(RECIPES);
    expect(tenth.surroundings.notable_blocks).toEqual(BLOCKS);
    const eleventh = next(sent, WAIT_DELTA_FULL_EVERY);
    expect(eleventh.self.unlocked_recipes).toEqual(UNCHANGED_RECIPES);
    expect(eleventh.surroundings.notable_blocks).toEqual(UNCHANGED_BLOCKS);
  });

  it('a new session for the same life gets full sections, and each session has its own count', () => {
    const sent = new Map<string, SentMark>();
    turn(sent, { session: 'session-a' });
    next(sent, 1, { session: 'session-a' });
    const other = next(sent, 2, { session: 'session-b' });
    expect(other.self.unlocked_recipes).toEqual(RECIPES);
    expect(other.surroundings.notable_blocks).toEqual(BLOCKS);
    const again = next(sent, 3, { session: 'session-b' });
    expect(again.self.unlocked_recipes).toEqual(UNCHANGED_RECIPES);
  });

  it('a sessionless call is always full', () => {
    const sent = new Map<string, SentMark>();
    turn(sent, { session: undefined });
    const again = next(sent, 1, { session: undefined });
    expect(again.self.unlocked_recipes).toEqual(RECIPES);
    expect(again.surroundings.notable_blocks).toEqual(BLOCKS);
  });

  it('with the flag off every wait is full', () => {
    const sent = new Map<string, SentMark>();
    turn(sent, { on: false });
    const second = next(sent, 1, { on: false });
    expect(second.self.unlocked_recipes).toEqual(RECIPES);
    expect(second.surroundings.notable_blocks).toEqual(BLOCKS);
    expect(sent.size).toBe(0);
  });

  it('a section that was cut is never unchanged', () => {
    const sent = new Map<string, SentMark>();
    turn(sent);
    const cut = next(sent, 1, {
      trimmed: { unlocked_recipes: true, notable_blocks: true },
    });
    expect(cut.self.unlocked_recipes).toEqual(RECIPES);
    expect(cut.surroundings.notable_blocks).toEqual(BLOCKS);
    const after = next(sent, 2);
    expect(after.self.unlocked_recipes).toEqual(RECIPES);
    expect(after.surroundings.notable_blocks).toEqual(BLOCKS);
  });
});

describe('the flag and the state', () => {
  it('parses the list of lives, all, and empty as off', () => {
    expect(parseWaitDeltaLives(undefined)).toEqual({ all: false, lives: new Set() });
    expect(parseWaitDeltaLives('')).toEqual({ all: false, lives: new Set() });
    expect(parseWaitDeltaLives(' , ')).toEqual({ all: false, lives: new Set() });
    expect(parseWaitDeltaLives('all')).toEqual({ all: true, lives: new Set() });
    const some = parseWaitDeltaLives('life-1, life-2');
    expect(some.all).toBe(false);
    expect(waitDeltaOn(some, 'life-2')).toBe(true);
  });

  it('a life that is not in the list is full', () => {
    const lives = parseWaitDeltaLives('life-2');
    expect(waitDeltaOn(lives, 'life-1')).toBe(false);
    expect(waitDeltaOn(parseWaitDeltaLives('all'), 'life-1')).toBe(true);
    expect(waitDeltaOn(undefined, 'life-1')).toBe(false);
    const sent = new Map<string, SentMark>();
    turn(sent, { on: waitDeltaOn(lives, 'life-1') });
    const second = next(sent, 1, { on: waitDeltaOn(lives, 'life-1') });
    expect(second.self.unlocked_recipes).toEqual(RECIPES);
  });

  it('sorts keys so the same value always gives the same text', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 1 }] })).toBe('{"a":[{"c":1,"d":2}],"b":1}');
  });
});
