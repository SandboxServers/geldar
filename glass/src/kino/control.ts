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
  /** A later pane's resync is sent at most this often per agent (default 5 s); extra ones are coalesced into one. */
  resyncMs?: number;
}

export const DEFAULT_GRACE_MS = 10_000;
export const DEFAULT_REFRESH_MS = 15_000;
export const DEFAULT_RESYNC_MS = 5_000;

interface Watched {
  count: number;
  stopTimer: ReturnType<typeof setTimeout> | null;
  refreshTimer: ReturnType<typeof setInterval> | null;
  lastWindow: number;
  resyncTimer: ReturnType<typeof setTimeout> | null;
  /** The latest hello and target_moved seen for this agent, replayed to a pane that joins later. */
  hello: string | null;
  moved: string | null;
}

export function controlledFeed(
  inner: FeedSource,
  o: ControlOptions,
): FeedSource & { dispose(): void } {
  const grace = o.graceMs ?? DEFAULT_GRACE_MS;
  const refreshMs = o.refreshMs ?? DEFAULT_REFRESH_MS;
  const resyncMs = o.resyncMs ?? DEFAULT_RESYNC_MS;
  const watched = new Map<string, Watched>();
  const send = (type: 'start' | 'resync' | 'refresh' | 'stop', agent: string): void => {
    if (!o.enabled()) return;
    o.sink.publish(JSON.stringify({ control_version: 1, type, target_agent_id: agent }));
  };
  const drop = (agent: string, w: Watched): void => {
    if (w.stopTimer) clearTimeout(w.stopTimer);
    if (w.refreshTimer) clearInterval(w.refreshTimer);
    if (w.resyncTimer) clearTimeout(w.resyncTimer);
    watched.delete(agent);
  };
  /** One resync per resyncMs per agent: inside the window, a single trailing resync serves all panes. */
  const resync = (agent: string, w: Watched): void => {
    if (w.resyncTimer) return;
    const wait = w.lastWindow + resyncMs - Date.now();
    if (wait <= 0) {
      w.lastWindow = Date.now();
      send('resync', agent);
      return;
    }
    w.resyncTimer = setTimeout(() => {
      w.resyncTimer = null;
      w.lastWindow = Date.now();
      send('resync', agent);
    }, wait);
    w.resyncTimer.unref();
  };
  return {
    subscribe(agent, onMessage) {
      let w = watched.get(agent);
      const replayHello = w?.hello ?? null;
      const replayMoved = w?.moved ?? null;
      if (w === undefined) {
        w = {
          count: 0,
          stopTimer: null,
          refreshTimer: null,
          lastWindow: Date.now(),
          resyncTimer: null,
          hello: null,
          moved: null,
        };
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
        resync(agent, w);
      }
      w.count++;
      const entry = w;
      const unsubscribe = inner.subscribe(agent, (json) => {
        // Cheap prefix test first: only hello and target_moved are remembered.
        if (json.includes('"hello"') || json.includes('"target_moved"')) {
          try {
            const type = (JSON.parse(json) as { type?: unknown }).type;
            if (type === 'hello') entry.hello = json;
            else if (type === 'target_moved') entry.moved = json;
          } catch {
            // not ours to judge: the relay validates every message
          }
        }
        onMessage(json);
      });
      // The plugin does not repeat hello / target_moved for a target it already reads, so a joining pane gets the cache.
      if (replayHello !== null) onMessage(replayHello);
      if (replayMoved !== null) onMessage(replayMoved);
      let left = false;
      return () => {
        if (left) return;
        left = true;
        unsubscribe();
        entry.count--;
        if (entry.count > 0) return;
        if (entry.resyncTimer) {
          clearTimeout(entry.resyncTimer);
          entry.resyncTimer = null;
        }
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
