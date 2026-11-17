/**
 * The probe's independent check that its registry key is gone. The cleanup trusts the delete
 * call's own success; this step reads the key back after cleanup, over a fresh NATS connection
 * with the probe's own credentials. It only reads: the bucket is opened without creating it, so a
 * missing bucket is an error (`unknown`), never a new bucket. It never prints a value.
 */
import { connectNats } from '@geldar/contract/nats';
import { jetstream } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { golemNatsAuth } from '../nats-credentials.ts';
import { REGISTRY_BUCKET } from '../registry.ts';
import { bounded, reasonOf } from './probe-steps.ts';

/** How long the verify waits for its read. A read that does not answer in time is `unknown`. */
export const VERIFY_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 5_000;

/** What the read found: a live entry (`present`), or no entry and no delete or purge marker (`absent`). */
export type RegistryState = 'present' | 'absent';

/** The verify outcome. `unknown` means the read failed or timed out; `reason` then says why. */
export interface VerifyResult {
  state: RegistryState | 'unknown';
  reason?: string;
}

/**
 * Reads `key` from the existing life registry bucket over one NATS connection that is closed on
 * every path. A key with a `DEL` or `PURGE` marker, or no entry at all, is `absent`.
 */
export async function readRegistryKey(natsUrl: string, key: string): Promise<RegistryState> {
  const nc = await connectNats({
    servers: natsUrl,
    name: 'golem-p0-verify',
    timeout: CONNECT_TIMEOUT_MS,
    ...golemNatsAuth(),
  });
  try {
    // open() does not create the bucket: a missing bucket throws here, and the verify reports unknown.
    const kv = await new Kvm(jetstream(nc)).open(REGISTRY_BUCKET);
    const entry = await kv.get(key);
    return entry === null || entry.operation !== 'PUT' ? 'absent' : 'present';
  } finally {
    await nc.close().catch(() => undefined);
  }
}

/**
 * Runs one read for at most `ms` and maps the outcome: the read's state, or `unknown` with the
 * reason when it throws or does not answer in time. The wait uses its own signal, so an interrupt
 * earlier in the run never skips the read.
 */
export async function verifyRegistry(
  read: () => Promise<RegistryState>,
  ms: number = VERIFY_TIMEOUT_MS,
): Promise<VerifyResult> {
  try {
    const state = await bounded(
      read(),
      ms,
      'registry verify timed out',
      new AbortController().signal,
    );
    return { state };
  } catch (error) {
    return { state: 'unknown', reason: reasonOf(error) };
  }
}
