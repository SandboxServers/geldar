// Decision 0161: the keyboard map, channel surfing, the wall layouts and the remembered wall.

import { describe, expect, it } from 'vitest';
import { keyCommand, nextLayout, nextMode, suppressesDefault, surf } from '../../web/kino/keys.ts';
import { DEFAULT_PANES } from '../../web/kino/panes/pane-set.ts';
import { readSaved, SAVED_KEY, type StorageLike, writeSaved } from '../../web/kino/panes/saved.ts';
import { planWall } from '../../web/kino/panes/wall-layout.ts';

describe('keyboard map', () => {
  it('maps the Lakitu controls, monitor picks, surfing, layouts and dialogs', () => {
    expect(keyCommand('1')).toEqual({ kind: 'select', index: 0 });
    expect(keyCommand('4')).toEqual({ kind: 'select', index: 3 });
    expect(keyCommand('q')).toEqual({ kind: 'rotate', steps: -1 });
    expect(keyCommand('E')).toEqual({ kind: 'rotate', steps: 1 });
    expect(keyCommand('ArrowLeft')).toEqual({ kind: 'rotate', steps: -1 });
    expect(keyCommand('ArrowRight')).toEqual({ kind: 'rotate', steps: 1 });
    expect(keyCommand('ArrowUp')).toEqual({ kind: 'zoom', steps: -1 });
    expect(keyCommand('-')).toEqual({ kind: 'zoom', steps: 1 });
    expect(keyCommand('r')).toEqual({ kind: 'recentre' });
    expect(keyCommand('c')).toEqual({ kind: 'cycle-mode' });
    expect(keyCommand('[')).toEqual({ kind: 'surf', steps: -1 });
    expect(keyCommand(']')).toEqual({ kind: 'surf', steps: 1 });
    expect(keyCommand('l')).toEqual({ kind: 'cycle-layout' });
    expect(keyCommand('Enter')).toEqual({ kind: 'solo' });
    expect(keyCommand('x')).toEqual({ kind: 'close' });
    expect(keyCommand('t')).toEqual({ kind: 'guide' });
    expect(keyCommand('?')).toEqual({ kind: 'help' });
    expect(keyCommand('i')).toEqual({ kind: 'info' });
  });

  it('leaves browser shortcuts and movement keys alone', () => {
    expect(keyCommand('r', { ctrl: true })).toBeNull();
    expect(keyCommand('t', { meta: true })).toBeNull();
    expect(keyCommand('1', { alt: true })).toBeNull();
    for (const k of ['w', 'a', 's', 'd', ' ', 'Shift', 'Tab']) expect(keyCommand(k)).toBeNull();
  });

  it('stops the page scrolling for Space and the arrows only', () => {
    expect(suppressesDefault(' ')).toBe(true);
    expect(suppressesDefault('ArrowDown')).toBe(true);
    expect(suppressesDefault('Tab')).toBe(false);
    expect(suppressesDefault('Enter')).toBe(false);
  });

  it('cycles modes and layouts', () => {
    expect(nextMode('follow')).toBe('orbit');
    expect(nextMode('orbit')).toBe('free');
    expect(nextMode('free')).toBe('follow');
    expect(nextLayout('wall')).toBe('feature');
    expect(nextLayout('feature')).toBe('solo');
    expect(nextLayout('solo')).toBe('wall');
  });

  it('surfs to the next or previous agent, wrapping round', () => {
    const ids = ['a', 'b', 'c'];
    expect(surf(ids, 'a', 1)).toBe('b');
    expect(surf(ids, 'c', 1)).toBe('a');
    expect(surf(ids, 'a', -1)).toBe('c');
    expect(surf(ids, 'gone', 1)).toBe('a');
    expect(surf([], 'a', 1)).toBeNull();
  });
});

describe('wall layouts', () => {
  const ids = [1, 2, 3];

  it('Wall: equal tiles, free slots shown as empty up to the cap', () => {
    const p = planWall({ ids, active: 2, layout: 'wall', cap: 4, narrow: false });
    expect(p.columns).toBe('repeat(2, minmax(0, 1fr))');
    expect(p.cells.map((c) => c.id)).toEqual([1, 2, 3, null]);
    expect(new Set(p.cells.map((c) => c.area)).size).toBe(4);
    expect(p.hidden).toEqual([]);
    expect(
      planWall({ ids: [1, 2, 3, 4], active: 1, layout: 'wall', cap: 4, narrow: false }).cells.map(
        (c) => c.id,
      ),
    ).toEqual([1, 2, 3, 4]);
  });

  it('Wall on a phone: one column, one empty slot, the empty row short', () => {
    const p = planWall({ ids: [1], active: 1, layout: 'wall', cap: 4, narrow: true });
    expect(p.columns).toBe('repeat(1, minmax(0, 1fr))');
    expect(p.cells.map((c) => c.id)).toEqual([1, null]);
    expect(p.rows).toBe('minmax(16rem, 1fr) 7rem');
  });

  it('an empty wall still shows a monitor to tune', () => {
    const p = planWall({ ids: [], active: null, layout: 'feature', cap: 4, narrow: false });
    expect(p.cells.map((c) => c.id)).toEqual([null, null, null, null]);
  });

  it('Feature: the active monitor spans every row beside a strip of the others and one free slot', () => {
    const p = planWall({ ids, active: 2, layout: 'feature', cap: 4, narrow: false });
    expect(p.columns).toBe('minmax(0, 3fr) minmax(0, 1fr)');
    const main = p.cells[0];
    expect(main).toEqual({ id: 2, area: '1 / 1 / 4 / 2', featured: true });
    expect(p.cells.slice(1).map((c) => c.id)).toEqual([1, 3, null]);
    expect(p.cells.slice(1).every((c) => !c.featured && c.area.endsWith('/ 3'))).toBe(true);
  });

  it('Feature on a phone: the active monitor on top, the others in a row below', () => {
    const p = planWall({ ids, active: 3, layout: 'feature', cap: 3, narrow: true });
    expect(p.cells[0]).toEqual({ id: 3, area: '1 / 1 / 2 / 3', featured: true });
    expect(p.cells.slice(1).map((c) => c.area)).toEqual(['2 / 1 / 3 / 2', '2 / 2 / 3 / 3']);
  });

  it('Solo: only the active monitor; the others are hidden, not closed', () => {
    const p = planWall({ ids, active: 3, layout: 'solo', cap: 4, narrow: false });
    expect(p.cells).toEqual([{ id: 3, area: '1 / 1 / 2 / 2', featured: true }]);
    expect(p.hidden).toEqual([1, 2]);
  });

  it('falls back to the first monitor when the active one is gone', () => {
    expect(planWall({ ids, active: 9, layout: 'solo', cap: 4, narrow: false }).cells[0]?.id).toBe(
      1,
    );
  });

  it('keeps the four-monitor cap the relay enforces (decision 0075)', () => {
    expect(DEFAULT_PANES).toBe(4);
  });
});

describe('remembered wall', () => {
  const mem = (): StorageLike & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };

  it('round-trips the layout and each monitor', () => {
    const s = mem();
    writeSaved(s, { layout: 'feature', monitors: [{ target: 'ag_a', mode: 'orbit' }] });
    expect(readSaved(s, ['ag_a'], 4)).toEqual({
      layout: 'feature',
      monitors: [{ target: 'ag_a', mode: 'orbit' }],
    });
  });

  it('restores only agents the server lists now, at most the cap, and repairs bad fields', () => {
    const s = mem();
    s.data.set(
      SAVED_KEY,
      JSON.stringify({
        layout: 'cinema',
        monitors: [
          { target: 'ag_gone', mode: 'follow' },
          { target: 'ag_a', mode: 'teleport' },
          { target: 'ag_b', mode: 'free' },
          { target: 'ag_a', mode: 'orbit' },
          'junk',
        ],
      }),
    );
    expect(readSaved(s, ['ag_a', 'ag_b'], 2)).toEqual({
      layout: 'wall',
      monitors: [
        { target: 'ag_a', mode: 'follow' },
        { target: 'ag_b', mode: 'free' },
      ],
    });
  });

  it('treats unreadable or blocked storage as nothing saved, and never throws on save', () => {
    const s = mem();
    s.data.set(SAVED_KEY, '{not json');
    expect(readSaved(s, ['ag_a'], 4)).toBeNull();
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readSaved(blocked, ['ag_a'], 4)).toBeNull();
    expect(() => writeSaved(blocked, { layout: 'wall', monitors: [] })).not.toThrow();
    expect(readSaved(null, ['ag_a'], 4)).toBeNull();
  });
});
