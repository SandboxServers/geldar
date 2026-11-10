/**
 * Reads the presence record of each ranger's life from the `geldar-presence` bucket, for `players status`. The
 * MCP writes the records; this only reads them. Any failure to reach NATS makes every life `unknown`.
 */
import { jetstream } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { connect } from '@nats-io/transport-node';
import { type Presence, parsePresenceRecord } from './rangers.ts';

/** The JetStream KV bucket of presence records; the same name as the contract's PRESENCE_BUCKET. */
export const PRESENCE_BUCKET = 'geldar-presence';
const CONNECT_TIMEOUT_MS = 3_000;

/** The presence of each life, read over one NATS connection. Unreachable NATS gives `unknown` for every life. */
export async function readPresence(
  natsUrl: string | undefined,
  lifeIds: readonly string[],
): Promise<Map<string, Presence>> {
  const unknown = new Map<string, Presence>(lifeIds.map((id) => [id, { kind: 'unknown' }]));
  if (natsUrl === undefined || natsUrl.trim() === '') return unknown;
  let nc: Awaited<ReturnType<typeof connect>>;
  try {
    nc = await connect({ servers: natsUrl, timeout: CONNECT_TIMEOUT_MS, reconnect: false });
  } catch {
    return unknown;
  }
  try {
    const kv = await new Kvm(jetstream(nc)).open(PRESENCE_BUCKET);
    const found = new Map<string, Presence>();
    for (const lifeId of lifeIds) {
      const entry = await kv.get(lifeId);
      found.set(
        lifeId,
        entry === null ? { kind: 'none' } : parsePresenceRecord(entry.string(), lifeId),
      );
    }
    return found;
  } catch {
    return unknown;
  } finally {
    await nc.close().catch(() => undefined);
  }
}
