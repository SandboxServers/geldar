// The capture's preflight (CAP-3): makes sure the two identity buckets exist before any bot joins. The Velocity plugin
// only reads them and never creates them (decision 0087 correction). On a fresh NATS volume nothing creates them until
// Golem starts, and velocity stays unhealthy until it watches the life registry. The creation is the scratch seed's own
// (golem/src/seed-buckets.ts, imported here, not copied), so the configs match golem's; an existing bucket is left alone.
import { connectNats } from '@geldar/contract/nats';
import { jetstream } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { SKINS_BUCKET } from '../../../src/ensure-skins-bucket.ts';
import { golemNatsAuth } from '../../../src/nats-credentials.ts';
import { REGISTRY_BUCKET } from '../../../src/registry.ts';
import { seedIdentityBuckets } from '../../../src/seed-buckets.ts';

/** The buckets the identity plugin reads, in the order the seed creates them. */
export const IDENTITY_BUCKETS: readonly string[] = [REGISTRY_BUCKET, SKINS_BUCKET];

/** The decision for one preflight: the buckets to create, and the line to log before creating them. */
export interface BucketPreflight {
  missing: string[];
  message: string;
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
async function bucketOpens(kvm: Kvm, name: string): Promise<boolean> {
  return kvm.open(name).then(
    () => true,
    () => false,
  );
}

/** Creates the identity buckets that are missing (the others are left alone) and returns the names it created. */
export async function ensureIdentityBuckets(
  natsUrl: string,
  log: (line: string) => void,
): Promise<string[]> {
  const nc = await connectNats({
    servers: natsUrl,
    name: 'provenance-capture-buckets',
    ...golemNatsAuth(),
  });
  try {
    const kvm = new Kvm(jetstream(nc));
    const presence: [string, boolean][] = [];
    for (const name of IDENTITY_BUCKETS) presence.push([name, await bucketOpens(kvm, name)]);
    const plan = planBucketPreflight(presence);
    log(plan.message);
    if (plan.missing.length > 0) {
      await seedIdentityBuckets(kvm);
      log(`identity buckets created: ${plan.missing.join(', ')}`);
    }
    return plan.missing;
  } finally {
    await nc.close().catch(() => undefined);
  }
}
