import { createRateGate, type Sleep } from './rate.ts';

/** What one connect attempt saw: a completed handshake, a refusal or other error, or no answer in time. */
export type Probe = 'open' | 'closed' | 'timeout';

/** One connect attempt. The connector is injected; the tests pass a fake and never open a socket. */
export type Connector = (port: number, signal: AbortSignal) => Promise<Probe>;

export interface ScanOptions {
  ports: readonly number[];
  connect: Connector;
  /** Connects in flight at once. */
  concurrency: number;
  /** Connect starts per second, across all workers. */
  perSecond: number;
  /** Connect attempts per port. A timeout is retried until the last attempt; a timeout on the last attempt counts as closed. */
  attempts: number;
  now: () => number;
  sleep: Sleep;
  signal?: AbortSignal;
}

function checkOptions(options: ScanOptions): void {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new RangeError(
      `concurrency must be a whole number of at least 1, got ${options.concurrency}`,
    );
  }
  if (!Number.isInteger(options.attempts) || options.attempts < 1) {
    throw new RangeError(`attempts must be a whole number of at least 1, got ${options.attempts}`);
  }
}

/**
 * Scans every port and resolves with the open ports, ascending. A rejected connector, an abort, or an
 * invalid option rejects the whole scan: a partial open set is never returned as if it were complete.
 */
export async function scanPorts(options: ScanOptions): Promise<number[]> {
  checkOptions(options);
  const gate = createRateGate(options.perSecond, options.now, options.sleep);
  const control = new AbortController();
  const outer = options.signal;
  const onOuterAbort = (): void => control.abort(outer?.reason);
  if (outer?.aborted) onOuterAbort();
  outer?.addEventListener('abort', onOuterAbort, { once: true });

  async function probe(port: number): Promise<boolean> {
    for (let attempt = 1; ; attempt += 1) {
      await gate.wait();
      if (control.signal.aborted) throw control.signal.reason;
      const result = await options.connect(port, control.signal);
      if (result === 'open') return true;
      if (result === 'closed') return false;
      if (attempt >= options.attempts) return false;
    }
  }

  const open: number[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < options.ports.length) {
      const port = options.ports[next];
      next += 1;
      if (port === undefined) break;
      if (await probe(port)) open.push(port);
    }
  }

  const workers = Math.min(options.concurrency, options.ports.length);
  try {
    await Promise.all(Array.from({ length: workers }, () => worker()));
  } catch (error) {
    control.abort();
    throw error;
  } finally {
    outer?.removeEventListener('abort', onOuterAbort);
  }
  return open.sort((a, b) => a - b);
}
