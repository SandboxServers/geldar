// One monitor's frame on the wall (decision 0166): the screen, the on-screen display (channel, agent,
// mode, live light), the controls and the folded status line. DOM only; the camera and the feed are
// in pane-view.ts. Agent labels reach the page as text (textContent), never as markup or attributes.

import type { CameraMode } from '../camera/modes.ts';

/** What a monitor's buttons ask for. Every action is view-only. */
export type MonitorAction =
  | { kind: 'mode'; mode: CameraMode }
  | { kind: 'rotate'; steps: number }
  | { kind: 'zoom'; steps: number }
  | { kind: 'zoom-level'; level: number }
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

const ZOOM_LABELS = ['Near', 'Medium', 'Far'] as const;

const MODE_TEXT: Record<CameraMode, string> = { follow: 'Chase', orbit: 'Orbit', free: 'Free' };
/** What a viewer reads for each camera mode. `follow` is the Lakitu chase camera. */
export const modeText = (m: CameraMode): string => MODE_TEXT[m];

export interface MonitorFrame {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  controls: HTMLElement;
  setChannel(n: number): void;
  /** The agent's label; while `tuning`, "Tuning in to <label>" (the server has not named it yet). */
  setLabel(text: string, tuning?: boolean): void;
  setMode(m: CameraMode): void;
  setZoom(level: number | null): void;
  setLive(live: boolean): void;
  setActive(active: boolean): void;
  setFeatured(featured: boolean): void;
  setStatus(text: string): void;
  toggleInfo(): void;
  /** A short message over the screen; empty clears it. */
  say(text: string): void;
  /** A message that stays until cleared (null), with an optional button (Try again). */
  setNotice(text: string | null, action?: { label: string; run: () => void }): void;
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
  const top = document.createElement('div');
  top.className = 'monitor-top';
  top.append(live, ch);
  const bottom = document.createElement('div');
  bottom.className = 'monitor-bottom';
  bottom.append(name, mode);
  osd.append(top, bottom);

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
  const zoomButtons = ZOOM_LABELS.map((label, level) => {
    const b = button(label, null, label);
    b.addEventListener('click', () => onAction({ kind: 'zoom-level', level }));
    return b;
  });
  const modes = group('Camera mode', ...modeButtons.values());
  const zoom = group('Chase distance', ...zoomButtons);
  const segments = document.createElement('div');
  segments.className = 'camera-segments';
  segments.append(modes, zoom);
  const more = document.createElement('details');
  more.className = 'monitor-tools';
  const summary = document.createElement('summary');
  summary.textContent = 'More controls';
  more.append(
    summary,
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
    group('Monitor', solo, info),
  );

  controls.append(segments, more);

  const status = document.createElement('div');
  status.className = 'status';
  status.hidden = true;

  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.setAttribute('role', 'status');
  notice.hidden = true;

  root.append(screen, osd, msg, notice, status);
  let cameraMode: CameraMode = 'follow';
  let cameraZoom: number | null = null;
  const showMode = (): void => {
    const distance = cameraZoom === null ? undefined : ZOOM_LABELS[cameraZoom];
    mode.textContent = distance
      ? `${modeText(cameraMode)} · ${distance.toLowerCase()}`
      : modeText(cameraMode);
  };
  let flickerTimer: ReturnType<typeof setTimeout> | undefined;
  let sayTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    root,
    canvas,
    controls,
    setChannel(n) {
      ch.textContent = `CH ${n}`;
      ch.id = `monitor-channel-${n}`;
      name.id = `monitor-name-${n}`;
      root.setAttribute('aria-labelledby', `${ch.id} ${name.id}`);
    },
    setLabel(text, tuning = false) {
      const shown = tuning ? `Tuning in to ${text}` : text;
      name.textContent = shown;
    },
    setMode(m) {
      cameraMode = m;
      showMode();
      for (const [k, b] of modeButtons) b.setAttribute('aria-pressed', String(k === m));
    },
    setZoom(level) {
      if (level === cameraZoom && zoom.hidden === (level === null)) return;
      cameraZoom = level;
      zoom.hidden = level === null;
      showMode();
      for (const [i, b] of zoomButtons.entries())
        b.setAttribute('aria-pressed', String(i === level));
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
    setNotice(text, action) {
      notice.replaceChildren();
      notice.hidden = text === null;
      if (text === null) return;
      const p = document.createElement('p');
      p.textContent = text;
      notice.appendChild(p);
      if (action) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = action.label;
        b.addEventListener('click', action.run);
        notice.appendChild(b);
      }
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

/** A numbered vacancy. The whole empty card is the tune-in button. */
export function buildEmptySlot(
  onTune: (button: HTMLButtonElement) => void,
  channel = 1,
): HTMLElement {
  const root = document.createElement('section');
  root.className = 'monitor empty';
  root.setAttribute('aria-label', 'Empty monitor');
  const screen = document.createElement('div');
  screen.className = 'screen';
  const card = document.createElement('div');
  card.className = 'nosignal';
  const t = document.createElement('p');
  t.textContent = 'no channel';
  const number = document.createElement('p');
  number.textContent = `CH ${channel}`;
  const b = button(`No signal. Tune in an agent on CH ${channel}`, null);
  b.append(number, t);
  b.addEventListener('click', () => onTune(b));
  card.append(b);
  root.append(screen, card);
  return root;
}
