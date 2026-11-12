import { describe, expect, it } from 'vitest';
import { createPerception } from './index.ts';
import { COUNTED_BLOCKS, countsClause, MAX_COUNTS_TEXT } from './nearby-counts.ts';
import { FakeWorld } from './perception.fakes.ts';

// The bot stands at (0.5, 64, 0.5): its feet are in block row 64 and its eyes in row 65.

function summary(world: FakeWorld): string {
  return createPerception(world.bot).surroundings().blocks_summary;
}

describe('counts of natural blocks in the summary', () => {
  it('does not count a log the Body cannot see, under a canopy it stands on', () => {
    // A 3x3 patch of oak leaves in the row under the feet, and the oak log below it, hidden by them.
    // Ruling 5 (0154): the log is out of sight, so only the leaves are counted.
    const world = new FakeWorld();
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) world.set('oak_leaves', x, 63, z);
    }
    world.set('oak_log', 0, 62, 0);
    const surroundings = createPerception(world.bot).surroundings();
    expect(surroundings.standing_on).toBe('oak_leaves');
    expect(surroundings.notable_blocks).toEqual([]);
    expect(surroundings.blocks_summary).toBe('9 oak_leaves nearby');
  });

  it('counts only the cells in sight: a dirt block behind a wall is not counted', () => {
    // A chest wall at x = 2 (rows 64 and 65) hides the dirt at (4, 64, 0); the sand at (0, 64, 4) is open.
    const world = new FakeWorld();
    for (let z = -1; z <= 1; z++) {
      world.set('chest', 2, 64, z);
      world.set('chest', 2, 65, z);
    }
    world.set('dirt', 4, 64, 0);
    world.set('sand', 0, 64, 4);
    expect(summary(world)).toContain('; 1 sand nearby');
    expect(summary(world)).not.toContain('dirt');
  });

  it('counts a block in sight beside a wall, whose ray clears the wall', () => {
    // The same wall at x = 2, but the stone sits off to the side at (4, 64, -6), clear of the wall.
    const world = new FakeWorld();
    for (let z = -1; z <= 1; z++) world.set('chest', 2, 64, z);
    world.set('stone', 4, 64, -6);
    expect(summary(world)).toContain('; 1 stone nearby');
  });

  it('flags the surroundings as counted in sight', () => {
    const surroundings = createPerception(new FakeWorld().bot).surroundings();
    expect(surroundings.blocks_counted_in_sight).toBe(true);
  });

  it('is empty in open air, where the summary stays the empty string', () => {
    const world = new FakeWorld();
    expect(summary(world)).toBe('');
  });

  it('counts within 8 blocks and not beyond', () => {
    const world = new FakeWorld();
    world.set('stone', 8, 64, 0);
    world.set('stone', 9, 64, 0);
    expect(summary(world)).toBe('1 stone nearby');
  });

  it('appends the counts after the visible clauses, joined by a semicolon', () => {
    const world = new FakeWorld();
    world.set('chest', 3, 65, 0);
    world.set('stone', -2, 64, -2);
    expect(summary(world)).toBe('chest 3 east; 1 stone nearby');
  });

  it('keeps whole entries in fixed order and drops the rest past the cap', () => {
    const counts = new Map<string, number>(COUNTED_BLOCKS.map((name) => [name, 99999]));
    const clause = countsClause(counts);
    expect(clause.length).toBeLessThanOrEqual(MAX_COUNTS_TEXT);
    expect(clause.startsWith('99999 oak_log, 99999 spruce_log, 99999 birch_log')).toBe(true);
    expect(clause.endsWith(' nearby')).toBe(true);
    // The cut falls between entries: the text ends on a whole kind, and the cap is nearly reached.
    const last = clause.slice(0, -' nearby'.length).split(', ').pop() ?? '';
    expect(COUNTED_BLOCKS).toContain(last.replace(/^99999 /, ''));
    expect(clause.length).toBeGreaterThan(MAX_COUNTS_TEXT - 25);
    expect(countsClause(counts)).toBe(clause);
  });
});
