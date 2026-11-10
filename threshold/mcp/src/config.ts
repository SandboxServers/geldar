import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';

/** One sovereign ranger as the shard file lists it (`sovereign.players`). */
export interface PlayerConfig {
  /** The launcher player id from the URL path, such as ag-jason-01. */
  playerId: string;
  /** The game account and registry key: the player id with hyphens as underscores. */
  lifeId: string;
  /** The in-universe display name, such as Jason. */
  name: string;
}

/** The `sovereign` block of the shard file (spec 5.15; decisions 0040, 0041, 0052). */
export interface SovereignConfig {
  /** False refuses every sovereign player on this shard. */
  allowed: boolean;
  /** Harness type to enabled flag; a disabled harness refuses its players' tokens. */
  harnesses: Record<string, boolean>;
  /** Sovereign players one owner may hold on this shard. */
  ownerCapDefault: number;
  /** The owner's own cap (decision 0052). */
  ownerCapOwner: number;
  /** The MCP's plain HTTP port. */
  port: number;
  /** Proxies whose CF-Connecting-IP names the client: exact IPs or CIDR ranges. Empty trusts none. */
  trustedProxies: string[];
  /** The most open connections the listener holds at once. */
  maxConnections: number;
  /** The most open connections, and open POST requests, one client address holds at once. */
  maxConnectionsPerAddress: number;
  /** The most seconds one `wait` may block; `wait`'s max_seconds is clamped to this. */
  waitCapSeconds: number;
  /** The interval between keepalive notifications on an open wait. */
  keepaliveSeconds: number;
  /** The largest request body the MCP reads. */
  maxBodyBytes: number;
  /** The largest tool result, after trimming. */
  maxResultBytes: number;
  /** How long a replayed or revoked token stays under watch. */
  replayMinutes: number;
  wake: { minSpacingSeconds: number; intentRunTooLongSeconds: number };
  presence: {
    leaseSeconds: number;
    hibernateAfterSeconds: number;
    start: 'on_demand' | 'always';
  };
  budget: { creditsPerRealHour: number; capCredits: number };
  rateLimits: {
    callsPerMinute: number;
    actMinSeconds: number;
    sayMinSeconds: number;
    ownerCallsPerMinute: number;
    failedAuthPerMinute: number;
    /** Per player: initialize, resources/read and the other non-call methods. */
    handshakePerMinute: number;
  };
  players: PlayerConfig[];
}

/** The MCP's whole configuration: the shard file's keys it reads, plus its environment. */
export interface McpConfig {
  shard: string;
  tickRate: number;
  worldBorderRadius: number;
  chat: { radius: number; maxChars: number };
  plan: { expiresAfterTicks: number };
  sovereign: SovereignConfig;
  nats: { url: string };
  postgres: {
    host: string;
    port: number;
    database: string;
    user: 'geldar_mcp';
    passwordFile: string;
  };
  /** The HMAC pepper for token hashes; a file, never the value. */
  pepperFile: string;
  http: {
    /** 127.0.0.1 locally; 0.0.0.0 only inside the container (GELDAR_MCP_IN_CONTAINER=1). */
    bind: string;
    port: number;
    /** The `Host` values the server accepts: the public host when set, then the dev hosts. */
    allowedHosts: string[];
    /** Proxies whose CF-Connecting-IP names the client (exact IPs or CIDR ranges). Empty trusts none. */
    trustedProxies: string[];
    /** The most open connections the listener holds at once. */
    maxConnections: number;
    /** The most open connections, and open POST requests, one client address holds at once. */
    maxConnectionsPerAddress: number;
    /** The public DNS name, or null in local mode. */
    publicHost: string | null;
  };
}

/** Where configuration comes from; the process environment and `shards/<shard>.yaml` by default. */
export interface LoadOptions {
  /** Environment overrides; the process environment when absent. */
  env?: Record<string, string | undefined>;
  /** The shard file; `shards/<GELDAR_SHARD or phase0>.yaml` when absent. */
  file?: string;
}

type Doc = Record<string, unknown>;
type Env = Record<string, string | undefined>;

const SHARD_NAME = /^[a-z][a-z0-9-]{1,31}$/;
const PLAYER_ID = /^[a-z][a-z0-9-]{1,38}$/;
const LIFE_ID = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;
const DNS_NAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const HOST_TOKEN = /^[a-z0-9.-]+$/;
const DEFAULT_DEV_HOSTS = 'host.docker.internal,127.0.0.1,localhost';
/** Used when the shard file leaves `rate_limits.handshake_per_minute` out: above the 60 calls a minute. */
const HANDSHAKE_PER_MINUTE_DEFAULT = 300;

/** The repository root: the nearest directory above this file that holds pnpm-workspace.yaml. */
export function repoRoot(): string {
  let dir = import.meta.dirname;
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error('repository root not found: no pnpm-workspace.yaml above threshold/mcp/src');
    dir = parent;
  }
  return dir;
}

/** The life id a player id derives to: hyphens become underscores (`ag-jason-01` to `ag_jason_01`). */
export function lifeIdFor(playerId: string): string {
  return playerId.replaceAll('-', '_');
}

/** Reads the shard file and the environment and builds the configuration. Throws on the first problem. */
export async function loadMcpConfig(options: LoadOptions = {}): Promise<McpConfig> {
  const env = options.env ?? process.env;
  const file = options.file ?? join(repoRoot(), 'shards', `${shardName(env)}.yaml`);
  return parseMcpConfig(parse(await readFile(file, 'utf8')), options);
}

/** Builds the configuration from an already parsed shard file. Throws on the first problem, naming the key. */
export function parseMcpConfig(doc: unknown, options: LoadOptions = {}): McpConfig {
  const env = options.env ?? process.env;
  const root = map(doc, 'shard file');
  const shard = shardName(env);
  const fileShard = text(root, 'shard', 'shard file');
  if (fileShard !== shard) {
    throw new Error(`shard file is for '${fileShard}' but GELDAR_SHARD selects '${shard}'`);
  }
  const mind = map(root.mind, 'mind');
  const agentUsername = text(map(mind.agent, 'mind.agent'), 'username', 'mind.agent');
  const plan = map(map(mind.plan, 'mind.plan'), 'mind.plan');
  const chat = map(root.chat, 'chat');
  const sovereign = sovereignConfig(map(root.sovereign, 'sovereign'), agentUsername);
  const http = httpConfig(env, sovereign);
  return {
    shard,
    tickRate: int(root, 'tick_rate', 'shard file', 1, 200),
    worldBorderRadius: int(root, 'world_border_radius', 'shard file', 1, 30000000),
    chat: {
      radius: int(chat, 'radius', 'chat', 0, 256),
      maxChars: int(chat, 'max_chars', 'chat', 1, 4096),
    },
    plan: { expiresAfterTicks: int(plan, 'expires_after_ticks', 'mind.plan', 1, 1_000_000) },
    sovereign,
    nats: { url: natsUrl(env.GELDAR_NATS_URL) },
    postgres: {
      host: envText(env, 'POSTGRES_HOST', '127.0.0.1'),
      port: envPort(env, 'POSTGRES_PORT', 5432),
      database: envText(env, 'POSTGRES_DB', 'geldar'),
      user: 'geldar_mcp',
      passwordFile: requiredEnv(env, 'GELDAR_MCP_DB_PASSWORD_FILE'),
    },
    pepperFile: requiredEnv(env, 'GELDAR_MCP_PEPPER_FILE'),
    http,
  };
}

/** The shard name from GELDAR_SHARD, `phase0` when unset. */
function shardName(env: Env): string {
  const shard = env.GELDAR_SHARD ?? 'phase0';
  if (!SHARD_NAME.test(shard)) throw new Error(`GELDAR_SHARD '${shard}' is not a shard name`);
  return shard;
}

/** Reads and checks the `sovereign` block, including the player list. */
function sovereignConfig(block: Doc, agentUsername: string): SovereignConfig {
  const mcp = map(block.mcp, 'sovereign.mcp');
  const wake = map(block.wake, 'sovereign.wake');
  const presence = map(block.presence, 'sovereign.presence');
  const budget = map(block.budget, 'sovereign.budget');
  const limits = map(block.rate_limits, 'sovereign.rate_limits');
  const harnesses: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(map(block.harnesses, 'sovereign.harnesses'))) {
    harnesses[name] = bool(
      map(value, `sovereign.harnesses.${name}`),
      'enabled',
      `sovereign.harnesses.${name}`,
    );
  }
  const start = text(presence, 'start', 'sovereign.presence');
  if (start !== 'on_demand' && start !== 'always') {
    throw new Error(`sovereign.presence.start must be on_demand or always, not '${start}'`);
  }
  return {
    allowed: bool(block, 'allowed', 'sovereign'),
    harnesses,
    ownerCapDefault: int(block, 'owner_cap_default', 'sovereign', 0, 50),
    ownerCapOwner: int(block, 'owner_cap_owner', 'sovereign', 0, 50),
    port: int(mcp, 'port', 'sovereign.mcp', 1, 65535),
    trustedProxies: proxyList(mcp, 'trusted_proxies', 'sovereign.mcp'),
    maxConnections: optionalInt(mcp, 'max_connections', 'sovereign.mcp', 1, 4096, 256),
    maxConnectionsPerAddress: optionalInt(
      mcp,
      'max_connections_per_address',
      'sovereign.mcp',
      1,
      4096,
      32,
    ),
    waitCapSeconds: int(mcp, 'wait_cap_seconds', 'sovereign.mcp', 1, 240),
    keepaliveSeconds: int(mcp, 'keepalive_seconds', 'sovereign.mcp', 1, 240),
    maxBodyBytes: int(mcp, 'max_body_bytes', 'sovereign.mcp', 1024, 1_048_576),
    maxResultBytes: int(mcp, 'max_result_bytes', 'sovereign.mcp', 1024, 65536),
    replayMinutes: int(mcp, 'replay_minutes', 'sovereign.mcp', 1, 1440),
    wake: {
      minSpacingSeconds: int(wake, 'min_spacing_seconds', 'sovereign.wake', 0, 3600),
      intentRunTooLongSeconds: int(wake, 'intent_run_too_long_seconds', 'sovereign.wake', 1, 86400),
    },
    presence: {
      leaseSeconds: int(presence, 'lease_seconds', 'sovereign.presence', 1, 3600),
      hibernateAfterSeconds: int(
        presence,
        'hibernate_after_seconds',
        'sovereign.presence',
        1,
        86400,
      ),
      start,
    },
    budget: {
      creditsPerRealHour: int(budget, 'credits_per_real_hour', 'sovereign.budget', 0, 10000),
      capCredits: int(budget, 'cap_credits', 'sovereign.budget', 0, 100000),
    },
    rateLimits: {
      callsPerMinute: int(limits, 'calls_per_minute', 'sovereign.rate_limits', 1, 100000),
      actMinSeconds: int(limits, 'act_min_seconds', 'sovereign.rate_limits', 0, 3600),
      sayMinSeconds: int(limits, 'say_min_seconds', 'sovereign.rate_limits', 0, 3600),
      ownerCallsPerMinute: int(
        limits,
        'owner_calls_per_minute',
        'sovereign.rate_limits',
        1,
        100000,
      ),
      failedAuthPerMinute: int(
        limits,
        'failed_auth_per_minute',
        'sovereign.rate_limits',
        1,
        100000,
      ),
      handshakePerMinute:
        limits.handshake_per_minute === undefined
          ? HANDSHAKE_PER_MINUTE_DEFAULT
          : int(limits, 'handshake_per_minute', 'sovereign.rate_limits', 1, 100000),
    },
    players: players(list(block, 'players', 'sovereign'), agentUsername),
  };
}

/** Checks each `sovereign.players` entry: the id pattern, the derived life id, and no clash with Adam. */
function players(entries: unknown[], agentUsername: string): PlayerConfig[] {
  const seen = new Set<string>();
  return entries.map((entry, i) => {
    const where = `sovereign.players[${i}]`;
    const block = map(entry, where);
    const playerId = text(block, 'player_id', where);
    if (!PLAYER_ID.test(playerId)) {
      throw new Error(
        `${where}.player_id '${playerId}' must be lowercase letters, digits and hyphens`,
      );
    }
    const lifeId = text(block, 'life_id', where);
    if (lifeId !== lifeIdFor(playerId) || !LIFE_ID.test(lifeId)) {
      throw new Error(
        `${where}.life_id must be ${lifeIdFor(playerId)}, the player id with underscores`,
      );
    }
    if (lifeId === agentUsername)
      throw new Error(`${where}.life_id is Adam's life: the MCP never serves it`);
    if (seen.has(playerId)) throw new Error(`${where}.player_id '${playerId}' is listed twice`);
    seen.add(playerId);
    return { playerId, lifeId, name: text(block, 'name', where) };
  });
}

/** Builds the HTTP settings from the environment: bind address, public host and the Host allow-list. */
function httpConfig(env: Env, sovereign: SovereignConfig): McpConfig['http'] {
  const inContainer = containerFlag(env.GELDAR_MCP_IN_CONTAINER);
  const bind = envText(env, 'GELDAR_MCP_BIND', '127.0.0.1');
  if (bind === '0.0.0.0') {
    if (!inContainer) throw new Error('GELDAR_MCP_BIND 0.0.0.0 needs GELDAR_MCP_IN_CONTAINER=1');
  } else if (bind !== '127.0.0.1') {
    throw new Error(
      `GELDAR_MCP_BIND must be 127.0.0.1, or 0.0.0.0 inside the container, not '${bind}'`,
    );
  }
  const publicHost =
    env.GELDAR_MCP_PUBLIC_HOST === undefined ? null : publicHostName(env.GELDAR_MCP_PUBLIC_HOST);
  const devHosts = hostList(env.GELDAR_MCP_DEV_HOSTS ?? DEFAULT_DEV_HOSTS);
  if (publicHost === null && devHosts.length === 0) {
    throw new Error(
      'GELDAR_MCP_PUBLIC_HOST is unset and GELDAR_MCP_DEV_HOSTS is empty: no Host would be accepted',
    );
  }
  return {
    bind,
    port: sovereign.port,
    allowedHosts: publicHost === null ? devHosts : [publicHost, ...devHosts],
    publicHost,
    trustedProxies: sovereign.trustedProxies,
    maxConnections: sovereign.maxConnections,
    maxConnectionsPerAddress: sovereign.maxConnectionsPerAddress,
  };
}

/** GELDAR_MCP_IN_CONTAINER: unset or 0 is false, 1 is true, anything else is an error. */
function containerFlag(raw: string | undefined): boolean {
  if (raw === undefined || raw === '' || raw === '0') return false;
  if (raw === '1') return true;
  throw new Error(`GELDAR_MCP_IN_CONTAINER must be 1 or 0, not '${raw}'`);
}

/**
 * The public host follows the launcher's rules: a DNS name, never an IP literal, `localhost`,
 * `*.local`, `*.internal` or anything with userinfo.
 */
export function publicHostName(raw: string): string {
  const host = raw.trim().toLowerCase();
  const where = `GELDAR_MCP_PUBLIC_HOST '${raw}'`;
  if (host.includes('@')) throw new Error(`${where} must not carry userinfo`);
  if (host.includes(':') || /^[0-9.]+$/.test(host))
    throw new Error(`${where} is an IP literal: use a DNS name`);
  if (host === 'localhost' || host.endsWith('.localhost'))
    throw new Error(`${where} must not be localhost`);
  if (host.endsWith('.local')) throw new Error(`${where} must not be a *.local name`);
  if (host.endsWith('.internal')) throw new Error(`${where} must not be a *.internal name`);
  if (!DNS_NAME.test(host)) throw new Error(`${where} is not a DNS name`);
  return host;
}

/** GELDAR_MCP_DEV_HOSTS: a comma-separated list of host names, each checked against a plain host pattern. */
function hostList(raw: string): string[] {
  if (raw.trim() === '') return [];
  return raw.split(',').map((part) => {
    const host = part.trim().toLowerCase();
    if (!HOST_TOKEN.test(host))
      throw new Error(`GELDAR_MCP_DEV_HOSTS entry '${part.trim()}' is not a host name`);
    return host;
  });
}

/** GELDAR_NATS_URL: a nats:// URL, `nats://127.0.0.1:4222` when unset. */
function natsUrl(raw: string | undefined): string {
  const url = raw ?? 'nats://127.0.0.1:4222';
  if (!/^nats:\/\/[a-z0-9.-]+:[0-9]{2,5}$/i.test(url)) {
    throw new Error(`GELDAR_NATS_URL '${url}' must be nats://host:port`);
  }
  return url;
}

/** A required environment value; the error names the variable. */
function requiredEnv(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') throw new Error(`${name} is required`);
  return value;
}

/** An optional environment text with a default. */
function envText(env: Env, name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

/** An optional port from the environment with a default; must be 1 to 65535. */
function envPort(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^[0-9]{1,5}$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
    throw new Error(`${name} must be a port from 1 to 65535, not '${raw}'`);
  }
  return Number(raw);
}

function map(value: unknown, where: string): Doc {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be a mapping`);
  }
  return value as Doc;
}

function field(block: Doc, key: string, where: string): unknown {
  if (block[key] === undefined) throw new Error(`${where}.${key} is missing`);
  return block[key];
}

function text(block: Doc, key: string, where: string): string {
  const value = field(block, key, where);
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${where}.${key} must be a non-empty string`);
  return value;
}

function int(block: Doc, key: string, where: string, min: number, max: number): number {
  const value = field(block, key, where);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${where}.${key} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function bool(block: Doc, key: string, where: string): boolean {
  const value = field(block, key, where);
  if (typeof value !== 'boolean') throw new Error(`${where}.${key} must be true or false`);
  return value;
}

function list(block: Doc, key: string, where: string): unknown[] {
  const value = field(block, key, where);
  if (!Array.isArray(value)) throw new Error(`${where}.${key} must be a list`);
  return value;
}

/** An optional integer: the fallback when the key is absent, else the same range check as `int`. */
function optionalInt(
  block: Doc,
  key: string,
  where: string,
  min: number,
  max: number,
  fallback: number,
): number {
  return block[key] === undefined ? fallback : int(block, key, where, min, max);
}

/** The `trusted_proxies` list: each entry an IP address or an IP range (`10.0.0.0/8`). Absent trusts none. */
function proxyList(block: Doc, key: string, where: string): string[] {
  if (block[key] === undefined) return [];
  return list(block, key, where).map((entry, index) => {
    if (typeof entry === 'string' && /\/0+$/.test(entry)) {
      throw new Error(
        `${where}.${key}[${index}] has prefix length 0, which would trust every peer; name a narrower range`,
      );
    }
    if (typeof entry !== 'string' || !validProxyEntry(entry)) {
      throw new Error(
        `${where}.${key}[${index}] must be an IP address or an IP range such as 10.0.0.0/8, not '${String(entry)}'`,
      );
    }
    return entry;
  });
}

function validProxyEntry(entry: string): boolean {
  const [ip = '', bits, extra] = entry.split('/');
  const family = isIP(ip);
  if (family === 0 || extra !== undefined) return false;
  if (bits === undefined) return true;
  return /^\d{1,3}$/.test(bits) && Number(bits) <= (family === 6 ? 128 : 32);
}
