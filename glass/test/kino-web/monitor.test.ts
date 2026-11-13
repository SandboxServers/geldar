// Decision 0166: the monitor frame, the channel guide and the canvas binding, in happy-dom.
// Agent labels are text only; the canvas binding takes no keyboard (the page routes keys to the
// active monitor alone, so one key press never drives every camera).

import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CameraRig } from '../../web/kino/camera/rig.ts';
import type { MonitorAction } from '../../web/kino/panes/monitor.ts';

const HOSTILE = '<img src=x onerror=alert(1)>‮evil';
let win: Window;
let mod: typeof import('../../web/kino/panes/monitor.ts');
let guideMod: typeof import('../../web/kino/guide.ts');
let controls: typeof import('../../web/kino/camera/controls.ts');

beforeAll(async () => {
  win = new Window({ url: 'https://glass.example.test/kino/' });
  const g = globalThis as Record<string, unknown>;
  g.document = win.document;
  g.Image = win.Image;
  g.HTMLElement = win.HTMLElement;
  mod = await import('../../web/kino/panes/monitor.ts');
  guideMod = await import('../../web/kino/guide.ts');
  controls = await import('../../web/kino/camera/controls.ts');
});

afterAll(async () => {
  const g = globalThis as Record<string, unknown>;
  delete g.document;
  delete g.Image;
  delete g.HTMLElement;
  await win.happyDOM.close();
});

describe('monitor frame', () => {
  it('shows the channel, the label as text, the mode and the live light', () => {
    const f = mod.buildMonitor(() => undefined);
    f.setChannel(3);
    f.setLabel(HOSTILE);
    f.setMode('follow');
    f.setLive(true);
    const r = f.root;
    expect(r.querySelector('.ch')?.textContent).toBe('CH 3');
    expect(r.querySelector('.name')?.textContent).toBe(HOSTILE);
    expect(r.querySelector('img')).toBeNull();
    expect(r.querySelector('.mode')?.textContent).toBe('Chase');
    expect(r.querySelector('.live')?.textContent).toBe('Live');
    f.setLive(false);
    expect(r.querySelector('.live')?.textContent).toBe('No feed');
    expect(r.querySelector('.live')?.classList.contains('off')).toBe(true);
  });

  it('marks the pressed mode and the active and featured states', () => {
    const f = mod.buildMonitor(() => undefined);
    f.setMode('orbit');
    const pressed = [...f.root.querySelectorAll('[aria-pressed="true"]')].map((b) => b.textContent);
    expect(pressed).toEqual(['Orbit']);
    f.setActive(true);
    f.setFeatured(true);
    expect(f.root.classList.contains('active')).toBe(true);
    expect(
      f.root.querySelector('[aria-label="Solo this monitor"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('turns every button into a view-only action', () => {
    const seen: MonitorAction[] = [];
    const f = mod.buildMonitor((a) => seen.push(a));
    const click = (label: string): void =>
      (f.root.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
    for (const l of [
      'Chase camera',
      'Free camera',
      'Rotate left',
      'Rotate right',
      'Zoom in',
      'Zoom out',
      'Recentre behind the agent',
      'Previous agent',
      'Next agent',
      'Choose an agent',
      'Solo this monitor',
      'Show feed details',
      'Close this monitor',
    ])
      click(l);
    expect(seen).toEqual([
      { kind: 'mode', mode: 'follow' },
      { kind: 'mode', mode: 'free' },
      { kind: 'rotate', steps: -1 },
      { kind: 'rotate', steps: 1 },
      { kind: 'zoom', steps: -1 },
      { kind: 'zoom', steps: 1 },
      { kind: 'recentre' },
      { kind: 'surf', steps: -1 },
      { kind: 'surf', steps: 1 },
      { kind: 'guide' },
      { kind: 'solo' },
      { kind: 'info' },
      { kind: 'close' },
    ]);
  });

  it('folds the status line behind the details button', () => {
    const f = mod.buildMonitor(() => undefined);
    f.setStatus('connected | chunks 3 | entities 1 | atlas ready (9)');
    const status = f.root.querySelector('.status') as HTMLElement;
    const btn = f.root.querySelector('[aria-label="Show feed details"]') as HTMLElement;
    expect(status.hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    f.toggleInfo();
    expect(status.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(status.textContent).toContain('chunks 3');
  });

  it('shows static while tuning, until the feed has placed the agent', () => {
    const f = mod.buildMonitor(() => undefined);
    f.setTuning(true);
    expect(f.root.classList.contains('tuning')).toBe(true);
    expect(f.root.querySelector('.static')?.classList.contains('tuning')).toBe(true);
    f.setTuning(false);
    expect(f.root.classList.contains('tuning')).toBe(false);
  });

  it('says "Tuning in to" until the server names the agent, as text', () => {
    const f = mod.buildMonitor(() => undefined);
    f.setLabel(HOSTILE, true);
    expect(f.root.querySelector('.name')?.textContent).toBe(`Tuning in to ${HOSTILE}`);
    expect(f.root.querySelector('img')).toBeNull();
    f.setLabel('Moss');
    expect(f.root.querySelector('.name')?.textContent).toBe('Moss');
    expect(f.root.getAttribute('aria-label')).toBe('Monitor: Moss');
  });

  it('keeps a notice up with its Try again button until cleared', () => {
    const f = mod.buildMonitor(() => undefined);
    let runs = 0;
    f.setNotice(HOSTILE, { label: 'Try again', run: () => runs++ });
    const box = f.root.querySelector('.notice') as HTMLElement;
    expect(box.hidden).toBe(false);
    expect(box.querySelector('p')?.textContent).toBe(HOSTILE);
    expect(box.querySelector('img')).toBeNull();
    (box.querySelector('button') as HTMLButtonElement).click();
    expect(runs).toBe(1);
    f.setNotice(null);
    expect(box.hidden).toBe(true);
    expect(box.childElementCount).toBe(0);
  });

  it('builds an empty slot that asks to tune in', () => {
    let tuned = 0;
    const slot = mod.buildEmptySlot(() => tuned++);
    expect(slot.textContent).toContain('No signal');
    (slot.querySelector('button') as HTMLButtonElement).click();
    expect(tuned).toBe(1);
  });
});

describe('channel guide', () => {
  function dialog(): HTMLDialogElement {
    const d = document.createElement('dialog') as HTMLDialogElement;
    const caption = document.createElement('p');
    caption.className = 'guide-caption';
    const list = document.createElement('ul');
    list.className = 'guide-list';
    d.append(caption, list);
    document.body.appendChild(d);
    // happy-dom's dialog: make showModal and close plain toggles.
    d.showModal = () => d.setAttribute('open', '');
    d.close = () => d.removeAttribute('open');
    return d;
  }

  it('lists agents as text, says which channels carry them, and tunes or opens on a click', () => {
    const d = dialog();
    const calls: string[] = [];
    const g = new guideMod.ChannelGuide(
      d,
      [
        { id: 'ag_a', label: HOSTILE },
        { id: 'ag_b', label: 'Moss' },
      ],
      { tune: (id) => calls.push(`tune ${id}`), watchNew: (id) => calls.push(`new ${id}`) },
    );
    g.open({ onAir: new Map([['ag_b', [1, 3]]]), activeChannel: 2, canOpen: false }, (id) => id);
    expect(d.querySelector('.guide-caption')?.textContent).toBe('Choose an agent for CH 2.');
    const items = [...d.querySelectorAll('li')] as HTMLElement[];
    const [first, second] = items as [HTMLElement, HTMLElement];
    expect(first.querySelector('.label')?.textContent).toBe(HOSTILE);
    expect(d.querySelector('img')).toBeNull();
    expect(second.querySelector('.onair')?.textContent).toBe('On CH 1, CH 3');
    expect((second.querySelector('.add') as HTMLButtonElement).disabled).toBe(true);
    (second.querySelector('.tune') as HTMLButtonElement).click();
    expect(calls).toEqual(['tune ag_b']);
    expect(g.isOpen).toBe(false);
    g.open({ onAir: new Map(), activeChannel: null, canOpen: true }, (id) => id);
    expect(d.querySelector('.guide-caption')?.textContent).toBe(
      'Choose an agent to watch on a new monitor.',
    );
    (first.querySelector('.add') as HTMLButtonElement).click();
    expect(calls).toEqual(['tune ag_b', 'new ag_a']);
  });

  it('from an empty slot, a choice fills a new monitor instead of retuning the active one', () => {
    const d = dialog();
    const calls: string[] = [];
    const g = new guideMod.ChannelGuide(d, [{ id: 'ag_a', label: 'Ember' }], {
      tune: (id) => calls.push(`tune ${id}`),
      watchNew: (id) => calls.push(`new ${id}`),
    });
    g.open({ onAir: new Map(), activeChannel: 1, canOpen: true, newMonitor: true }, (id) => id);
    expect(d.querySelector('.guide-caption')?.textContent).toBe(
      'Choose an agent to watch on a new monitor.',
    );
    (d.querySelector('.tune') as HTMLButtonElement).click();
    expect(calls).toEqual(['new ag_a']);
    // The ordinary Channels button still retunes the active monitor.
    g.open({ onAir: new Map(), activeChannel: 1, canOpen: true }, (id) => id);
    (d.querySelector('.tune') as HTMLButtonElement).click();
    expect(calls).toEqual(['new ag_a', 'tune ag_a']);
  });

  it('fetches no skin face until the guide is first opened, and each face once', () => {
    const g0 = globalThis as Record<string, unknown>;
    const real = g0.Image;
    let made = 0;
    g0.Image = class {
      onload: (() => void) | null = null;
      src = '';
      width = 0;
      constructor() {
        made++;
      }
    };
    try {
      const d = dialog();
      const g = new guideMod.ChannelGuide(
        d,
        [
          { id: 'ag_a', label: 'Ember' },
          { id: 'ag_b', label: 'Moss' },
        ],
        { tune: () => undefined, watchNew: () => undefined },
      );
      expect(made).toBe(0);
      g.open({ onAir: new Map(), activeChannel: 1, canOpen: true }, (id) => id);
      expect(made).toBe(2);
      g.close();
      g.open({ onAir: new Map(), activeChannel: 1, canOpen: true }, (id) => id);
      expect(made).toBe(2);
    } finally {
      g0.Image = real;
    }
  });
});

describe('canvas binding', () => {
  it('binds no keyboard listener, so keys reach only the monitor the page routes them to', () => {
    const added: string[] = [];
    const real = globalThis.addEventListener;
    globalThis.addEventListener = ((type: string) =>
      void added.push(type)) as typeof addEventListener;
    try {
      const canvas = document.createElement('canvas') as unknown as HTMLElement;
      const stop = controls.bindPointer(canvas, () => new CameraRig(), {
        onActivate: () => undefined,
      });
      stop();
    } finally {
      globalThis.addEventListener = real;
    }
    expect(added.filter((t) => t.startsWith('key'))).toEqual([]);
  });

  it('makes the monitor active on a press and recentres on a double-click', () => {
    const canvas = document.createElement('canvas') as unknown as HTMLElement;
    const rig = new CameraRig();
    rig.rotateStep(2);
    let activated = 0;
    controls.bindPointer(canvas, () => rig, { onActivate: () => activated++ });
    canvas.dispatchEvent(new win.PointerEvent('pointerdown', { pointerId: 1 }) as unknown as Event);
    expect(activated).toBe(1);
    canvas.dispatchEvent(new win.MouseEvent('dblclick') as unknown as Event);
    expect(rig.chase.offsetGoal).toBe(0);
  });
});
