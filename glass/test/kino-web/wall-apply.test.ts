import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { applyWall, type WallMember } from '../../web/kino/panes/wall-apply.ts';

/** A wall with two layout buttons; members and empty slots are happy-dom elements. */
function setup() {
  const win = new Window({ url: 'https://glass.example.test/kino/' });
  const doc = win.document;
  const el = (): HTMLElement => doc.createElement('div') as unknown as HTMLElement;
  const wall = el();
  const buttons = ['wall', 'solo'].map((name) => {
    const b = doc.createElement('button') as unknown as HTMLButtonElement;
    b.dataset.layout = name;
    return b;
  });
  const featured: Array<[number, boolean]> = [];
  const member = (channel: number): WallMember => ({
    channel,
    frame: {
      root: el(),
      setFeatured: (on) => featured.push([channel, on]),
    },
  });
  const emptied: number[] = [];
  const dom = {
    wall,
    layoutButtons: buttons,
    slots: new Map<number, HTMLElement>(),
    emptySlot: (channel: number) => {
      emptied.push(channel);
      return el();
    },
  };
  return { wall, buttons, member, featured, emptied, dom };
}

describe('applyWall', () => {
  it('sets the grid, the layout and the pressed layout button', () => {
    const { wall, buttons, member, dom } = setup();
    applyWall(dom, [member(1), member(2)], {
      layout: 'solo',
      activeChannel: 1,
      narrow: false,
      cap: 4,
    });
    expect(wall.dataset.layout).toBe('solo');
    expect(wall.style.gridTemplateColumns).not.toBe('');
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  });

  it('builds an empty slot for each free channel and keeps it in the slots map', () => {
    const { member, emptied, dom } = setup();
    applyWall(dom, [member(1), member(3)], {
      layout: 'wall',
      activeChannel: null,
      narrow: false,
      cap: 4,
    });
    expect(emptied).toEqual([2, 4]);
    expect([...dom.slots.keys()]).toEqual([2, 4]);
  });

  it('reuses the existing slot instead of building it again', () => {
    const { member, emptied, dom } = setup();
    applyWall(dom, [member(1)], { layout: 'wall', activeChannel: null, narrow: false, cap: 4 });
    applyWall(dom, [member(1)], { layout: 'wall', activeChannel: null, narrow: false, cap: 4 });
    expect(emptied).toEqual([2, 3, 4]);
  });

  it('features the active monitor when the layout is solo', () => {
    const { member, featured, dom } = setup();
    applyWall(dom, [member(1), member(2)], {
      layout: 'solo',
      activeChannel: 2,
      narrow: false,
      cap: 4,
    });
    expect(featured).toContainEqual([2, true]);
  });
});
