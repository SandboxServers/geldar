import { describe, expect, it } from 'vitest';
import { SectionCache } from '../../src/kino/section-cache.ts';

const snap = (cx: number, cz: number, sy: number, name: string): string =>
  JSON.stringify({
    type: 'chunk_section',
    chunk_x: cx,
    chunk_z: cz,
    section_y: sy,
    palette: [`minecraft:${name}`],
    bits: 0,
    data: '',
  });
const upd = (x: number, y: number, z: number, name: string): string =>
  JSON.stringify({ type: 'block_update', pos: { x, y, z }, state: `minecraft:${name}` });

describe('SectionCache replay', () => {
  it('serves nothing while empty', () => {
    expect(new SectionCache().replay()).toBeNull();
  });

  it('replays the latest snapshot per section, each followed by its updates in order', () => {
    const c = new SectionCache();
    c.record(snap(0, 0, 4, 'a'));
    c.record(upd(1, 70, 2, 'x'));
    c.record(upd(1, 70, 2, 'y'));
    c.record(snap(1, 0, 4, 'b'));
    c.record(snap(0, 0, 4, 'c')); // supersedes a, and the updates before it
    c.record(upd(2, 64, 3, 'z'));
    expect(c.replay()).toEqual([snap(0, 0, 4, 'c'), upd(2, 64, 3, 'z'), snap(1, 0, 4, 'b')]);
  });

  it('files an update under the section that holds its block, for negative coordinates too', () => {
    const c = new SectionCache();
    c.record(snap(-1, -2, -1, 'n'));
    c.record(upd(-1, -1, -17, 'q')); // chunk (-1, -2), section y -1
    expect(c.replay()).toEqual([snap(-1, -2, -1, 'n'), upd(-1, -1, -17, 'q')]);
  });

  it('ignores the kinds it does not keep', () => {
    const c = new SectionCache();
    c.record(snap(0, 0, 0, 'a'));
    c.record(JSON.stringify({ type: 'entity_positions', entities: [] }));
    c.record(JSON.stringify({ type: 'rate_limited' }));
    expect(c.replay()).toEqual([snap(0, 0, 0, 'a')]);
  });

  it('hello starts the window over', () => {
    const c = new SectionCache();
    c.record(snap(0, 0, 0, 'a'));
    c.record(JSON.stringify({ type: 'hello', feed_version: 1 }));
    expect(c.replay()).toBeNull();
    c.record(snap(0, 0, 0, 'b'));
    expect(c.replay()).toEqual([snap(0, 0, 0, 'b')]);
  });
});

const hello = (radius: number): string =>
  JSON.stringify({ type: 'hello', feed_version: 1, view_radius: radius });
/** A target_moved at block (x, y, z): chunk floor(x / 16), section floor(y / 16). */
const moved = (x: number, y: number, z: number): string =>
  JSON.stringify({ type: 'target_moved', target_agent_id: 'kestrel_01', x, y, z });

describe('SectionCache window eviction', () => {
  it('hello then target_moved at feed start keeps the cache servable and records the sections that follow', () => {
    const c = new SectionCache();
    c.record(hello(2));
    c.record(moved(10.5, 64, -3));
    c.record(snap(0, -1, 4, 'a'));
    c.record(upd(1, 70, -3, 'x'));
    expect(c.replay()).toEqual([snap(0, -1, 4, 'a'), upd(1, 70, -3, 'x')]);
  });

  it('a later target_moved evicts only the sections outside the new window and keeps the rest', () => {
    const c = new SectionCache();
    c.record(hello(2));
    c.record(moved(0.5, 64, 0.5)); // chunk (0, 0), section 4
    c.record(snap(0, 0, 4, 'in'));
    c.record(snap(2, 0, 4, 'edge')); // d = 2, the radius
    c.record(snap(3, 0, 4, 'out')); // d = 3, beyond the radius
    c.record(snap(0, 0, 11, 'high')); // above the band (6 above section 4 is 10)
    c.record(snap(0, 0, 3, 'low')); // 1 below section 4 is 3, still inside
    c.record(upd(1, 70, 1, 'x')); // updates of kept sections survive
    c.record(upd(49, 70, 1, 'y')); // chunk (3, 0): evicted with its section
    c.record(moved(0.5, 64, 0.5)); // same chunk: nothing leaves
    expect(c.replay()).toEqual([
      snap(0, 0, 4, 'in'),
      upd(1, 70, 1, 'x'),
      snap(2, 0, 4, 'edge'),
      snap(0, 0, 3, 'low'),
    ]);
  });

  it('the eviction keeps every section with its own updates, in the order they were cached', () => {
    const c = new SectionCache();
    c.record(hello(2));
    c.record(moved(0.5, 64, 0.5));
    c.record(snap(0, 0, 4, 'a'));
    c.record(snap(-2, 0, 4, 'b'));
    c.record(upd(-30, 70, 2, 'p')); // chunk (-2, 0): still in the window
    c.record(snap(-3, 0, 4, 'c')); // d = 3: out
    c.record(moved(0.5, 64, 0.5));
    expect(c.replay()).toEqual([snap(0, 0, 4, 'a'), snap(-2, 0, 4, 'b'), upd(-30, 70, 2, 'p')]);
  });

  it('negative coordinates: the window is taken around the chunk floor(x / 16), not truncated towards zero', () => {
    const c = new SectionCache();
    c.record(hello(2));
    // x = -17 is chunk -2 (floor), z = -1 is chunk -1, y = 0 is section 0.
    c.record(moved(-17, 0, -1));
    c.record(snap(-2, -1, 0, 'centre'));
    c.record(snap(-4, -1, 0, 'edge')); // d = 2
    c.record(snap(-5, -1, 0, 'out')); // d = 3
    c.record(snap(-2, 2, 0, 'out2')); // d = 3 on z
    c.record(moved(-17, 0, -1));
    expect(c.replay()).toEqual([snap(-2, -1, 0, 'centre'), snap(-4, -1, 0, 'edge')]);
  });

  it('a vertical band tapers beyond the near chunks: 6 above and 1 below within 4 chunks, 2 and 2 beyond', () => {
    const c = new SectionCache();
    c.record(hello(8));
    c.record(moved(0, 0, 0)); // chunk (0, 0), section 0
    c.record(snap(0, 0, 6, 'near-above')); // d = 0: 6 above is kept
    c.record(snap(0, 0, 7, 'near-too-high')); // d = 0: 7 is above the band
    c.record(snap(0, 0, -1, 'near-below')); // d = 0: 1 below is kept
    c.record(snap(0, 0, -2, 'near-too-low'));
    c.record(snap(5, 0, 2, 'far-above')); // d = 5: 2 above is kept
    c.record(snap(6, 0, 3, 'far-too-high')); // d = 6: 3 above, out
    c.record(snap(5, 0, -2, 'far-below')); // d = 5: 2 below is kept
    c.record(snap(4, 0, -2, 'near-edge-below')); // d = 4 is near: 1 below only, so -2 is out
    c.record(moved(0, 0, 0));
    expect(c.replay()).toEqual([
      snap(0, 0, 6, 'near-above'),
      snap(0, 0, -1, 'near-below'),
      snap(5, 0, 2, 'far-above'),
      snap(5, 0, -2, 'far-below'),
    ]);
  });

  it('a section evicted by a move frees its bytes and its cap slot', () => {
    const s = snap(0, 0, 0, 'a');
    const far = snap(9, 0, 0, 'far');
    const c = new SectionCache({
      sectionCap: 2,
      byteBudget: Buffer.byteLength(s) + Buffer.byteLength(far),
    });
    c.record(hello(2));
    c.record(moved(0, 0, 0));
    c.record(far);
    c.record(s);
    c.record(moved(0, 0, 0)); // far is out: its bytes and its slot go
    c.record(snap(1, 0, 0, 'b'));
    expect(c.replay()).toEqual([s, snap(1, 0, 0, 'b')]);
  });

  it('a target_moved the cache cannot place drops it: no hello radius, or no coordinates', () => {
    const noRadius = new SectionCache();
    noRadius.record(snap(0, 0, 0, 'a'));
    noRadius.record(moved(0, 0, 0));
    expect(noRadius.replay()).toBeNull();

    const noCoords = new SectionCache();
    noCoords.record(hello(2));
    noCoords.record(snap(0, 0, 0, 'a'));
    noCoords.record(
      JSON.stringify({ type: 'target_moved', target_agent_id: 'kestrel_01', x: 1, z: 3 }),
    );
    expect(noCoords.replay()).toBeNull();
  });

  it('an update for an unknown section still drops the cache after a move', () => {
    const c = new SectionCache();
    c.record(hello(2));
    c.record(moved(0, 0, 0));
    c.record(snap(0, 0, 0, 'a'));
    c.record(upd(200, 70, 200, 'x'));
    expect(c.replay()).toBeNull();
  });
});

describe('SectionCache invalidation', () => {
  it('a reset serves again after the cache was dropped', () => {
    const c = new SectionCache();
    c.record(snap(0, 0, 0, 'a'));
    c.invalidate();
    c.record(snap(0, 0, 0, 'b'));
    expect(c.replay()).toBeNull();
    c.reset();
    c.record(snap(0, 0, 0, 'c'));
    expect(c.replay()).toEqual([snap(0, 0, 0, 'c')]);
  });

  it('a block_update for a section it has no snapshot of drops the cache', () => {
    const c = new SectionCache();
    c.record(snap(0, 0, 4, 'a'));
    c.record(upd(200, 70, 200, 'x'));
    expect(c.replay()).toBeNull();
  });

  it('a message it cannot read drops the cache', () => {
    const c = new SectionCache();
    c.record(snap(0, 0, 0, 'a'));
    c.record('{"type":"chunk_section",');
    expect(c.replay()).toBeNull();
  });

  it('a section cap overflow drops the cache, and a replaced section does not count twice', () => {
    const c = new SectionCache({ sectionCap: 2 });
    c.record(snap(0, 0, 0, 'a'));
    c.record(snap(1, 0, 0, 'b'));
    c.record(snap(0, 0, 0, 'c')); // a replacement, not a third section
    expect(c.replay()).toEqual([snap(0, 0, 0, 'c'), snap(1, 0, 0, 'b')]);
    c.record(snap(2, 0, 0, 'd'));
    expect(c.replay()).toBeNull();
  });

  it('an update log overflow drops the cache; the cap itself is still served', () => {
    const c = new SectionCache({ updatesPerSection: 2 });
    c.record(snap(0, 0, 0, 'a'));
    c.record(upd(1, 1, 1, 'x'));
    c.record(upd(2, 2, 2, 'y'));
    expect(c.replay()).toHaveLength(3);
    c.record(upd(3, 3, 3, 'z'));
    expect(c.replay()).toBeNull();
  });

  it('a byte budget overflow drops the cache; exactly the budget is still served', () => {
    const s = snap(0, 0, 0, 'a');
    const u = upd(1, 1, 1, 'x');
    const c = new SectionCache({ byteBudget: Buffer.byteLength(s) + Buffer.byteLength(u) });
    c.record(s);
    c.record(u);
    expect(c.replay()).toHaveLength(2);
    c.record(upd(2, 2, 2, 'y'));
    expect(c.replay()).toBeNull();
  });
});
