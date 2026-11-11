/**
 * The panes of one Kino page. Each pane has its own target, mode and feed connection; closing one
 * leaves the others up. The cap is a setting (4 by default). A pane is a handle the page supplies:
 * it owns its socket, scene and camera, and `dispose` releases them.
 */
import type { CameraMode } from '../camera/modes.ts';

export const DEFAULT_PANES = 4;

export interface PaneHandle {
  setTarget(agentId: string): void;
  setMode(mode: CameraMode): void;
  dispose(): void;
}

export interface PaneInfo {
  id: number;
  target: string;
  mode: CameraMode;
}

export class PaneSet {
  private readonly panes = new Map<number, PaneInfo & { handle: PaneHandle }>();
  private readonly make: (id: number, target: string, mode: CameraMode) => PaneHandle;
  private readonly cap: number;
  private next = 1;

  constructor(
    make: (id: number, target: string, mode: CameraMode) => PaneHandle,
    cap: number = DEFAULT_PANES,
  ) {
    this.make = make;
    this.cap = cap;
  }

  /** Opens a pane. Returns its id, or null at the cap. */
  open(target: string, mode: CameraMode = 'follow'): number | null {
    if (this.panes.size >= this.cap) return null;
    const id = this.next++;
    this.panes.set(id, { id, target, mode, handle: this.make(id, target, mode) });
    return id;
  }

  setTarget(id: number, target: string): boolean {
    const p = this.panes.get(id);
    if (!p) return false;
    p.target = target;
    p.handle.setTarget(target);
    return true;
  }

  setMode(id: number, mode: CameraMode): boolean {
    const p = this.panes.get(id);
    if (!p) return false;
    p.mode = mode;
    p.handle.setMode(mode);
    return true;
  }

  /** Closes one pane; the others stay up. */
  close(id: number): boolean {
    const p = this.panes.get(id);
    if (!p) return false;
    this.panes.delete(id);
    p.handle.dispose();
    return true;
  }

  list(): PaneInfo[] {
    return [...this.panes.values()].map(({ id, target, mode }) => ({ id, target, mode }));
  }
}
