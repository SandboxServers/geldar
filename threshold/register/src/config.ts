import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { TERMS_VERSION } from './account.ts';
import { APPROVED_TERMS_VERSIONS, termsApproved } from './signup-gate.ts';

export interface ProviderCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** The register's NATS link for the body routes (C7-04c2). The password is read from a file, never from the environment. */
export interface RegisterNats {
  readonly url: string;
  readonly user: string;
  readonly password: string;
  /** The reply wait of one supervisor request, in milliseconds. */
  readonly timeoutMs: number;
}

export interface RegisterConfig {
  /** Null when NATS is not configured: the body routes then stay unmounted (404) and the service starts normally. */
  readonly nats: RegisterNats | null;
  /** True when the URL, user and password file are set but the file is unreadable or empty (NATS is then off). */
  readonly natsPasswordUnreadable: boolean;
  /** Registration is off while this is true. The default is true (decision 0135 item 5). */
  readonly killSwitch: boolean;
  /** REGISTER_REQUIRE_MC_OWNERSHIP: only the exact string 'true' turns the Minecraft Java check on for NEW sign-ups. */
  readonly requireMcOwnership: boolean;
  readonly publicUrl: string;
  /** The MCP base shown on the onboarding page. Empty unless REGISTER_MCP_PUBLIC_URL is set; then it wins. */
  readonly mcpPublicUrl: string;
  readonly host: string;
  readonly port: number;
  /** The Microsoft (Entra) app: client id from the environment, client secret from a file. */
  readonly microsoft: ProviderCredentials;
  /** The key the shared Glass session cookie is signed with (R42); Glass reads the same file. */
  readonly sessionKey: string;
  readonly pepper: string;
  /** The MCP server's token pepper: a minted token's hash must match what the MCP checks (0054). */
  readonly tokenPepper: string;
  readonly shard: string;
  readonly harnesses: readonly string[];
  /** Sign-in and sign-up per IP (IPv6: per /64) per minute: the burst allowed (R41). */
  readonly signInPerMinute: number;
  /** Player creation and token minting per owner per minute (R41). */
  readonly ownerPerMinute: number;
  readonly trustedPeers: readonly string[];
  readonly perMinute: number;
}

function intOf(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

function required(raw: string | undefined, name: string): string {
  if (!raw) throw new Error(`${name} is not set`);
  return raw;
}

/**
 * The token pepper, read as the MCP reads it (threshold/mcp/src/main.ts pepperBytes): no byte-order mark, one trailing
 * LF or CRLF removed and nothing else, at least 32 bytes. A different read gives tokens the MCP can never match.
 */
function tokenPepper(
  env: Readonly<Record<string, string | undefined>>,
  readSecret: (path: string) => string,
): string {
  const path = env.REGISTER_TOKEN_PEPPER_FILE;
  if (!path) throw new Error('REGISTER_TOKEN_PEPPER_FILE is not set');
  const text = readSecret(path);
  if (text.startsWith('﻿'))
    throw new Error('REGISTER_TOKEN_PEPPER_FILE starts with a byte-order mark');
  const value = text.replace(/\r?\n$/, '');
  if (Buffer.byteLength(value, 'utf8') < 32)
    throw new Error('REGISTER_TOKEN_PEPPER_FILE is shorter than 32 bytes');
  return value;
}

/**
 * The trusted peers are matched as exact address strings, so each entry must be an IP literal. A CIDR
 * range (valid in the MCP's list) is refused at startup rather than silently never matching (F26).
 */
function trustedPeerList(raw: string): string[] {
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const entry of entries) {
    if (isIP(entry) === 0) {
      throw new Error(
        `REGISTER_TRUSTED_PEERS entry "${entry}" is not an IP literal (a CIDR range is not supported here; list the proxy address)`,
      );
    }
  }
  return entries;
}

/**
 * The NATS link (C7-04c2): the URL, the user and the password file must all be set, or NATS is off. A partial setting
 * or an unreadable or empty password file gives null and never fails the start. A set URL that is not nats:// is refused.
 */
const NATS_TIMEOUT_MAX_MS = 60000;

function natsOf(
  env: Readonly<Record<string, string | undefined>>,
  readSecret: (path: string) => string,
): { readonly nats: RegisterNats | null; readonly passwordUnreadable: boolean } {
  const url = env.REGISTER_NATS_URL ?? '';
  const user = env.REGISTER_NATS_USER ?? '';
  const passwordFile = env.REGISTER_NATS_PASSWORD_FILE ?? '';
  const off = { nats: null, passwordUnreadable: false };
  if (url === '' || user === '' || passwordFile === '') return off;
  if (!url.startsWith('nats://')) throw new Error('REGISTER_NATS_URL must be nats://');
  let password = '';
  try {
    password = readSecret(passwordFile).trim();
  } catch {
    password = '';
  }
  if (password === '') return { nats: null, passwordUnreadable: true };
  const timeoutMs = intOf(env.REGISTER_NATS_TIMEOUT_MS, 5000, 'REGISTER_NATS_TIMEOUT_MS');
  if (timeoutMs < 1 || timeoutMs > NATS_TIMEOUT_MAX_MS)
    throw new Error(`REGISTER_NATS_TIMEOUT_MS must be from 1 to ${NATS_TIMEOUT_MAX_MS}`);
  return { nats: { url, user, password, timeoutMs }, passwordUnreadable: false };
}

/**
 * Reads the config from an environment map. A secret is read from the file named by
 * `<NAME>_FILE`. Only the exact string `false` turns the kill switch off, and even then the
 * switch stays on unless the current terms version is approved (C7-11 sign-up gate).
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
  readSecret: (path: string) => string = (p) => readFileSync(p, 'utf8'),
  approvedTerms: readonly string[] = APPROVED_TERMS_VERSIONS,
): RegisterConfig {
  const secret = (name: string): string => {
    const path = env[`${name}_FILE`];
    if (!path) throw new Error(`${name}_FILE is not set`);
    const value = readSecret(path).trim();
    if (value === '') throw new Error(`${name}_FILE is empty`);
    return value;
  };
  const pepper = secret('REGISTER_PEPPER');
  if (pepper.length < 32) throw new Error('REGISTER_PEPPER must be at least 32 characters');
  const sessionKey = secret('REGISTER_SESSION_KEY');
  if (sessionKey.length < 32)
    throw new Error('REGISTER_SESSION_KEY must be at least 32 characters');
  const publicUrl = (env.REGISTER_PUBLIC_URL ?? '').replace(/\/+$/, '');
  if (!publicUrl.startsWith('https://')) throw new Error('REGISTER_PUBLIC_URL must be https');
  const mcpPublicUrl = (env.REGISTER_MCP_PUBLIC_URL ?? '').replace(/\/+$/, '');
  if (mcpPublicUrl !== '' && !mcpPublicUrl.startsWith('https://'))
    throw new Error('REGISTER_MCP_PUBLIC_URL must be https');
  const nats = natsOf(env, readSecret);
  return {
    nats: nats.nats,
    natsPasswordUnreadable: nats.passwordUnreadable,
    killSwitch:
      env.REGISTER_KILL_SWITCH !== 'false' || !termsApproved(TERMS_VERSION, approvedTerms),
    publicUrl,
    mcpPublicUrl,
    host: env.REGISTER_HOST ?? '127.0.0.1',
    port: intOf(env.REGISTER_PORT, 8090, 'REGISTER_PORT'),
    microsoft: {
      clientId: env.REGISTER_MS_CLIENT_ID ?? '',
      clientSecret: secret('REGISTER_MS_CLIENT_SECRET'),
    },
    sessionKey: sessionKey,
    pepper,
    tokenPepper: tokenPepper(env, readSecret),
    shard: required(env.REGISTER_SHARD, 'REGISTER_SHARD'),
    harnesses: (env.REGISTER_HARNESSES ?? 'claude-code')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[a-z][a-z0-9-]{0,31}$/.test(s)),
    requireMcOwnership: env.REGISTER_REQUIRE_MC_OWNERSHIP === 'true',
    signInPerMinute: intOf(env.REGISTER_SIGNIN_PER_MINUTE, 10, 'REGISTER_SIGNIN_PER_MINUTE'),
    ownerPerMinute: intOf(env.REGISTER_OWNER_PER_MINUTE, 6, 'REGISTER_OWNER_PER_MINUTE'),
    trustedPeers: trustedPeerList(env.REGISTER_TRUSTED_PEERS ?? '127.0.0.1'),
    perMinute: intOf(env.REGISTER_PER_MINUTE, 30, 'REGISTER_PER_MINUTE'),
  };
}
