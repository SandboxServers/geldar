import { describe, expect, it } from 'vitest';
import type { CameraMode } from '../../web/kino/camera/modes.ts';
import { type PaneHandle, PaneSet } from '../../web/kino/panes/pane-set.ts';

function rig(cap?: number) {
  const log: string[] = [];
  const set = new PaneSet((id, t, m): PaneHandle => {
    log.push(`make ${id} ${t} ${m}`);
    return {
      setTarget: (a) => log.push(`target ${id} ${a}`),
      setMode: (m2: CameraMode) => log.push(`mode ${id} ${m2}`),
      dispose: () => log.push(`dispose ${id}`),
    };
  }, cap);
  return { set, log };
}

describe('PaneSet', () => {
  it('each pane has its own target and mode', () => {
    const { set } = rig();
    const a = set.open('alpha', 'follow') as number;
    const b = set.open('beta', 'orbit') as number;
    set.setMode(a, 'free');
    set.setTarget(b, 'gamma');
    expect(set.list()).toEqual([
      { id: a, target: 'alpha', mode: 'free' },
      { id: b, target: 'gamma', mode: 'orbit' },
    ]);
  });

  it('closing one leaves the others up', () => {
    const { set, log } = rig();
    const ids = ['a', 'b', 'c'].map((t) => set.open(t) as number);
    expect(set.close(ids[1] as number)).toBe(true);
    expect(set.close(ids[1] as number)).toBe(false);
    expect(set.list().map((p) => p.target)).toEqual(['a', 'c']);
    expect(log.filter((l) => l.startsWith('dispose'))).toEqual([`dispose ${ids[1]}`]);
  });

  it('holds 4 panes by default, refuses the fifth, and frees a slot on close', () => {
    const { set } = rig();
    const ids = [1, 2, 3, 4].map((i) => set.open(`t${i}`));
    expect(ids.every((i) => i !== null)).toBe(true);
    expect(set.open('t5')).toBeNull();
    set.close(ids[0] as number);
    expect(set.open('t5')).not.toBeNull();
  });

  it('honours a different cap setting', () => {
    const { set } = rig(2);
    set.open('a');
    set.open('b');
    expect(set.open('c')).toBeNull();
    expect(rig(6).set.open('x')).not.toBeNull();
  });

  it('refuses changes to a closed pane', () => {
    const { set } = rig();
    const id = set.open('a') as number;
    set.close(id);
    expect(set.setMode(id, 'orbit')).toBe(false);
    expect(set.setTarget(id, 'b')).toBe(false);
  });
});
