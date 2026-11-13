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

describe('SectionCache invalidation', () => {
  it('target_moved drops the cache until a reset', () => {
    const c = new SectionCache();
    c.record(snap(0, 0, 0, 'a'));
    c.record(
      JSON.stringify({ type: 'target_moved', target_agent_id: 'kestrel_01', x: 1, y: 2, z: 3 }),
    );
    expect(c.replay()).toBeNull();
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
