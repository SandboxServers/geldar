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

/** Agents are always labelled; other entities only near the camera target, smaller and fading with distance. */
export function labelStyle(isAgent: boolean, distance: number): LabelStyle {
  if (isAgent) return { visible: true, opacity: 1, scale: 1 };
  if (!(distance < LABEL_RADIUS)) return { visible: false, opacity: 0, scale: 0 };
  const f = 1 - distance / LABEL_RADIUS;
  return { visible: true, opacity: Math.max(0.15, f), scale: 0.4 + 0.2 * f };
}
