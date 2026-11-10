/**
 * The live feed of the Thought Stream page: one server-sent events connection, reconnected with
 * backoff, paused and resumed by the reader, and closed for good when the page is hidden. Every
 * clock, page and source is passed in, so the abort paths are tested with fakes (render-stream.test.ts).
 *
 * This file is served to the browser after type stripping, so it stays erasable TypeScript.
 */
import { backoffMs } from './render-model.ts';

/** The part of an EventSource this client uses. */
export interface StreamSource {
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  addEventListener(type: string, listener: (ev: { data: string }) => void): void;
  close(): void;
}

export interface StreamTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface StreamPage {
  addEventListener(type: 'pagehide', listener: () => void): void;
  removeEventListener(type: 'pagehide', listener: () => void): void;
}

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'paused' | 'closed';

export interface StreamOptions {
  url: string;
  open: new (url: string) => StreamSource;
  timers: StreamTimers;
  page: StreamPage;
  onThought: (data: unknown) => void;
  onStatus: (status: StreamStatus) => void;
}

export interface StreamClient {
  start(): void;
  pause(): void;
  resume(): void;
  close(): void;
}

export function createStreamClient(opts: StreamOptions): StreamClient {
  let source: StreamSource | null = null;
  let timer: unknown = null;
  let attempt = 0;
  let paused = false;
  let closed = false;

  function setStatus(status: StreamStatus): void {
    opts.onStatus(status);
  }

  function stopSource(): void {
    if (source !== null) source.close();
    source = null;
  }

  function stopTimer(): void {
    if (timer !== null) opts.timers.clearTimeout(timer);
    timer = null;
  }

  function connect(): void {
    if (closed || paused || source !== null || timer !== null) return;
    const current = new opts.open(opts.url);
    source = current;
    current.addEventListener('thought', (ev) => {
      if (source !== current) return;
      let data: unknown;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      opts.onThought(data);
    });
    current.onopen = () => {
      if (source !== current) return;
      attempt = 0;
      setStatus('live');
    };
    current.onerror = () => {
      if (source !== current) return;
      stopSource();
      scheduleRetry();
    };
  }

  function scheduleRetry(): void {
    if (closed || paused) return;
    const wait = backoffMs(attempt);
    attempt += 1;
    setStatus('reconnecting');
    timer = opts.timers.setTimeout(() => {
      timer = null;
      connect();
    }, wait);
  }

  function onPageHide(): void {
    close();
  }

  function start(): void {
    if (closed) return;
    opts.page.addEventListener('pagehide', onPageHide);
    setStatus('connecting');
    connect();
  }

  function pause(): void {
    if (closed || paused) return;
    paused = true;
    stopTimer();
    stopSource();
    setStatus('paused');
  }

  function resume(): void {
    if (closed || !paused) return;
    paused = false;
    attempt = 0;
    setStatus('connecting');
    connect();
  }

  function close(): void {
    if (closed) return;
    closed = true;
    stopTimer();
    stopSource();
    opts.page.removeEventListener('pagehide', onPageHide);
    setStatus('closed');
  }

  return { start, pause, resume, close };
}
