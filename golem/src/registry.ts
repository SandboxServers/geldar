import { createHash } from 'node:crypto';
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

/** The LifeId pattern of contract/schemas/common.schema.json. */
const LIFE_ID = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;

/**
 * The permanent life id for a bot username. A username that already is a LifeId (`ag_kestrel_01`)
 * is used unchanged, so the registry and the plugin's `agent_id` agree. Any other username becomes
 * `ag_<stem><hash>_01`: the stem is the username lowercased, stripped to `[a-z0-9]`, starting with
 * a letter and cut to 8 characters (`bot` when nothing is left); the hash is the first 8 hex
 * digits of the SHA-256 of the exact username, so `Steve_1` and `Steve1` get distinct ids.
 */
export function lifeIdFor(username: string): string {
  if (LIFE_ID.test(username)) return username;
  const stem = username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^[0-9]+/, '')
    .slice(0, 8);
  const hash = createHash('sha256').update(username).digest('hex').slice(0, 8);
  return `ag_${stem === '' ? 'bot' : stem}${hash}_01`;
}
/** The registry key for a username: lowercase, as the plugin looks it up. */
export function registryKey(username: string): string {
  return username.toLowerCase();
}

/** Host and port of a NATS URL, for messages: credentials and the path never reach a log. */
function hostAndPort(natsUrl: string): string {
  try {
    return new URL(natsUrl).host;
  } catch {
    return 'the configured NATS server';
  }
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
      `NATS is unreachable at ${hostAndPort(natsUrl)} (${why}); start the shard (./geldar.ps1 shard up phase0) ` +
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
 * Opening is single-flight: overlapping calls share one connection.
 */
export class LifeRegistration implements BotRegistry {
  private opened: OpenedRegistry | null = null;
  private opening: Promise<OpenedRegistry> | null = null;
  /** Usernames a put was attempted for; a put may land even when its reply is lost. */
  private readonly touched = new Set<string>();
  private readonly open: () => Promise<OpenedRegistry>;
  private readonly now: () => Date;

  constructor(open: () => Promise<OpenedRegistry>, now: () => Date = () => new Date()) {
    this.open = open;
    this.now = now;
  }

  async register(username: string): Promise<void> {
    const opened = await this.connection();
    const value = { life_id: lifeIdFor(username), registered_at: this.now().toISOString() };
    this.touched.add(username);
    try {
      await opened.kv.put(registryKey(username), JSON.stringify(value));
    } catch (error) {
      // A dead connection must not stick: drop it so the next register opens a fresh one.
      await this.close().catch(() => undefined);
      throw error;
    }
  }

  /**
   * Deletes the key. When the connection was dropped (a failed put, an outage) it is reopened
   * first, so a key that may have landed is not left behind; a username never put is a no-op.
   * Failures throw, and the caller logs them.
   */
  async unregister(username: string): Promise<void> {
    if (!this.touched.has(username)) return;
    const opened = await this.connection();
    try {
      await opened.kv.delete(registryKey(username));
    } catch (error) {
      await this.close().catch(() => undefined);
      throw error;
    }
    this.touched.delete(username);
  }

  async close(): Promise<void> {
    await this.opening?.catch(() => undefined);
    const opened = this.opened;
    this.opened = null;
    await opened?.close();
  }

  /** The open bucket, opening it if needed; concurrent callers wait for the same open. */
  private connection(): Promise<OpenedRegistry> {
    if (this.opened !== null) return Promise.resolve(this.opened);
    this.opening ??= this.open()
      .then((opened) => {
        this.opened = opened;
        return opened;
      })
      .finally(() => {
        this.opening = null;
      });
    return this.opening;
  }
}
/** The registry for a config: undefined (registry off) unless `GELDAR_NATS_URL` is set. */
export function registryFromConfig(cfg: GolemConfig): BotRegistry | undefined {
  const url = cfg.natsUrl;
  return url === undefined ? undefined : new LifeRegistration(() => openRegistryBucket(url));
}
