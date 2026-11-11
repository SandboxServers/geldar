import { isIP } from 'node:net';

/**
 * The request header a trusted proxy's client address is read from: a single-valued header name
 * (default `x-geldar-client-ip`, which Caddy sets), or the mode
 * `x-forwarded-for`, read rightmost-untrusted-hop style.
 */
export type ClientIpHeader = string;

const DEFAULT_CLIENT_IP_HEADER: ClientIpHeader = 'x-geldar-client-ip';
const HEADER_NAME = /^[a-z0-9-]{1,64}$/;

export type Doc = Record<string, unknown>;

export function map(value: unknown, where: string): Doc {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be a mapping`);
  }
  return value as Doc;
}

export function field(block: Doc, key: string, where: string): unknown {
  if (block[key] === undefined) throw new Error(`${where}.${key} is missing`);
  return block[key];
}

export function text(block: Doc, key: string, where: string): string {
  const value = field(block, key, where);
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${where}.${key} must be a non-empty string`);
  return value;
}

/** The replay window in minutes: 60 when the key is absent; 1 to 1440 otherwise, the value named when refused. */
export function replayWindow(value: unknown): number {
  if (value === undefined) return 60;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1440) {
    throw new Error(
      `sovereign.mcp.replay_minutes must be an integer from 1 to 1440, got ${String(value)}`,
    );
  }
  return value;
}

export function int(block: Doc, key: string, where: string, min: number, max: number): number {
  const value = field(block, key, where);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${where}.${key} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export function bool(block: Doc, key: string, where: string): boolean {
  const value = field(block, key, where);
  if (typeof value !== 'boolean') throw new Error(`${where}.${key} must be true or false`);
  return value;
}

export function list(block: Doc, key: string, where: string): unknown[] {
  const value = field(block, key, where);
  if (!Array.isArray(value)) throw new Error(`${where}.${key} must be a list`);
  return value;
}

/** An optional integer: the fallback when the key is absent, else the same range check as `int`. */
export function optionalInt(
  block: Doc,
  key: string,
  where: string,
  min: number,
  max: number,
  fallback: number,
): number {
  return block[key] === undefined ? fallback : int(block, key, where, min, max);
}

/** The `trusted_proxies` list: each entry an IP address or an IP range (a prefix such as /8). Absent trusts none. */
export function proxyList(block: Doc, key: string, where: string): string[] {
  if (block[key] === undefined) return [];
  return proxyEntries(list(block, key, where), `${where}.${key}`);
}

/** GELDAR_MCP_TRUSTED_PROXIES: comma-separated IPs or ranges, checked like the yaml list. Empty is none. */
export function envProxyList(raw: string): string[] {
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return proxyEntries(entries, 'GELDAR_MCP_TRUSTED_PROXIES');
}

export function proxyEntries(entries: readonly unknown[], label: string): string[] {
  return entries.map((entry, index) => {
    if (typeof entry === 'string' && /\/0+$/.test(entry)) {
      throw new Error(
        `${label}[${index}] has prefix length 0, which would trust every peer; name a narrower range`,
      );
    }
    if (typeof entry !== 'string' || !validProxyEntry(entry)) {
      throw new Error(
        `${label}[${index}] must be an IP address or an IP range with a prefix length such as /8, not '${String(entry)}'`,
      );
    }
    const floor = prefixFloor(entry);
    if (floor !== undefined) {
      throw new Error(
        `${label}[${index}] has a prefix shorter than /${floor}, which would trust much of the internet; name a narrower range`,
      );
    }
    return entry;
  });
}

/** The IPv4-mapped block ::ffff:0:0/96 as a 128-bit number. */
const MAPPED_V4 = 0xffffn << 32n;
/** A mapped-IPv4 prefix must be at least this long (the mapped form of IPv4 /8). */
const MAPPED_FLOOR = 104;

/** An IPv6 address as a 128-bit number; `::`, and a dotted IPv4 tail, are expanded. */
function ipv6Bits(ip: string): bigint {
  let text = ip.split('%')[0] ?? '';
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail !== null) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.slice(1).map(Number);
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = rest === undefined || rest === '' ? [] : rest.split(':');
  const fill = rest === undefined ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array<string>(fill).fill('0'), ...right];
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(`0x${g}`), 0n);
}

/**
 * The shortest prefix the entry may have when its prefix is shorter, else undefined: /8 for IPv4, /32 for IPv6, and
 * /104 for an IPv6 prefix that covers IPv4-mapped space (::ffff:0:0/96 and `::/N`), which would trust IPv4 ranges
 * below the IPv4 floor.
 */
function prefixFloor(entry: string): number | undefined {
  const [ip = '', bits] = entry.split('/');
  if (bits === undefined) return undefined;
  const length = Number(bits);
  if (isIP(ip) !== 6) return length < 8 ? 8 : undefined;
  if (length < 32) return 32;
  if (length < MAPPED_FLOOR) {
    const shared = BigInt(Math.min(length, 96));
    const drop = 128n - shared;
    if (ipv6Bits(ip) >> drop === MAPPED_V4 >> drop) return MAPPED_FLOOR;
  }
  return undefined;
}
/** A header name for `client_ip_header`: lowercase letters, digits and hyphens. Absent is the default. */
export function headerName(raw: unknown, label: string): ClientIpHeader {
  if (raw === undefined) return DEFAULT_CLIENT_IP_HEADER;
  if (typeof raw !== 'string' || !HEADER_NAME.test(raw)) {
    throw new Error(
      `${label} must be a lowercase header name such as x-geldar-client-ip, not '${String(raw)}'`,
    );
  }
  return raw;
}

export function validProxyEntry(entry: string): boolean {
  const [ip = '', bits, extra] = entry.split('/');
  const family = isIP(ip);
  if (family === 0 || extra !== undefined) return false;
  if (bits === undefined) return true;
  return /^\d{1,3}$/.test(bits) && Number(bits) <= (family === 6 ? 128 : 32);
}
