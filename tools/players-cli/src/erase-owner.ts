// Operator erasure of what an account deletion cannot reach: the geldar-skins KV key of each life (the PNG data)
// and the geldar-life-registry key of each life's username (the Velocity admission entry). Runbook:
// docs/runbooks/account-deletion.md, step 5. It is an operator tool run by hand, never by a web route.
//
// Dry run by default. A change needs --execute AND --confirm <owner id>, the owner id exactly. The buckets are
// opened, never created. Keys are purged (every revision, not a delete marker), so the data is gone from the stream.
// Output is counts only: no owner id, life id, username, key value or signature is printed.
//
// The lives list must be captured BEFORE register_account_delete runs: the deletion removes the owner's players and
// lives from Postgres, so this script cannot find them afterwards. The file is JSON: [{"lifeId": "...", "username": "..."}].
import { readFileSync } from 'node:fs';
import { connectNats } from '@geldar/contract/nats';
import { jetstream } from '@nats-io/jetstream';
import { type KV, Kvm } from '@nats-io/kv';

export const SKIN_BUCKET_NAME = 'geldar-skins';
export const REGISTRY_BUCKET_NAME = 'geldar-life-registry';
const CONNECT_TIMEOUT_MS = 5_000;
const LIFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const USERNAME = /^[a-z0-9_]{1,16}$/;
const OWNER_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface ErasureLife {
  lifeId: string;
  username: string;
}

/** The slice of one KV bucket the erasure uses. A missing key reads as null; a purge removes every revision. */
export interface KvPort {
  get(key: string): Promise<{ value: Uint8Array } | null>;
  purge(key: string): Promise<void>;
}

export interface ErasureKvs {
  skins: KvPort;
  registry: KvPort;
}

export interface ErasureRequest {
  ownerId: string;
  lives: ErasureLife[];
  execute: boolean;
  confirm: string | undefined;
}

export interface BucketCount {
  found: number;
  purged: number;
}

export interface ErasureOutcome {
  status: 'dry-run' | 'purged' | 'refused' | 'failed';
  reason?: string;
  skins: BucketCount;
  registry: BucketCount;
  lines: string[];
}

/** The registry key of a username: lowercase, as LifeRegistry.key does. Throws on a name the registry cannot hold. */
function registryKey(username: string): string {
  const key = username.toLowerCase();
  if (!USERNAME.test(key)) throw new Error('a username is not a valid registry key');
  return key;
}

/** Why a request must not run, or undefined when it may. Checked before any read. */
export function refusalFor(req: ErasureRequest): string | undefined {
  if (!OWNER_ID.test(req.ownerId)) return 'the owner id is missing or malformed';
  if (req.lives.length === 0) return 'the lives list is empty';
  if (
    req.lives.some(
      (life) => !LIFE_ID.test(life.lifeId) || !USERNAME.test(life.username.toLowerCase()),
    )
  ) {
    return 'a life in the list is malformed';
  }
  if (req.execute && req.confirm !== req.ownerId) {
    return '--execute needs --confirm with the owner id, exactly; nothing was changed';
  }
  return undefined;
}

/** Reads the --owner, --lives, --execute and --confirm flags. An unknown flag or a missing value throws. */
export function parseArgs(argv: string[]): {
  ownerId: string;
  livesPath: string;
  execute: boolean;
  confirm: string | undefined;
} {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i] ?? '';
    if (name === '--execute') {
      flags.set(name, true);
    } else if (name === '--owner' || name === '--lives' || name === '--confirm') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
      flags.set(name, value);
      i += 1;
    } else {
      throw new Error(`unknown argument: ${name}`);
    }
  }
  const ownerId = flags.get('--owner');
  const livesPath = flags.get('--lives');
  if (typeof ownerId !== 'string' || typeof livesPath !== 'string') {
    throw new Error(
      'usage: --owner <owner id> --lives <lives.json> [--execute --confirm <owner id>]',
    );
  }
  const confirm = flags.get('--confirm');
  return {
    ownerId,
    livesPath,
    execute: flags.get('--execute') === true,
    confirm: typeof confirm === 'string' ? confirm : undefined,
  };
}

/** Parses the lives file. Any bad entry fails the whole file, so nothing is erased from a partly read list. */
export function parseLivesFile(text: string): ErasureLife[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data) || data.length === 0)
    throw new Error('the lives file must be a non-empty JSON array');
  return data.map((entry: unknown) => {
    const record = entry as { lifeId?: unknown; username?: unknown } | null;
    if (typeof record?.lifeId !== 'string' || typeof record.username !== 'string') {
      throw new Error('each life needs a lifeId and a username');
    }
    const username = record.username.toLowerCase();
    if (!LIFE_ID.test(record.lifeId) || !USERNAME.test(username)) {
      throw new Error('a life has a malformed lifeId or username');
    }
    return { lifeId: record.lifeId, username };
  });
}

/** Reads each key once; returns the keys that exist. */
async function presentKeys(port: KvPort, keys: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const key of keys) {
    if ((await port.get(key)) !== null) found.push(key);
  }
  return found;
}

const FAILED_READ = 'could not read a bucket; nothing was changed';
const FAILED_PURGE = 'a purge failed; run again to finish';

/**
 * Plans and, with execute and a matching confirm, runs the erasure. Reads first; purges only keys that exist.
 * A second run finds nothing and purges nothing. Stops at the first purge error and reports it.
 */
export async function runErasure(req: ErasureRequest, kvs: ErasureKvs): Promise<ErasureOutcome> {
  const empty = { skins: { found: 0, purged: 0 }, registry: { found: 0, purged: 0 } };
  const refusal = refusalFor(req);
  if (refusal !== undefined) {
    return { status: 'refused', reason: refusal, ...empty, lines: [`refused: ${refusal}`] };
  }
  const skinKeys = [...new Set(req.lives.map((life) => life.lifeId))];
  const registryKeys = [...new Set(req.lives.map((life) => registryKey(life.username)))];
  let skinFound: string[];
  let registryFound: string[];
  try {
    skinFound = await presentKeys(kvs.skins, skinKeys);
    registryFound = await presentKeys(kvs.registry, registryKeys);
  } catch {
    return { status: 'failed', reason: FAILED_READ, ...empty, lines: [FAILED_READ] };
  }
  const counts = {
    skins: { found: skinFound.length, purged: 0 },
    registry: { found: registryFound.length, purged: 0 },
  };
  const summary = (status: ErasureOutcome['status'], reason?: string): ErasureOutcome => {
    const lines = [
      `${SKIN_BUCKET_NAME}: ${counts.skins.found} of ${skinKeys.length} keys present, ${counts.skins.purged} purged`,
      `${REGISTRY_BUCKET_NAME}: ${counts.registry.found} of ${registryKeys.length} keys present, ${counts.registry.purged} purged`,
    ];
    if (reason !== undefined) lines.push(reason);
    return reason === undefined
      ? { status, ...counts, lines }
      : { status, reason, ...counts, lines };
  };
  if (!req.execute) {
    return summary(
      'dry-run',
      'dry run: nothing was changed; pass --execute and --confirm <owner id> to purge',
    );
  }
  try {
    for (const key of skinFound) {
      await kvs.skins.purge(key);
      counts.skins.purged += 1;
    }
    for (const key of registryFound) {
      await kvs.registry.purge(key);
      counts.registry.purged += 1;
    }
  } catch {
    return summary('failed', FAILED_PURGE);
  }
  return summary('purged');
}

/** Opens NATS and both buckets with open(), never create(). Throws fixed messages; no URL or credential is echoed. */
export async function openErasureKvs(
  natsUrl: string,
): Promise<{ kvs: ErasureKvs; close: () => Promise<void> }> {
  let nc: Awaited<ReturnType<typeof connectNats>>;
  try {
    nc = await connectNats({ servers: natsUrl, name: 'players-cli', timeout: CONNECT_TIMEOUT_MS });
  } catch {
    throw new Error('NATS could not be reached at GELDAR_NATS_URL');
  }
  try {
    const kvm = new Kvm(jetstream(nc));
    const skins = await kvm.open(SKIN_BUCKET_NAME);
    const registry = await kvm.open(REGISTRY_BUCKET_NAME);
    return {
      kvs: { skins: asPort(skins), registry: asPort(registry) },
      close: () => nc.close().then(() => undefined),
    };
  } catch {
    await nc.close().catch(() => undefined);
    throw new Error('a bucket could not be opened; this script does not create buckets');
  }
}

function asPort(kv: KV): KvPort {
  return {
    async get(key) {
      return (await kv.get(key)) ?? null;
    },
    async purge(key) {
      await kv.purge(key);
    },
  };
}

async function main(argv: string[]): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  let lives: ErasureLife[];
  try {
    args = parseArgs(argv);
    lives = parseLivesFile(readFileSync(args.livesPath, 'utf8'));
  } catch (error: unknown) {
    console.error(
      `erase-owner: ${error instanceof Error ? error.message : 'could not read the arguments'}`,
    );
    return 2;
  }
  const request: ErasureRequest = {
    ownerId: args.ownerId,
    lives,
    execute: args.execute,
    confirm: args.confirm,
  };
  const refusal = refusalFor(request);
  if (refusal !== undefined) {
    console.error(`erase-owner: refused: ${refusal}`);
    return 2;
  }
  const url = process.env.GELDAR_NATS_URL;
  if (!url) {
    console.error('erase-owner: GELDAR_NATS_URL is not set');
    return 2;
  }
  let opened: Awaited<ReturnType<typeof openErasureKvs>>;
  try {
    opened = await openErasureKvs(url);
  } catch (error: unknown) {
    console.error(
      `erase-owner: ${error instanceof Error ? error.message : 'could not open the buckets'}`,
    );
    return 1;
  }
  try {
    const outcome = await runErasure(request, opened.kvs);
    for (const line of outcome.lines) console.log(line);
    return outcome.status === 'failed' || outcome.status === 'refused' ? 1 : 0;
  } finally {
    await opened.close().catch(() => undefined);
  }
}

if (process.argv[1]?.endsWith('erase-owner.ts')) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      console.error('erase-owner: unexpected failure');
      process.exitCode = 1;
    },
  );
}
