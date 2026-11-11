/**
 * The Kino feed over a NATS connection that may come and go. Glass starts with Kino disabled (`available()`
 * is false) and a background loop connects with backoff; when the connection is up Kino is enabled, and when
 * it closes `onLost` listeners fire (the wiring ends every open pane with feed_unavailable) and the loop
 * reconnects. Nothing here throws out of a timer or into Glass's startup: a missing NATS or `kino` user only
 * costs Kino, never the Thought Stream.
 */
import type { ControlSink } from './control.ts';
import type { FeedSource } from './relay.ts';

/** The part of a NATS connection the feed uses (a fake in tests). */
export interface NatsLink {
  publish(subject: string, data: Uint8Array): void;
  /** A subscription: iterate for messages, `unsubscribe` to stop. */
  subscribe(subject: string): AsyncIterable<{ data: Uint8Array }> & { unsubscribe(): void };
  /** Resolves when the connection is closed for good. */
  closed(): Promise<unknown>;
  drain(): Promise<void>;
}

export interface SupervisedFeedOptions {
  /** Opens a connection; rejects when NATS is down or refuses the user. */
  connect(): Promise<NatsLink>;
  feedSubject(agentId: string): string;
  controlSubject: string;
  log?: (message: string) => void;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface SupervisedFeed extends FeedSource {
  control: ControlSink;
  /** True while a connection is up; Kino is disabled otherwise. */
  available(): boolean;
  /** Called each time an established connection is lost. */
  onLost(listener: () => void): void;
  close(): Promise<void>;
}

export function supervisedFeed(o: SupervisedFeedOptions): SupervisedFeed {
  const log = o.log ?? ((m) => console.error(m));
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const initial = o.initialBackoffMs ?? 1_000;
  const max = o.maxBackoffMs ?? 30_000;
  const listeners: Array<() => void> = [];
  let link: NatsLink | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = initial;

  const attempt = async (): Promise<void> => {
    timer = null;
    if (stopped) return;
    let next: NatsLink;
    try {
      next = await o.connect();
    } catch (e) {
      log(
        `glass: kino is disabled, NATS is unavailable (${e instanceof Error ? e.message : String(e)}); retrying in ${delay} ms`,
      );
      schedule();
      return;
    }
    if (stopped) {
      void next.drain().catch(() => {});
      return;
    }
    link = next;
    delay = initial;
    log('glass: kino enabled, NATS connected');
    void next.closed().then(
      () => lost(next),
      () => lost(next),
    );
  };
  const lost = (which: NatsLink): void => {
    if (link !== which) return;
    link = null;
    if (stopped) return;
    log('glass: kino is disabled, the NATS connection closed; reconnecting');
    for (const l of listeners) {
      try {
        l();
      } catch {
        // a listener must not stop the reconnect
      }
    }
    schedule();
  };
  const schedule = (): void => {
    if (stopped || timer !== null) return;
    timer = setTimeout(() => void attempt(), delay);
    timer.unref();
    delay = Math.min(delay * 2, max);
  };
  void attempt();

  return {
    available: () => link !== null,
    onLost: (l) => void listeners.push(l),
    control: {
      publish(json) {
        // The refresh timer calls this; a closed connection must never throw out of it.
        try {
          link?.publish(o.controlSubject, encoder.encode(json));
        } catch {
          // dropped: the connection is closing and the pane ends through onLost
        }
      },
    },
    subscribe(agentId, onMessage) {
      const current = link;
      if (current === null) return () => {};
      const sub = current.subscribe(o.feedSubject(agentId));
      void (async () => {
        for await (const m of sub) onMessage(decoder.decode(m.data));
      })().catch(() => {});
      return () => {
        try {
          sub.unsubscribe();
        } catch {
          // the connection is gone already
        }
      };
    },
    async close() {
      stopped = true;
      if (timer) clearTimeout(timer);
      const l = link;
      link = null;
      await l?.drain();
    },
  };
}
