// Runs the renderer in a worker thread so a 50 to 130 ms render does not block the Body's 20 Hz tick.
// One worker, spawned on first use and respawned after a crash or a timeout. One render at a time:
// a second request while one runs is refused as busy, not queued.

import { Worker } from 'node:worker_threads';
import type { RenderScene } from './reader.ts';

/** How long a render may take before the request is answered with a timeout. */
export const RENDER_TIMEOUT_MS = 3_000;

const DEFAULT_SCRIPT = new URL('./render-worker.ts', import.meta.url);

export type RenderFailure = 'busy' | 'timeout' | 'crashed' | 'failed';
export type RenderOutcome = { ok: true; png: Uint8Array } | { ok: false; reason: RenderFailure };

/** What the host needs from a renderer: whether one is running, and a render. */
export interface RenderPort {
  readonly busy: boolean;
  render(scene: RenderScene): Promise<RenderOutcome>;
}

export interface RenderHostOptions {
  /** The worker script; tests point this at a fixture. */
  script?: URL;
  timeoutMs?: number;
}

interface Pending {
  id: number;
  resolve: (outcome: RenderOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** A worker reply: the PNG, or `error` when the renderer threw. */
type WorkerReply = { id: number; png: Uint8Array } | { id: number; error: string };

export class RenderHost implements RenderPort {
  private worker: Worker | undefined;
  private pending: Pending | undefined;
  private nextId = 1;
  private closed = false;
  private readonly options: RenderHostOptions;

  constructor(options: RenderHostOptions = {}) {
    this.options = options;
  }

  /** True while a render is running (and until a timed-out one is abandoned). */
  get busy(): boolean {
    return this.pending !== undefined;
  }

  /** Renders the scene in the worker. Refuses as busy when one is already running. Never rejects. */
  render(scene: RenderScene): Promise<RenderOutcome> {
    if (this.closed) return Promise.resolve({ ok: false, reason: 'failed' });
    if (this.pending !== undefined) return Promise.resolve({ ok: false, reason: 'busy' });
    const worker = this.worker ?? this.spawn();
    const id = this.nextId++;
    return new Promise<RenderOutcome>((resolve) => {
      const timer = setTimeout(
        () => this.finish(id, { ok: false, reason: 'timeout' }, true),
        this.options.timeoutMs ?? RENDER_TIMEOUT_MS,
      );
      this.pending = { id, resolve, timer };
      worker.postMessage({ id, scene });
    });
  }

  /** Stops the worker. A render still running resolves as failed. */
  async close(): Promise<void> {
    this.closed = true;
    const id = this.pending?.id;
    if (id !== undefined) this.finish(id, { ok: false, reason: 'failed' }, true);
    const worker = this.worker;
    this.worker = undefined;
    await worker?.terminate();
  }

  private spawn(): Worker {
    const worker = new Worker(this.options.script ?? DEFAULT_SCRIPT);
    worker.unref();
    worker.on('message', (reply: WorkerReply) => {
      if (worker !== this.worker) return;
      const ok = 'png' in reply;
      this.finish(
        reply.id,
        ok ? { ok: true, png: reply.png } : { ok: false, reason: 'failed' },
        false,
      );
    });
    worker.on('error', () => this.crashed(worker));
    worker.on('exit', () => this.crashed(worker));
    this.worker = worker;
    return worker;
  }

  /** The worker died: its render failed as crashed, and the next render spawns a new worker. */
  private crashed(worker: Worker): void {
    if (worker !== this.worker) return;
    this.worker = undefined;
    const id = this.pending?.id;
    if (id !== undefined) this.finish(id, { ok: false, reason: 'crashed' }, false);
  }

  /** Ends the pending render with an outcome. Ignores an id that is not the pending one (a late reply). */
  private finish(id: number, outcome: RenderOutcome, dropWorker: boolean): void {
    const pending = this.pending;
    if (pending === undefined || pending.id !== id) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    if (dropWorker) this.drop();
    pending.resolve(outcome);
  }

  /** Stops the current worker, if any; the next render spawns a fresh one. */
  private drop(): void {
    const worker = this.worker;
    this.worker = undefined;
    void worker?.terminate();
  }
}
