import { jetstream } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { connect } from '@nats-io/transport-node';
import type { SignedTexture } from './mineskin.ts';

/** The JetStream KV bucket the Velocity identity plugin watches for skins. Keys are life ids; values are JSON. */
export const SKIN_BUCKET = 'geldar-skins';
const CONNECT_TIMEOUT_MS = 5_000;

/** The slice of a KV bucket the skin store uses (a fake in tests). */
export interface SkinKv {
  put(key: string, value: Uint8Array): Promise<number>;
}

/** What the bucket holds for one life. The plugin reads `value` and `signature` and ignores the rest. */
export interface SkinRecord {
  life_id: string;
  value: string;
  signature: string;
  model: 'classic' | 'slim';
  set_at: string;
}

/** Writes the signed texture of a life to the bucket; the value is never logged. */
export async function putSkin(
  kv: SkinKv,
  lifeId: string,
  texture: SignedTexture,
  now: Date,
): Promise<void> {
  const record: SkinRecord = {
    life_id: lifeId,
    value: texture.value,
    signature: texture.signature,
    model: texture.model,
    set_at: now.toISOString(),
  };
  await kv.put(lifeId, new TextEncoder().encode(JSON.stringify(record)));
}

/** Opens NATS and the skin bucket, creating the bucket when it is missing. Throws a fixed message when NATS is down. */
export async function openSkinBucket(
  natsUrl: string,
): Promise<{ kv: SkinKv; close: () => Promise<void> }> {
  let nc: Awaited<ReturnType<typeof connect>>;
  try {
    nc = await connect({ servers: natsUrl, timeout: CONNECT_TIMEOUT_MS, reconnect: false });
  } catch {
    throw new Error('NATS could not be reached at GELDAR_NATS_URL');
  }
  try {
    const kv = await new Kvm(jetstream(nc)).create(SKIN_BUCKET);
    return { kv, close: () => nc.close().then(() => undefined) };
  } catch {
    await nc.close().catch(() => undefined);
    throw new Error(`the ${SKIN_BUCKET} bucket could not be opened`);
  }
}
