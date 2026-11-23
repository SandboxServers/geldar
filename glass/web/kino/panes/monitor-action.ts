// The monitor action switch, pulled out of main.ts (the page's wiring) so each action is unit tested.
// Pure: it decides which host function to call; it touches no DOM and no storage.

import type { CameraMode } from '../camera/modes.ts';
import { type Layout, surf } from '../keys.ts';
import type { MonitorAction } from './monitor.ts';

/** The camera rig, as far as an action moves it. */
export interface ActionRig {
  mode: CameraMode;
  chase: { zoom: number };
  rotateStep(steps: number): void;
  zoomStep(steps: number): void;
  recentre(): void;
}

/** One monitor as an action sees it. */
export interface ActionMonitor {
  id: number;
  channel: number;
  frame: { toggleInfo(): void };
  view: {
    mode: CameraMode;
    target: string;
    rig: ActionRig;
    setMode(mode: CameraMode): void;
  };
}

/** What main.ts does for each action; the switch only decides which of these to call. */
export interface ActionHost<M extends ActionMonitor> {
  readonly ids: readonly string[];
  layout(): Layout;
  setActive(id: number): void;
  drawZoom(m: M): void;
  save(): void;
  retune(m: M, target: string, settle: boolean): void;
  setLayout(l: Layout): void;
  openGuide(): void;
  close(id: number): void;
}

/** Runs one action on a monitor: selects it first, then calls the host for what the action does. */
export function runMonitorAction<M extends ActionMonitor>(
  m: M,
  a: MonitorAction,
  host: ActionHost<M>,
): void {
  host.setActive(m.id);
  const rig = m.view.rig;
  switch (a.kind) {
    case 'mode':
      m.view.setMode(a.mode);
      host.drawZoom(m);
      host.save();
      break;
    case 'rotate':
      rig.rotateStep(a.steps);
      break;
    case 'zoom':
      rig.zoomStep(a.steps);
      host.drawZoom(m);
      break;
    case 'zoom-level':
      if (rig.mode === 'follow') rig.zoomStep(a.level - rig.chase.zoom);
      host.drawZoom(m);
      break;
    case 'recentre':
      rig.recentre();
      break;
    case 'surf': {
      const next = surf([...host.ids], m.view.target, a.steps);
      if (next) host.retune(m, next, true);
      break;
    }
    case 'guide':
      host.openGuide();
      break;
    case 'solo':
      host.setLayout(host.layout() === 'solo' ? 'wall' : 'solo');
      break;
    case 'info':
      m.frame.toggleInfo();
      break;
    case 'close':
      host.close(m.id);
      break;
  }
}
