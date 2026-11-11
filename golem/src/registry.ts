import { createHash } from 'node:crypto';
import { connectNats } from '@geldar/contract/nats';
import { jetstream } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import type { GolemConfig } from './config.ts';
import { golemNatsAuth } from './nats-credentials.ts';

/** The JetStream KV bucket the Velocity identity plugin watches; Golem creates it. */
export const REGISTRY_BUCKET = 'geldar-life-registry';
const CONNECT_TIMEOUT_MS = 5_000;
/**
 * A key expires this long after its last put, so a Body that stops without deleting its key (a
 * hard kill, a crash, a power cut) stops being admissible within about a minute.
 */
export const REGISTRY_TTL_MS = 60_000;
/** A registered username is re-put this often; it must stay well under REGISTRY_TTL_MS. */
export const HEARTBEAT_MS = 20_000;

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
  let nc: Awaited<ReturnType<typeof connectNats>>;
  try {
    nc = await connectNats({
      servers: natsUrl,
      name: 'golem',
      timeout: CONNECT_TIMEOUT_MS,
      ...golemNatsAuth(),
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
    const kv = await new Kvm(jetstream(nc))
      .create(REGISTRY_BUCKET, { ttl: REGISTRY_TTL_MS })
      .catch((error: unknown) => {
        const why = error instanceof Error ? error.message : String(error);
        throw new Error(
          `the life registry bucket ${REGISTRY_BUCKET} could not be created with a ${REGISTRY_TTL_MS} ms TTL (${why}); ` +
            'a bucket created before the TTL existed must be removed once (nats stream rm KV_geldar-life-registry) ' +
            'so golem can recreate it',
          { cause: error },
        );
      });
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
  /** One heartbeat timer per registered username; each re-puts the key so the TTL never lapses. */
  private readonly beats = new Map<string, ReturnType<typeof setInterval>>();
  private readonly open: () => Promise<OpenedRegistry>;
  private readonly now: () => Date;
  private readonly onHeartbeatError: (username: string, error: unknown) => void;

  constructor(
    open: () => Promise<OpenedRegistry>,
    now: () => Date = () => new Date(),
    onHeartbeatError: (username: string, error: unknown) => void = () => undefined,
  ) {
    this.open = open;
    this.now = now;
    this.onHeartbeatError = onHeartbeatError;
  }

  /** Puts the key now and then every HEARTBEAT_MS until unregister or close. */
  async register(username: string): Promise<void> {
    await this.put(username);
    this.stopBeat(username);
    const timer = setInterval(() => {
      this.put(username).catch((error: unknown) => this.onHeartbeatError(username, error));
    }, HEARTBEAT_MS);
    timer.unref();
    this.beats.set(username, timer);
  }

  private async put(username: string): Promise<void> {
    const opened = await this.connection();
    const value = { life_id: lifeIdFor(username), registered_at: this.now().toISOString() };
    this.touched.add(username);
    try {
      await opened.kv.put(registryKey(username), JSON.stringify(value));
    } catch (error) {
      // A dead connection must not stick: drop it so the next put opens a fresh one.
      await this.dropConnection().catch(() => undefined);
      throw error;
    }
  }

  private stopBeat(username: string): void {
    const timer = this.beats.get(username);
    if (timer === undefined) return;
    clearInterval(timer);
    this.beats.delete(username);
  }

  /**
   * Deletes the key. When the connection was dropped (a failed put, an outage) it is reopened
   * first, so a key that may have landed is not left behind; a username never put is a no-op.
   * Failures throw, and the caller logs them.
   */
  async unregister(username: string): Promise<void> {
    if (!this.touched.has(username)) return;
    this.stopBeat(username);
    const opened = await this.connection();
    try {
      await opened.kv.delete(registryKey(username));
    } catch (error) {
      await this.dropConnection().catch(() => undefined);
      throw error;
    }
    this.touched.delete(username);
  }

  /** Stops every heartbeat and drops the connection. Keys not deleted expire within REGISTRY_TTL_MS. */
  async close(): Promise<void> {
    for (const username of [...this.beats.keys()]) this.stopBeat(username);
    await this.dropConnection();
  }

  private async dropConnection(): Promise<void> {
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
  if (url === undefined) return undefined;
  return new LifeRegistration(
    () => openRegistryBucket(url),
    undefined,
    (username, error) =>
      console.error(
        `life registry: heartbeat for ${username} failed (${error instanceof Error ? error.message : String(error)}); the key expires unless a later beat lands`,
      ),
  );
}

/**
 * The keys whose entry names `lifeId` in its `life_id`. The Body writes its entry under the
 * lowercase username, which is the life id only when the username already is one (`GolemBench`
 * is written as `golembench`), so the removal cannot derive the key from the life id alone.
 */
async function keysForLife(
  kv: Awaited<ReturnType<Kvm['open']>>,
  lifeId: string,
): Promise<string[]> {
  const found: string[] = [];
  for await (const key of await kv.keys()) {
    const entry = await kv.get(key);
    if (entry === null) continue;
    let value: unknown;
    try {
      value = entry.json();
    } catch {
      continue;
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      'life_id' in value &&
      value.life_id === lifeId
    ) {
      found.push(key);
    }
  }
  return found;
}

/**
 * Deletes a life's registry keys over one NATS connection, for the tools that retire a life
 * (`players down`, `adam stop`, `mcp-tokens retire`). The key of the life id itself is always
 * deleted, and so is every other key whose entry names the life. A missing key is not an error.
 * Throws when NATS or the bucket cannot be reached; the caller reports it.
 */
export async function removeRegistryKey(natsUrl: string, lifeId: string): Promise<void> {
  const nc = await connectNats({
    servers: natsUrl,
    name: 'geldar-tools',
    timeout: CONNECT_TIMEOUT_MS,
    ...golemNatsAuth(),
  });
  try {
    const kv = await new Kvm(jetstream(nc)).open(REGISTRY_BUCKET);
    const keys = new Set([registryKey(lifeId), ...(await keysForLife(kv, lifeId))]);
    for (const key of keys) await kv.delete(key);
  } finally {
    await nc.close().catch(() => undefined);
  }
}
