// One monitor's frame on the wall (decision 0161): the screen, the on-screen display (channel, agent,
// mode, live light), the controls and the folded status line. DOM only; the camera and the feed are
// in pane-view.ts. Agent labels reach the page as text (textContent), never as markup or attributes.

import type { CameraMode } from '../camera/modes.ts';

/** What a monitor's buttons ask for. Every action is view-only. */
export type MonitorAction =
  | { kind: 'mode'; mode: CameraMode }
  | { kind: 'rotate'; steps: number }
  | { kind: 'zoom'; steps: number }
  | { kind: 'recentre' }
  | { kind: 'surf'; steps: number }
  | { kind: 'guide' }
  | { kind: 'solo' }
  | { kind: 'info' }
  | { kind: 'close' };

const SVG = 'http://www.w3.org/2000/svg';

/** Fixed icon paths (24x24, stroked). Nothing here comes from data. */
export const ICONS = {
  rotl: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4',
  rotr: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  centre: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  prev: 'M15 5l-7 7l7 7',
  next: 'M9 5l7 7l-7 7',
  guide: 'M4 6h16M4 12h16M4 18h10',
  solo: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  info: 'M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18',
  close: 'M6 6l12 12M18 6L6 18',
} as const;

export function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

function button(label: string, iconPath: string | null, text?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  if (iconPath) b.appendChild(icon(iconPath));
  if (text !== undefined) {
    const s = document.createElement('span');
    s.textContent = text;
    b.appendChild(s);
  }
  return b;
}

const MODE_TEXT: Record<CameraMode, string> = { follow: 'Chase', orbit: 'Orbit', free: 'Free' };
/** What a viewer reads for each camera mode. `follow` is the Lakitu chase camera. */
export const modeText = (m: CameraMode): string => MODE_TEXT[m];

export interface MonitorFrame {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  setChannel(n: number): void;
  setLabel(text: string): void;
  setMode(m: CameraMode): void;
  setLive(live: boolean): void;
  setActive(active: boolean): void;
  setFeatured(featured: boolean): void;
  setStatus(text: string): void;
  toggleInfo(): void;
  /** A short message over the screen; empty clears it. */
  say(text: string): void;
  /** The channel-change static, briefly. */
  flicker(): void;
  /** Static and "Tuning in" until the feed has placed the agent. */
  setTuning(on: boolean): void;
}

export function buildMonitor(onAction: (a: MonitorAction) => void): MonitorFrame {
  const root = document.createElement('section');
  root.className = 'monitor';
  const screen = document.createElement('div');
  screen.className = 'screen';
  const canvas = document.createElement('canvas');
  const scan = document.createElement('div');
  scan.className = 'scan';
  const noise = document.createElement('div');
  noise.className = 'static';
  screen.append(canvas, scan, noise);

  const osd = document.createElement('header');
  osd.className = 'osd';
  const ch = document.createElement('span');
  ch.className = 'ch';
  const name = document.createElement('span');
  name.className = 'name';
  const live = document.createElement('span');
  live.className = 'live';
  live.textContent = 'Live';
  const mode = document.createElement('span');
  mode.className = 'mode';
  osd.append(ch, name, mode, live);

  const msg = document.createElement('div');
  msg.className = 'msg';
  msg.setAttribute('role', 'status');

  const controls = document.createElement('div');
  controls.className = 'controls';
  const group = (label: string, ...items: HTMLElement[]): HTMLElement => {
    const g = document.createElement('div');
    g.className = 'group';
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', label);
    g.append(...items);
    return g;
  };
  const modeButtons = new Map<CameraMode, HTMLButtonElement>();
  for (const m of ['follow', 'orbit', 'free'] as const) {
    const b = button(`${modeText(m)} camera`, null, modeText(m));
    b.addEventListener('click', () => onAction({ kind: 'mode', mode: m }));
    modeButtons.set(m, b);
  }
  const act = (label: string, path: string, a: MonitorAction): HTMLButtonElement => {
    const b = button(label, path);
    b.addEventListener('click', () => onAction(a));
    return b;
  };
  const info = act('Show feed details', ICONS.info, { kind: 'info' });
  info.setAttribute('aria-expanded', 'false');
  const solo = act('Solo this monitor', ICONS.solo, { kind: 'solo' });
  controls.append(
    group('Camera mode', ...modeButtons.values()),
    group(
      'Camera',
      act('Rotate left', ICONS.rotl, { kind: 'rotate', steps: -1 }),
      act('Rotate right', ICONS.rotr, { kind: 'rotate', steps: 1 }),
      act('Zoom out', ICONS.minus, { kind: 'zoom', steps: 1 }),
      act('Zoom in', ICONS.plus, { kind: 'zoom', steps: -1 }),
      act('Recentre behind the agent', ICONS.centre, { kind: 'recentre' }),
    ),
    group(
      'Channel',
      act('Previous agent', ICONS.prev, { kind: 'surf', steps: -1 }),
      act('Choose an agent', ICONS.guide, { kind: 'guide' }),
      act('Next agent', ICONS.next, { kind: 'surf', steps: 1 }),
    ),
    group('Monitor', solo, info, act('Close this monitor', ICONS.close, { kind: 'close' })),
  );

  const status = document.createElement('div');
  status.className = 'status';
  status.hidden = true;

  root.append(screen, osd, msg, controls, status);
  let flickerTimer: ReturnType<typeof setTimeout> | undefined;
  let sayTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    root,
    canvas,
    setChannel(n) {
      ch.textContent = `CH ${n}`;
    },
    setLabel(text) {
      name.textContent = text;
      root.setAttribute('aria-label', `Monitor: ${text}`);
    },
    setMode(m) {
      mode.textContent = modeText(m);
      for (const [k, b] of modeButtons) b.setAttribute('aria-pressed', String(k === m));
    },
    setLive(on) {
      live.classList.toggle('off', !on);
      live.textContent = on ? 'Live' : 'No feed';
    },
    setActive(on) {
      root.classList.toggle('active', on);
    },
    setFeatured(on) {
      root.classList.toggle('featured', on);
      solo.setAttribute('aria-pressed', String(on));
    },
    setStatus(text) {
      status.textContent = text;
    },
    toggleInfo() {
      status.hidden = !status.hidden;
      info.setAttribute('aria-expanded', String(!status.hidden));
    },
    say(text) {
      msg.textContent = text;
      clearTimeout(sayTimer);
      if (text !== '')
        sayTimer = setTimeout(() => {
          msg.textContent = '';
        }, 4000);
    },
    setTuning(on) {
      noise.classList.toggle('tuning', on);
      root.classList.toggle('tuning', on);
    },
    flicker() {
      noise.classList.remove('on');
      void noise.offsetWidth; // restart the animation
      noise.classList.add('on');
      clearTimeout(flickerTimer);
      flickerTimer = setTimeout(() => noise.classList.remove('on'), 450);
    },
  };
}

/** An empty slot: static, "No signal" and a Tune in button. */
export function buildEmptySlot(onTune: () => void): HTMLElement {
  const root = document.createElement('section');
  root.className = 'monitor empty';
  root.setAttribute('aria-label', 'Empty monitor');
  const screen = document.createElement('div');
  screen.className = 'screen';
  const noise = document.createElement('div');
  noise.className = 'static on idle';
  screen.appendChild(noise);
  const card = document.createElement('div');
  card.className = 'nosignal';
  const t = document.createElement('p');
  t.textContent = 'No signal';
  const b = button('Tune in an agent on this monitor', ICONS.plus, 'Tune in');
  b.addEventListener('click', onTune);
  card.append(t, b);
  root.append(screen, card);
  return root;
}
