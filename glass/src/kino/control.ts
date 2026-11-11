/**
 * The Glass side of the Kino control path (kino-control.schema.json). It wraps the relay's feed source:
 * the first pane that watches an agent makes Glass publish `start`, a later pane `resync`, a heartbeat
 * `refresh` runs while anyone watches, and `stop` follows the last pane after a short grace. The plugin
 * only reads the world; none of this is visible to an agent. With the kill switch off nothing is published.
 */
import type { FeedSource } from './relay.ts';

const SHARD = /^[a-z][a-z0-9-]*$/;

/** Where Glass asks the plugin to start and stop targets. */
export function controlSubject(shard: string): string {
  if (!SHARD.test(shard)) throw new Error('invalid kino subject token');
  return `geldar.${shard}.kino.control`;
}

/** Publishes one control message (NATS in production). */
export interface ControlSink {
  publish(json: string): void;
}

export interface ControlOptions {
  sink: ControlSink;
  /** The Glass-side kill switch; false: nothing is published. */
  enabled: () => boolean;
  /** Wait after the last pane leaves before `stop`, so a page reload does not tear the feed down. */
  graceMs?: number;
  /** Heartbeat while a target is watched. The plugin drops a target it has not heard of for longer. */
  refreshMs?: number;
}

export const DEFAULT_GRACE_MS = 10_000;
export const DEFAULT_REFRESH_MS = 15_000;

interface Watched {
  count: number;
  stopTimer: ReturnType<typeof setTimeout> | null;
  refreshTimer: ReturnType<typeof setInterval> | null;
}

export function controlledFeed(
  inner: FeedSource,
  o: ControlOptions,
): FeedSource & { dispose(): void } {
  const grace = o.graceMs ?? DEFAULT_GRACE_MS;
  const refreshMs = o.refreshMs ?? DEFAULT_REFRESH_MS;
  const watched = new Map<string, Watched>();
  const send = (type: 'start' | 'resync' | 'refresh' | 'stop', agent: string): void => {
    if (!o.enabled()) return;
    o.sink.publish(JSON.stringify({ control_version: 1, type, target_agent_id: agent }));
  };
  const drop = (agent: string, w: Watched): void => {
    if (w.stopTimer) clearTimeout(w.stopTimer);
    if (w.refreshTimer) clearInterval(w.refreshTimer);
    watched.delete(agent);
  };
  return {
    subscribe(agent, onMessage) {
      let w = watched.get(agent);
      if (w === undefined) {
        w = { count: 0, stopTimer: null, refreshTimer: null };
        watched.set(agent, w);
        send('start', agent);
        const entry = w;
        entry.refreshTimer = setInterval(() => send('refresh', agent), refreshMs);
        entry.refreshTimer.unref();
      } else {
        // A pane joining a target that is already read (or in its grace) needs the window again.
        if (w.stopTimer) {
          clearTimeout(w.stopTimer);
          w.stopTimer = null;
        }
        send('resync', agent);
      }
      w.count++;
      const entry = w;
      const unsubscribe = inner.subscribe(agent, onMessage);
      let left = false;
      return () => {
        if (left) return;
        left = true;
        unsubscribe();
        entry.count--;
        if (entry.count > 0) return;
        entry.stopTimer = setTimeout(() => {
          if (entry.count > 0) return;
          send('stop', agent);
          drop(agent, entry);
        }, grace);
        entry.stopTimer.unref();
      };
    },
    dispose() {
      for (const [agent, w] of [...watched]) drop(agent, w);
    },
  };
}
