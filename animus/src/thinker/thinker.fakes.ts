import WebSocket from 'ws';
import type { AnimusConfig, ModelPin } from '../config.ts';
import { CONTEXT_TOKENS } from '../prompts/library.ts';
import { type HubOptions, THINKER_PATH, ThinkerHub } from './hub.ts';

/** The model tag the tests use. */
export const MODEL = 'qwen3:8b';

const PIN: ModelPin = {
  digest: `sha256:${'a'.repeat(64)}`,
  numCtx: CONTEXT_TOKENS,
  keepAlive: '30m',
  maxConcurrent: 1,
};

/** The two config blocks the hub reads. `qwen3:32b` is pinned too, so a test can offer it. */
export function hubConfig(): Pick<AnimusConfig, 'thinker' | 'modelPins'> {
  return {
    thinker: { host: '127.0.0.1', port: 0, name: 'test-thinker', heartbeatS: 15 },
    modelPins: { [MODEL]: PIN, 'qwen3:32b': PIN },
  };
}

/** A started hub on a free loopback port. The caller stops it. */
export async function startHub(options: Partial<HubOptions> = {}): Promise<ThinkerHub> {
  const hub = new ThinkerHub({ config: hubConfig(), port: 0, ...options });
  await hub.start();
  return hub;
}

type Frame = Record<string, unknown>;

/**
 * A protocol-level Thinker: a raw `ws` client that sends exactly the frames a test tells it to
 * and records every frame the hub sends. It speaks no logic of its own.
 */
export class FakeThinker {
  /** Every frame received from the hub, parsed, in order. */
  readonly received: Frame[] = [];
  closeCode: number | undefined;
  private socket: WebSocket | undefined;
  private readonly waiters: Array<() => void> = [];

  /** Connects to the hub and resolves once the socket is open. */
  async connect(hub: ThinkerHub, headers: Record<string, string> = {}): Promise<void> {
    const socket = new WebSocket(`ws://127.0.0.1:${hub.port}${THINKER_PATH}`, { headers });
    this.socket = socket;
    socket.on('message', (data) => {
      this.received.push(JSON.parse(String(data)) as Frame);
      for (const waiter of this.waiters.splice(0)) waiter();
    });
    socket.on('close', (code) => {
      this.closeCode = code;
      for (const waiter of this.waiters.splice(0)) waiter();
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
  }

  /** Sends a frame as JSON; a string is sent as it is (for malformed input). */
  send(frame: Frame | string): void {
    this.socket?.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
  }

  /**
   * Sends a hello offering the given models (name, max_concurrent), then waits for the welcome.
   * `token` is sent only when given, as a Thinker with no token file does.
   */
  async hello(models: Array<[string, number]> = [[MODEL, 1]], token?: string): Promise<Frame> {
    this.send({
      type: 'hello',
      thinker_version: '1.0.0',
      models: models.map(([name, max]) => ({ name, max_concurrent: max, max_tokens: 1024 })),
      ...(token === undefined ? {} : { token }),
    });
    return this.next('welcome');
  }

  /** Resolves with the first not yet returned frame of `type`; rejects after 3 s. */
  async next(type: string): Promise<Frame> {
    const deadline = Date.now() + 3000;
    for (;;) {
      const index = this.received.findIndex((f) => f.type === type && !this.taken.has(f));
      const frame = this.received[index];
      if (frame !== undefined) {
        this.taken.add(frame);
        return frame;
      }
      if (Date.now() > deadline) throw new Error(`no ${type} frame arrived`);
      await this.change(deadline - Date.now());
    }
  }

  /** Waits until the socket has closed. */
  async closed(): Promise<number> {
    const deadline = Date.now() + 3000;
    while (this.closeCode === undefined) {
      if (Date.now() > deadline) throw new Error('the socket did not close');
      await this.change(deadline - Date.now());
    }
    return this.closeCode;
  }

  close(): void {
    this.socket?.close();
  }

  private readonly taken = new Set<Frame>();

  private change(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.max(1, timeoutMs));
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

/** Polls `check` every 10 ms until it is true; throws after 3 s. */
export async function until(check: () => boolean, what = 'the condition'): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await pause(10);
  }
}

/** A sleep for tests that must let a dropped frame be processed. */
export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
