import { restoreWorld } from '../arena.ts';
import { loadConfig, readRconPassword } from '../config.ts';
import { RconClient } from '../rcon.ts';
import { TestControl } from '../test-control.ts';

/** The two tick commands the TPS helpers need. */
export type TickControl = Pick<TestControl, 'tickRate' | 'tickQuery'>;

/** The target rate in a `tick query` reply, which on 26.1.2 reads `Target tick rate: 5.0 per second.` */
const TARGET_RATE = /Target tick rate: (\d+(?:\.\d+)?) per second\./;
/** The average and target time per tick, which read `Average time per tick: 0.1ms (Target: 50.0ms)`. */
const MSPT = /Average time per tick: (\d+(?:\.\d+)?)ms \(Target: (\d+(?:\.\d+)?)ms\)/;

/** The target tick rate a `tick query` reply states, or null when the reply does not match. */
export function parseTargetRate(reply: string): number | null {
  const match = TARGET_RATE.exec(reply);
  return match ? Number(match[1]) : null;
}

/** The average milliseconds per tick from a `tick query` reply, or null. */
export function parseMspt(reply: string): number | null {
  const match = MSPT.exec(reply);
  return match ? Number(match[1]) : null;
}

/** The target milliseconds per tick from a `tick query` reply, or null. */
export function parseTargetMspt(reply: string): number | null {
  const match = MSPT.exec(reply);
  return match ? Number(match[2]) : null;
}

/** The rate last asked for, named in the failure hint when the restore does not work. */
let lastRate = 20;

/** Sets the tick rate and confirms it with `tick query`. A reply that names another rate throws. */
export async function setTps(ctl: TickControl, n: number): Promise<void> {
  lastRate = n;
  await ctl.tickRate(n);
  const reply = await ctl.tickQuery();
  const rate = parseTargetRate(reply);
  if (rate === null || rate !== n) {
    throw new Error(`tick rate is not ${n} after setting it: ${reply.trim()}`);
  }
}

/** Runs `fn` at `n` TPS and puts the rate back to 20 in `finally`, even when `fn` throws. */
export async function withTps<T>(ctl: TickControl, n: number, fn: () => Promise<T>): Promise<T> {
  try {
    await setTps(ctl, n);
    return await fn();
  } finally {
    await ctl.tickRate(20);
    lastRate = 20;
  }
}

/** The events that end a bench process. Windows delivers SIGINT, SIGBREAK and SIGHUP, not SIGTERM. */
const EVENTS = [
  'SIGINT',
  'SIGTERM',
  'SIGBREAK',
  'SIGHUP',
  'uncaughtException',
  'unhandledRejection',
] as const;

/** The part of `process` that `installTpsRestore` uses (a fake in tests). */
export interface ProcessLike {
  on(event: string, handler: (arg?: unknown) => void): unknown;
  off(event: string, handler: (arg?: unknown) => void): unknown;
}

/** Overridable parts of `installTpsRestore`, for tests. */
export interface TpsRestoreOptions {
  proc?: ProcessLike;
  exit?: (code: number) => void;
  /** Opens a fresh control when `ctl` cannot restore. Default: a new `RconClient` from `loadConfig`. */
  openFresh?: () => Promise<{ ctl: TestControl; close(): Promise<void> }>;
  log?: (line: string) => void;
}

/** A fresh RCON connection from the environment config. */
async function openFreshRcon(): Promise<{ ctl: TestControl; close(): Promise<void> }> {
  const cfg = loadConfig();
  const password = await readRconPassword(cfg);
  const rcon = await RconClient.connect({ host: cfg.rconHost, port: cfg.rconPort, password });
  return { ctl: new TestControl(rcon), close: () => rcon.close() };
}

/**
 * Restores 20 TPS and the world rules once, with `ctl` or, if that fails, a fresh connection tried
 * 3 times. Prints the `--restore` hint when nothing worked. Resolves true on success.
 */
export async function restoreServer(
  ctl: TestControl,
  opts: Pick<TpsRestoreOptions, 'openFresh' | 'log'> = {},
): Promise<boolean> {
  const log = opts.log ?? ((line: string) => console.error(line));
  try {
    await restoreWorld(ctl);
    return true;
  } catch {
    // Fall through to a fresh connection.
  }
  const open = opts.openFresh ?? openFreshRcon;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fresh = await open();
      try {
        await restoreWorld(fresh.ctl);
        return true;
      } finally {
        await fresh.close().catch(() => undefined);
      }
    } catch {
      // Try again.
    }
  }
  log(`SERVER LEFT AT ${lastRate} TPS: run ./geldar.ps1 bench --restore`);
  return false;
}

/**
 * Registers one-shot handlers that restore 20 TPS and `restoreWorld` once before the process exits
 * (exit code 130 for signals, 1 for a crash). A second event during the restore does nothing.
 * Returns a function that removes the handlers.
 */
export function installTpsRestore(ctl: TestControl, opts: TpsRestoreOptions = {}): () => void {
  const proc = opts.proc ?? (process as unknown as ProcessLike);
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  let fired = false;
  const handlers = new Map<string, (arg?: unknown) => void>();
  for (const event of EVENTS) {
    const isSignal = event.startsWith('SIG');
    const handler = (arg?: unknown): void => {
      if (fired) return;
      fired = true;
      if (!isSignal) console.error(`${event}: ${arg instanceof Error ? arg.stack : String(arg)}`);
      void restoreServer(ctl, opts).finally(() => exit(isSignal ? 130 : 1));
    };
    handlers.set(event, handler);
    proc.on(event, handler);
  }
  return () => {
    for (const [event, handler] of handlers) proc.off(event, handler);
  };
}
