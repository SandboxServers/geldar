import { connectNats } from '@geldar/contract/nats';
import { jetstream } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import type { SignedTexture } from './mineskin.ts';
import { RosterError } from './roster.ts';

/** The JetStream KV bucket the Velocity identity plugin watches for skins. Keys are life ids; values are JSON. */
export const SKIN_BUCKET = 'geldar-skins';
const CONNECT_TIMEOUT_MS = 5_000;

/** The slice of a KV bucket the skin store uses (a fake in tests). */
export interface SkinKv {
  put(key: string, value: Uint8Array): Promise<number>;
  /** Reads one key; null when absent. Optional so older fakes still type-check. */
  get?: ((key: string) => Promise<{ value: Uint8Array } | null>) | undefined;
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

/**
 * One line describing the stored skin of a life: variant, texture host and signature length. The value and the
 * signature are never returned. Throws a fixed message when the key is absent or the record is unreadable.
 */
export async function describeSkin(kv: SkinKv, lifeId: string): Promise<string> {
  if (kv.get === undefined) {
    throw new RosterError('this build cannot read the skin bucket');
  }
  const entry = await kv.get(lifeId);
  if (entry === null) {
    throw new RosterError(`no skin record for life ${lifeId} in ${SKIN_BUCKET}`);
  }
  try {
    const record = JSON.parse(new TextDecoder().decode(entry.value)) as Partial<SkinRecord>;
    const texture = JSON.parse(Buffer.from(String(record.value), 'base64').toString('utf8')) as {
      textures?: { SKIN?: { url?: string } };
    };
    const host = new URL(texture.textures?.SKIN?.url ?? '').host;
    const match = record.life_id === lifeId ? 'life_id matches' : 'life_id DOES NOT MATCH the key';
    const variant = record.model === 'slim' ? 'slim' : 'classic';
    return `skin for life ${lifeId}: variant ${variant}, texture host ${host}, signature length ${String(record.signature ?? '').length}, ${match}`;
  } catch {
    throw new RosterError(`the record for life ${lifeId} in ${SKIN_BUCKET} is unreadable`);
  }
}

/** Opens NATS and the skin bucket, creating the bucket when it is missing. Throws a fixed message when NATS is down. */
export async function openSkinBucket(
  natsUrl: string,
): Promise<{ kv: SkinKv; close: () => Promise<void> }> {
  let nc: Awaited<ReturnType<typeof connectNats>>;
  try {
    nc = await connectNats({ servers: natsUrl, name: 'players-cli', timeout: CONNECT_TIMEOUT_MS });
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
