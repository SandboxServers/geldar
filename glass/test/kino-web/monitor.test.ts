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
    for (const el of [r, ...r.querySelectorAll('*')])
      for (const attr of el.attributes) expect(attr.value).not.toContain(HOSTILE);
    expect(r.querySelector('.mode')?.textContent).toBe('Chase');
    expect(r.querySelector('.live')?.textContent).toBe('Live');
    f.setLive(false);
    expect(r.querySelector('.live')?.textContent).toBe('No feed');
    expect(r.querySelector('.live')?.classList.contains('off')).toBe(true);
  });

  it('marks the pressed mode and the active and featured states', () => {
    const f = mod.buildMonitor(() => undefined);
    f.setMode('orbit');
    const pressed = [...f.controls.querySelectorAll('[aria-pressed="true"]')].map(
      (b) => b.textContent,
    );
    expect(pressed).toEqual(['Orbit']);
    f.setActive(true);
    f.setFeatured(true);
    expect(f.root.classList.contains('active')).toBe(true);
    expect(
      f.controls.querySelector('[aria-label="Solo this monitor"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('turns every button into a view-only action', () => {
    const seen: MonitorAction[] = [];
    const f = mod.buildMonitor((a) => seen.push(a));
    const click = (label: string): void =>
      (f.controls.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
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
      'Near',
      'Medium',
      'Far',
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
      { kind: 'zoom-level', level: 0 },
      { kind: 'zoom-level', level: 1 },
      { kind: 'zoom-level', level: 2 },
    ]);
  });

  it('shows the selected Chase distance and hides the presets in Orbit and Free', () => {
    const f = mod.buildMonitor(() => undefined);
    f.setMode('follow');
    f.setZoom(1);
    expect(f.root.querySelector('.mode')?.textContent).toBe('Chase · medium');
    const zoom = f.controls.querySelector('[aria-label="Chase distance"]') as HTMLElement;
    expect(zoom.hidden).toBe(false);
    expect(zoom.querySelector('[aria-pressed="true"]')?.textContent).toBe('Medium');
    f.setMode('orbit');
    f.setZoom(null);
    expect(zoom.hidden).toBe(true);
    expect(f.root.querySelector('.mode')?.textContent).toBe('Orbit');
  });

  it('folds the status line behind the details button', () => {
    const f = mod.buildMonitor(() => undefined);
    f.setStatus('connected | chunks 3 | entities 1 | atlas ready (9)');
    const status = f.root.querySelector('.status') as HTMLElement;
    const btn = f.controls.querySelector('[aria-label="Show feed details"]') as HTMLElement;
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
    f.setChannel(2);
    f.setLabel(HOSTILE, true);
    expect(f.root.querySelector('.name')?.textContent).toBe(`Tuning in to ${HOSTILE}`);
    expect(f.root.querySelector('img')).toBeNull();
    f.setLabel('Moss');
    expect(f.root.querySelector('.name')?.textContent).toBe('Moss');
    expect(f.root.getAttribute('aria-labelledby')).toBe('monitor-channel-2 monitor-name-2');
    expect(f.root.getAttribute('aria-label')).toBeNull();
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
    const slot = mod.buildEmptySlot(() => tuned++, 4);
    expect(slot.textContent).toBe('CH 4no channel');
    expect(slot.querySelector('button')?.getAttribute('aria-label')).toContain('No signal');
    (slot.querySelector('button') as HTMLButtonElement).click();
    expect(tuned).toBe(1);
  });
});

describe('channel guide', () => {
  function setup(narrow = true) {
    const view = document.createElement('div');
    view.innerHTML = `
      <button id="trigger" disabled>Channels</button>
      <section hidden><div class="guide-content">
        <button class="guide-close">Close</button>
        <p class="guide-caption"></p>
        <ul class="guide-list"></ul>
      </div></section>
      <dialog></dialog>`;
    document.body.appendChild(view);
    const d = view.querySelector('dialog') as HTMLDialogElement;
    const inline = view.querySelector('section') as HTMLElement;
    const trigger = view.querySelector('button') as HTMLButtonElement;
    const media = new EventTarget() as MediaQueryList;
    Object.defineProperty(media, 'matches', { value: narrow, writable: true });
    // happy-dom does not provide native dismissal or focus restoration.
    d.showModal = () => d.setAttribute('open', '');
    d.close = () => {
      d.removeAttribute('open');
      d.dispatchEvent(new win.Event('close') as unknown as Event);
    };
    const calls: string[] = [];
    const guide = new guideMod.ChannelGuide(
      d,
      inline,
      trigger,
      media,
      [
        { id: 'ag_a', label: HOSTILE },
        { id: 'ag_b', label: 'Moss' },
      ],
      {
        tune: (id) => calls.push(`tune ${id}`),
        watchNew: (id, channel) => calls.push(`new ${id} ${channel ?? 'next'}`),
      },
    );
    return { d, inline, trigger, guide, calls, media };
  }

  it('shows permitted labels as text with a sigil and a live channel note', () => {
    const { inline, guide, calls } = setup(false);
    guide.update({ onAir: new Map([['ag_b', [1, 3]]]), activeChannel: 2, canOpen: false });
    expect(inline.hidden).toBe(false);
    expect(inline.querySelector('.guide-caption')?.textContent).toBe(
      'Pick an agent for CH 2. Four monitors at most.',
    );
    const [first, second] = [...inline.querySelectorAll('li')];
    expect(first?.querySelector('.label')?.textContent).toBe(HOSTILE);
    expect(first?.querySelector('canvas.sigil-roster')?.getAttribute('aria-hidden')).toBe('true');
    expect(first?.querySelector('.onair')?.textContent).toBe('available');
    expect(second?.querySelector('.onair')?.textContent).toBe('on CH 1, CH 3');
    expect(inline.querySelector('img')).toBeNull();
    for (const el of inline.querySelectorAll('*'))
      for (const attr of el.attributes) expect(attr.value).not.toContain(HOSTILE);
    expect(second?.querySelector<HTMLButtonElement>('.add')?.disabled).toBe(true);
    second?.querySelector<HTMLButtonElement>('.tune')?.click();
    expect(calls).toEqual(['tune ag_b']);
    expect(guide.isOpen).toBe(false);
  });

  it('fills the numbered vacancy and retains the ordinary tune and New monitor actions', () => {
    const { inline, guide, calls } = setup(false);
    guide.update({ onAir: new Map(), activeChannel: 1, canOpen: true });
    guide.open(4);
    expect(inline.querySelector('.guide-caption')?.textContent).toBe(
      'Pick an agent for CH 4. Four monitors at most.',
    );
    (inline.querySelector('.tune') as HTMLButtonElement).click();
    (inline.querySelector('.tune') as HTMLButtonElement).click();
    (inline.querySelector('.add') as HTMLButtonElement).click();
    expect(calls).toEqual(['new ag_a 4', 'tune ag_a', 'new ag_a next']);
  });

  it('opens the phone sheet, closes from its button and restores the trigger', () => {
    const { d, inline, trigger, guide } = setup();
    guide.update({ onAir: new Map(), activeChannel: 1, canOpen: true });
    expect(inline.querySelector('.guide-content')).toBeNull();
    expect(inline.hidden).toBe(true);
    guide.open(undefined, trigger);
    expect(guide.isOpen).toBe(true);
    expect(document.activeElement).toBe(d.querySelector('.tune'));
    (d.querySelector('.guide-close') as HTMLButtonElement).click();
    expect(guide.isOpen).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('moves the same rows to the wide pane when unfolded and dismisses the modal', () => {
    const { d, inline, trigger, guide, media } = setup();
    guide.update({ onAir: new Map(), activeChannel: 1, canOpen: true });
    guide.open(undefined, trigger);
    const tune = d.querySelector('.tune');
    Object.defineProperty(media, 'matches', { value: false });
    media.dispatchEvent(new Event('change'));
    expect(guide.isOpen).toBe(false);
    expect(inline.querySelector('.tune')).toBe(tune);
    expect(document.activeElement).toBe(tune);
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
