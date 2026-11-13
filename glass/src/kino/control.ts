/**
 * The Glass side of the Kino control path (kino-control.schema.json). It wraps the relay's feed source:
 * the first pane that watches an agent makes Glass publish `start`, a later pane `resync`, a heartbeat
 * `refresh` runs while anyone watches, and `stop` follows the last pane after a short grace. The plugin
 * only reads the world; none of this is visible to an agent. With the kill switch off nothing is published.
 *
 * Glass reads each watched agent's feed once and fans it out to the panes. It keeps the window's latest
 * sections (section-cache.ts), so a pane that joins a target already read is served from memory and no
 * resync is sent; a resync is sent only when the cache cannot serve (empty, or dropped).
 */
import type { FeedSource } from './relay.ts';
import { SectionCache } from './section-cache.ts';

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
  /** The latest chunk_section per section and the block_updates after it. */
  cache: SectionCache;
  /** The panes watching now. */
  listeners: Set<(json: string) => void>;
  /** Ends the one feed subscription this agent has. */
  unsubscribe: () => void;
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
    try {
      o.sink.publish(JSON.stringify({ control_version: 1, type, target_agent_id: agent }));
    } catch {
      // a closed connection throws; this runs in timers, so it must never escape (the pane ends through onLost)
    }
  };
  const drop = (agent: string, w: Watched): void => {
    if (w.stopTimer) clearTimeout(w.stopTimer);
    if (w.refreshTimer) clearInterval(w.refreshTimer);
    if (w.resyncTimer) clearTimeout(w.resyncTimer);
    w.unsubscribe();
    w.cache.invalidate();
    w.listeners.clear();
    watched.delete(agent);
  };
  /** The one resync sent to the plugin: the cache starts over with the window the plugin sends back. */
  const sendResync = (agent: string, w: Watched): void => {
    w.lastWindow = Date.now();
    if (o.enabled()) w.cache.reset();
    send('resync', agent);
  };
  /** One resync per resyncMs per agent: inside the window, a single trailing resync serves all panes. */
  const resync = (agent: string, w: Watched): void => {
    if (w.resyncTimer) return;
    const wait = w.lastWindow + resyncMs - Date.now();
    if (wait <= 0) {
      sendResync(agent, w);
      return;
    }
    w.resyncTimer = setTimeout(() => {
      w.resyncTimer = null;
      sendResync(agent, w);
    }, wait);
    w.resyncTimer.unref();
  };
  /** One message from the plugin: remembered for later panes, then given to every pane. */
  const deliver = (w: Watched, json: string): void => {
    // Cheap prefix test first: only hello and target_moved are remembered here.
    if (json.includes('"hello"') || json.includes('"target_moved"')) {
      try {
        const type = (JSON.parse(json) as { type?: unknown }).type;
        if (type === 'hello') w.hello = json;
        else if (type === 'target_moved') w.moved = json;
      } catch {
        // not ours to judge: the relay validates every message
      }
    }
    // With the kill switch off the cache is not kept: a pane that joins after it is on needs a resync.
    if (o.enabled()) w.cache.record(json);
    else w.cache.invalidate();
    for (const listener of [...w.listeners]) listener(json);
  };
  return {
    subscribe(agent, onMessage) {
      let w = watched.get(agent);
      const fresh = w === undefined;
      if (w === undefined) {
        const created: Watched = {
          count: 0,
          stopTimer: null,
          refreshTimer: null,
          lastWindow: Date.now(),
          resyncTimer: null,
          hello: null,
          moved: null,
          cache: new SectionCache(),
          listeners: new Set(),
          unsubscribe: () => {},
        };
        watched.set(agent, created);
        created.unsubscribe = inner.subscribe(agent, (json) => deliver(created, json));
        w = created;
        send('start', agent);
        created.refreshTimer = setInterval(() => send('refresh', agent), refreshMs);
        created.refreshTimer.unref();
      } else if (w.stopTimer) {
        // A pane joining a target that is in its grace cancels the stop.
        clearTimeout(w.stopTimer);
        w.stopTimer = null;
      }
      const entry = w;
      const replayHello = entry.hello;
      const replayMoved = entry.moved;
      // A joining pane is served from the cache when it can be; only a cache that cannot serve asks for a resync.
      const cached = fresh || !o.enabled() ? null : entry.cache.replay();
      if (!fresh && cached === null) resync(agent, entry);
      entry.count++;
      const listener = (json: string): void => onMessage(json);
      entry.listeners.add(listener);
      // The plugin does not repeat hello / target_moved for a target it already reads, so a joining pane gets them here.
      if (replayHello !== null) onMessage(replayHello);
      if (replayMoved !== null) onMessage(replayMoved);
      for (const json of cached ?? []) onMessage(json);
      let left = false;
      return () => {
        if (left) return;
        left = true;
        entry.listeners.delete(listener);
        entry.count--;
        if (entry.count > 0) return;
        // The last pane has gone: nothing is served from memory until a resync refills it.
        entry.cache.invalidate();
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
