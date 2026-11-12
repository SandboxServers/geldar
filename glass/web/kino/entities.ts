// The client's entity set. The plugin scans a few hundred entities per second and sends them as pages,
// so one entity_positions message is a PARTIAL view: entities are kept by feed id (never array index),
// merged page by page, and dropped only after a quiet period. Pure; time is passed in.

import type { EntityPosition } from '../../../contract/src/generated/types.ts';

/** Seconds without an update before a mob is dropped. A full rotation of the scan fits well inside this. */
export const MOB_TTL_MS = 10_000;
/** Agents are sent rarely when they are crowded out of a page, so they live longer. */
export const AGENT_TTL_MS = 30_000;

export class EntityStore {
  private readonly byId = new Map<string, { e: EntityPosition; seen: number }>();

  /** Updates by id and expires what has been quiet too long. Returns the merged set. */
  merge(page: EntityPosition[], now: number): EntityPosition[] {
    for (const e of page) this.byId.set(e.id, { e, seen: now });
    for (const [id, rec] of this.byId) {
      const ttl = rec.e.agent_id === undefined ? MOB_TTL_MS : AGENT_TTL_MS;
      if (now - rec.seen > ttl) this.byId.delete(id);
    }
    return this.list();
  }

  list(): EntityPosition[] {
    return [...this.byId.values()].map((r) => r.e);
  }

  get size(): number {
    return this.byId.size;
  }
}

export const LABEL_RADIUS = 12;

export interface LabelStyle {
  visible: boolean;
  /** 0..1 */
  opacity: number;
  /** Multiplier on the sprite's base scale. */
  scale: number;
}

/** A label sprite's base width in blocks, and the most of the view it may take per block of camera distance. */
export const LABEL_BASE_WIDTH = 2.4;
export const LABEL_MAX_PER_BLOCK = 0.25;
export const LABEL_MIN_CLAMP = 0.15;

/**
 * A scale multiplier that keeps a label from filling the screen when the camera is close: the sprite is
 * at most LABEL_MAX_PER_BLOCK * distance blocks wide, never below LABEL_MIN_CLAMP, never above 1.
 */
export function labelClamp(cameraDistance: number): number {
  const k = (LABEL_MAX_PER_BLOCK * Math.max(0, cameraDistance)) / LABEL_BASE_WIDTH;
  return Math.max(LABEL_MIN_CLAMP, Math.min(1, k));
}

/** Agents are always labelled; other entities only near the camera target, smaller and fading with distance. */
export function labelStyle(isAgent: boolean, distance: number): LabelStyle {
  if (isAgent) return { visible: true, opacity: 1, scale: 1 };
  if (!(distance < LABEL_RADIUS)) return { visible: false, opacity: 0, scale: 0 };
  const f = 1 - distance / LABEL_RADIUS;
  return { visible: true, opacity: Math.max(0.15, f), scale: 0.4 + 0.2 * f };
}
