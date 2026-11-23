import { describe, expect, it } from 'vitest';
import type { CameraMode } from '../../web/kino/camera/modes.ts';
import type { Layout } from '../../web/kino/keys.ts';
import type { MonitorAction } from '../../web/kino/panes/monitor.ts';
import {
  type ActionHost,
  type ActionMonitor,
  runMonitorAction,
} from '../../web/kino/panes/monitor-action.ts';

/** A monitor on channel 2 (id 7), watching ag_a, with a rig the test can read; calls are recorded in order. */
function setup(opts: { mode?: CameraMode; zoom?: number; layout?: 'wall' | 'solo' } = {}) {
  const calls: string[] = [];
  const rig = {
    mode: opts.mode ?? 'follow',
    chase: { zoom: opts.zoom ?? 5 },
    rotateStep: (n: number) => calls.push(`rotate ${n}`),
    zoomStep: (n: number) => calls.push(`zoomStep ${n}`),
    recentre: () => calls.push('recentre'),
  };
  const m: ActionMonitor = {
    id: 7,
    channel: 2,
    frame: { toggleInfo: () => calls.push('info') },
    view: {
      mode: rig.mode,
      target: 'ag_a',
      rig,
      setMode: (mode) => calls.push(`setMode ${mode}`),
    },
  };
  let layout: Layout = opts.layout ?? 'wall';
  const host: ActionHost<ActionMonitor> = {
    ids: ['ag_a', 'ag_b', 'ag_c'],
    layout: () => layout,
    setActive: (id) => calls.push(`active ${id}`),
    drawZoom: () => calls.push('drawZoom'),
    save: () => calls.push('save'),
    retune: (_m, target, settle) => calls.push(`retune ${target} ${settle}`),
    setLayout: (l) => {
      layout = l;
      calls.push(`layout ${l}`);
    },
    openGuide: () => calls.push('guide'),
    close: (id) => calls.push(`close ${id}`),
  };
  const run = (a: MonitorAction): string[] => {
    calls.length = 0;
    runMonitorAction(m, a, host);
    return [...calls];
  };
  return { run };
}

describe('runMonitorAction', () => {
  it('selects the monitor before every action', () => {
    const { run } = setup();
    const actions: MonitorAction[] = [
      { kind: 'mode', mode: 'orbit' },
      { kind: 'rotate', steps: 1 },
      { kind: 'zoom', steps: -1 },
      { kind: 'zoom-level', level: 3 },
      { kind: 'recentre' },
      { kind: 'surf', steps: 1 },
      { kind: 'guide' },
      { kind: 'solo' },
      { kind: 'info' },
      { kind: 'close' },
    ];
    for (const a of actions) expect(run(a)[0]).toBe('active 7');
  });

  it('mode sets the camera mode, redraws the zoom and saves', () => {
    expect(setup().run({ kind: 'mode', mode: 'orbit' })).toEqual([
      'active 7',
      'setMode orbit',
      'drawZoom',
      'save',
    ]);
  });

  it('rotate only turns the rig', () => {
    expect(setup().run({ kind: 'rotate', steps: 2 })).toEqual(['active 7', 'rotate 2']);
  });

  it('zoom steps the rig and redraws the zoom', () => {
    expect(setup().run({ kind: 'zoom', steps: -1 })).toEqual([
      'active 7',
      'zoomStep -1',
      'drawZoom',
    ]);
  });

  it('zoom-level steps by the difference from the current zoom in follow mode only', () => {
    expect(setup({ zoom: 5 }).run({ kind: 'zoom-level', level: 9 })).toEqual([
      'active 7',
      'zoomStep 4',
      'drawZoom',
    ]);
    expect(setup({ mode: 'orbit', zoom: 5 }).run({ kind: 'zoom-level', level: 9 })).toEqual([
      'active 7',
      'drawZoom',
    ]);
  });

  it('recentre recentres the rig', () => {
    expect(setup().run({ kind: 'recentre' })).toEqual(['active 7', 'recentre']);
  });

  it('surf retunes to the next agent in the list, settling', () => {
    expect(setup().run({ kind: 'surf', steps: 1 })).toEqual(['active 7', 'retune ag_b true']);
  });

  it('guide opens the channel guide', () => {
    expect(setup().run({ kind: 'guide' })).toEqual(['active 7', 'guide']);
  });

  it('solo toggles between solo and wall', () => {
    expect(setup({ layout: 'wall' }).run({ kind: 'solo' })).toEqual(['active 7', 'layout solo']);
    expect(setup({ layout: 'solo' }).run({ kind: 'solo' })).toEqual(['active 7', 'layout wall']);
  });

  it('info toggles the monitor info', () => {
    expect(setup().run({ kind: 'info' })).toEqual(['active 7', 'info']);
  });

  it('close closes this monitor', () => {
    expect(setup().run({ kind: 'close' })).toEqual(['active 7', 'close 7']);
  });
});
