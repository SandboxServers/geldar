// The capture's preflight (CAP-3): makes sure the two identity buckets exist before any bot joins. The Velocity plugin
// only reads them and never creates them (decision 0087 correction). On a fresh NATS volume nothing creates them until
// Golem starts, and velocity stays unhealthy until it writes /tmp/geldar-identity.ready. The creation is the scratch
// seed's own (golem/src/seed-buckets.ts, imported here, not copied), so the configs match golem's; an existing bucket
// is left alone.
import { connectNats } from '@geldar/contract/nats';
import { jetstream } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { SKINS_BUCKET } from '../../../src/ensure-skins-bucket.ts';
import { golemNatsAuth } from '../../../src/nats-credentials.ts';
import { REGISTRY_BUCKET } from '../../../src/registry.ts';
import { type SeedKvm, seedIdentityBuckets } from '../../../src/seed-buckets.ts';

/** The buckets the identity plugin reads, in the order the seed creates them. */
export const IDENTITY_BUCKETS: readonly string[] = [REGISTRY_BUCKET, SKINS_BUCKET];

/** The operator hint added to a seed failure: the registry.ts text (golem/src/registry.ts:105-107), same command. */
export const REGISTRY_TTL_HINT =
  'if the life registry was created before its TTL existed, remove it once (nats stream rm KV_geldar-life-registry) and run again';

/** A stream that exists with another config: the case the registry hint names. Any other error gets no hint. */
const CONFIG_MISMATCH = /already in use|different configuration|already exists/i;

/** The decision for one preflight: the buckets to create, and the line to log before creating them. */
export interface BucketPreflight {
  missing: string[];
  message: string;
}

/** The slice of the KV manager the preflight uses: `open` tells a present bucket from an absent one. */
export type PreflightKvm = SeedKvm & { open(name: string): Promise<unknown> };

/** Creates the missing buckets with the given seed function, or returns the names it created. */
export type SeedFn = (kvm: SeedKvm) => Promise<string[]>;

/** The text of an error, or of anything thrown that is not an Error. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Pure: the message a failed seed throws. It always carries the raw cause. The registry hint is added only when the
 * life registry is among the missing buckets and the cause is a config mismatch (mirrors registry.ts:102-109).
 */
export function seedFailureMessage(missing: readonly string[], why: string): string {
  const head = `identity buckets: could not create ${missing.join(', ')} (${why})`;
  const hint = missing.includes(REGISTRY_BUCKET) && CONFIG_MISMATCH.test(why);
  return hint ? `${head}; ${REGISTRY_TTL_HINT}` : head;
}

/** Pure: given whether each bucket already opens, names the missing ones and the log line. */
export function planBucketPreflight(
  presence: readonly (readonly [string, boolean])[],
): BucketPreflight {
  const missing = presence.filter(([, open]) => !open).map(([name]) => name);
  const present = presence.filter(([, open]) => open).map(([name]) => name);
  if (missing.length === 0) {
    return { missing, message: `identity buckets ${present.join(', ')} already present: skipped` };
  }
  const found = present.length > 0 ? ` (already present: ${present.join(', ')})` : '';
  return { missing, message: `identity buckets: creating ${missing.join(', ')}${found}` };
}

/** True when the bucket opens; an absent bucket and an unreachable server both read as false (the seed then reports the real error). */
async function bucketOpens(kvm: PreflightKvm, name: string): Promise<boolean> {
  return kvm.open(name).then(
    () => true,
    () => false,
  );
}

/**
 * Checks the two buckets on an open KV manager, logs the plan, and runs the seed only when one is missing. A seed
 * failure throws seedFailureMessage (the raw error stays on `cause`). Returns the names that were missing.
 */
export async function preflightBuckets(
  kvm: PreflightKvm,
  log: (line: string) => void,
  seed: SeedFn,
): Promise<string[]> {
  const presence: [string, boolean][] = [];
  for (const name of IDENTITY_BUCKETS) presence.push([name, await bucketOpens(kvm, name)]);
  const plan = planBucketPreflight(presence);
  log(plan.message);
  if (plan.missing.length === 0) return plan.missing;
  try {
    await seed(kvm);
  } catch (error) {
    throw new Error(seedFailureMessage(plan.missing, errorText(error)), { cause: error });
  }
  log(`identity buckets created: ${plan.missing.join(', ')}`);
  return plan.missing;
}

/** Connects to NATS, runs the preflight with the seed (golem's seedIdentityBuckets by default), and closes the connection. */
export async function ensureIdentityBuckets(
  natsUrl: string,
  log: (line: string) => void,
  seed: SeedFn = seedIdentityBuckets,
): Promise<string[]> {
  const nc = await connectNats({
    servers: natsUrl,
    name: 'provenance-capture-buckets',
    ...golemNatsAuth(),
  }).catch((error: unknown) => {
    throw new Error(`identity buckets: could not connect to NATS (${errorText(error)})`, {
      cause: error,
    });
  });
  try {
    return await preflightBuckets(new Kvm(jetstream(nc)) as PreflightKvm, log, seed);
  } finally {
    await nc.close().catch(() => undefined);
  }
}
