// The wall's DOM layout, pulled out of main.ts: places the monitors and the empty slots in the grid the
// planner gives, hides the monitors that are not on the wall, and sets the layout buttons' state.

import type { Layout } from '../keys.ts';
import { orderTiles } from './monitor.ts';
import { planWall } from './wall-layout.ts';

/** A monitor as the wall places it: its channel and its frame's root and featured state. */
export interface WallMember {
  channel: number;
  frame: { root: HTMLElement; setFeatured(on: boolean): void };
}

/** The elements the wall writes into. `emptySlot` builds the placeholder for a free channel. */
export interface WallDom {
  wall: HTMLElement;
  layoutButtons: Iterable<HTMLButtonElement>;
  slots: Map<number, HTMLElement>;
  emptySlot(channel: number): HTMLElement;
}

export interface WallState {
  layout: Layout;
  /** The active monitor's channel, or null when none is active. */
  activeChannel: number | null;
  narrow: boolean;
  /** How many channels the wall has (DEFAULT_PANES on the page). */
  cap: number;
}

/** Lays the members out on the wall for the given state. The caller redraws the selection after. */
export function applyWall(dom: WallDom, members: readonly WallMember[], s: WallState): void {
  const byChannel = new Map(members.map((m) => [m.channel, m]));
  const plan = planWall({
    ids: [...byChannel.keys()],
    active: s.activeChannel,
    layout: s.layout,
    cap: s.cap,
    narrow: s.narrow,
  });
  dom.wall.style.gridTemplateColumns = plan.columns;
  dom.wall.style.gridTemplateRows = plan.rows;
  dom.wall.dataset.layout = s.layout;
  const keep = new Map<number, HTMLElement>();
  const vacancies = Array.from({ length: s.cap }, (_, i) => i + 1).filter(
    (channel) => !byChannel.has(channel),
  );
  const fullGrid = plan.cells.length === s.cap && (s.layout === 'wall' || s.activeChannel === null);
  for (const cell of plan.cells) {
    const channel = cell.id ?? (vacancies.shift() as number);
    const monitor = byChannel.get(channel);
    let node = monitor?.frame.root ?? dom.slots.get(channel);
    if (!node) {
      node = dom.emptySlot(channel);
      dom.slots.set(channel, node);
    }
    // Wall slots keep their channel number after a neighbour is cleared.
    node.style.gridArea = fullGrid ? (plan.cells[channel - 1]?.area ?? cell.area) : cell.area;
    node.hidden = false;
    monitor?.frame.setFeatured(cell.featured);
    keep.set(channel, node);
  }
  for (const channel of plan.hidden) {
    const m = byChannel.get(channel) as WallMember;
    m.frame.root.hidden = true;
    keep.set(channel, m.frame.root);
  }
  // Tab order follows the channel numbers; monitors already on the wall are not moved.
  orderTiles(
    dom.wall,
    [...keep].sort((a, b) => a[0] - b[0]).map(([, node]) => node),
  );
  for (const b of dom.layoutButtons)
    b.setAttribute('aria-pressed', String(b.dataset.layout === s.layout));
}
