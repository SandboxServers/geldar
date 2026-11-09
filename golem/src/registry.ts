import { jetstream } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { connect } from '@nats-io/transport-node';
import type { GolemConfig } from './config.ts';

/** The JetStream KV bucket the Velocity identity plugin watches; Golem creates it. */
export const REGISTRY_BUCKET = 'geldar-life-registry';
const CONNECT_TIMEOUT_MS = 5_000;

/** The slice of a JetStream KV bucket the registry uses (a fake in tests). */
export interface RegistryKv {
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<void>;
}

/** An open bucket and the way to release its NATS connection. */
export interface OpenedRegistry {
  kv: RegistryKv;
  close(): Promise<void>;
}

/** What the connection manager needs: register a bot username, remove it, release everything. */
export interface BotRegistry {
  /** Makes `username` admissible at the ingress; throws a clear error when NATS is unreachable. */
  register(username: string): Promise<void>;
  /** Revokes `username` (deletes its key); a no-op when it was never registered. */
  unregister(username: string): Promise<void>;
  /** Drops the NATS connection. */
  close(): Promise<void>;
}

/**
 * The permanent life id for a bot username: `ag_<name>_01` where name is the username lowercased,
 * stripped to `[a-z0-9]`, starting with a letter and at most 16 characters (the LifeId pattern of
 * contract/schemas/common.schema.json). A username with no usable letters becomes `bot`.
 */
export function lifeIdFor(username: string): string {
  const name = username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^[0-9]+/, '')
    .slice(0, 16);
  return `ag_${name === '' ? 'bot' : name}_01`;
}

/** The registry key for a username: lowercase, as the plugin looks it up. */
export function registryKey(username: string): string {
  return username.toLowerCase();
}

/** Opens NATS and creates the bucket if it is missing. Throws a clear error when unreachable. */
export async function openRegistryBucket(natsUrl: string): Promise<OpenedRegistry> {
  let nc: Awaited<ReturnType<typeof connect>>;
  try {
    nc = await connect({
      servers: natsUrl,
      name: 'golem',
      timeout: CONNECT_TIMEOUT_MS,
      reconnect: false,
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(
      `NATS is unreachable at ${natsUrl} (${why}); start the shard (./geldar.ps1 shard up phase0) ` +
        'or unset GELDAR_NATS_URL to run without the life registry',
      { cause: error },
    );
  }
  try {
    const kv = await new Kvm(jetstream(nc)).create(REGISTRY_BUCKET);
    return { kv, close: () => nc.close().then(() => undefined) };
  } catch (error) {
    await nc.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Registers bot usernames in the life registry. NATS is opened on the first `register`, so a
 * session that never needs it never connects; an unreachable NATS fails every `register` anew.
 */
export class LifeRegistration implements BotRegistry {
  private opened: OpenedRegistry | null = null;
  private readonly open: () => Promise<OpenedRegistry>;
  private readonly now: () => Date;

  constructor(open: () => Promise<OpenedRegistry>, now: () => Date = () => new Date()) {
    this.open = open;
    this.now = now;
  }

  async register(username: string): Promise<void> {
    this.opened ??= await this.open();
    const value = { life_id: lifeIdFor(username), registered_at: this.now().toISOString() };
    try {
      await this.opened.kv.put(registryKey(username), JSON.stringify(value));
    } catch (error) {
      // A dead connection must not stick: drop it so the next register opens a fresh one.
      await this.close().catch(() => undefined);
      throw error;
    }
  }

  async unregister(username: string): Promise<void> {
    await this.opened?.kv.delete(registryKey(username));
  }

  async close(): Promise<void> {
    const opened = this.opened;
    this.opened = null;
    await opened?.close();
  }
}

/** The registry for a config: undefined (registry off) unless `GELDAR_NATS_URL` is set. */
export function registryFromConfig(cfg: GolemConfig): BotRegistry | undefined {
  const url = cfg.natsUrl;
  return url === undefined ? undefined : new LifeRegistration(() => openRegistryBucket(url));
}
