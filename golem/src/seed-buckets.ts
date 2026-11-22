// Creates the two identity buckets the Velocity plugin only reads, before velocity starts (scratch stack, the
// `identity-seed` service of compose/opt-in/scratch.yml). It runs as the scratch-only `seed` NATS user, never as body,
// and that user may create only the two identity streams. The building buckets (geldar-plans, geldar-seen) are not
// created here: the body creates them itself at each start with body_actions.building on (BLD-fix4a).
// The bucket configs are golem's own: createRegistryBucket (the life registry, with REGISTRY_TTL_MS) and
// ensureSkinsBucket (defaults), so a later golem or players-cli run finds the same streams.
import { connectNats } from '@geldar/contract/nats';
import { jetstream } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { PLAN_BUCKET, SEEN_BUCKET } from './building/names.ts';
import { type BucketCreator, ensureSkinsBucket, SKINS_BUCKET } from './ensure-skins-bucket.ts';
import { golemNatsAuth } from './nats-credentials.ts';
import { createRegistryBucket, REGISTRY_BUCKET } from './registry.ts';

/** The slice of the KV manager the seed uses, so the test can fake it. */
export type SeedKvm = BucketCreator & {
  create(name: string, opts?: { ttl: number }): Promise<unknown>;
};

/** Creates the life registry, then the skins bucket; stops at the first failure. Returns the two names. */
export async function seedIdentityBuckets(kvm: SeedKvm): Promise<string[]> {
  await createRegistryBucket(kvm);
  await ensureSkinsBucket(kvm);
  return [REGISTRY_BUCKET, SKINS_BUCKET];
}

/**
 * Creates the two building buckets (review fix 6) with the same plain create the Body uses at each
 * start, so the settings match and a later Body start finds them. Stops at the first failure. Not
 * part of `main`: the seed user cannot create these streams, so this is for an explicit use only.
 */
export async function seedBuildingBuckets(kvm: SeedKvm): Promise<string[]> {
  await kvm.create(PLAN_BUCKET);
  await kvm.create(SEEN_BUCKET);
  return [PLAN_BUCKET, SEEN_BUCKET];
}

/** The seed one-shot: creates the identity buckets only, and logs their names. */
export async function main(): Promise<void> {
  const url = process.env.GELDAR_NATS_URL;
  if (!url) throw new Error('GELDAR_NATS_URL is not set');
  const nc = await connectNats({ servers: url, name: 'seed-identity-buckets', ...golemNatsAuth() });
  try {
    const names = await seedIdentityBuckets(new Kvm(jetstream(nc)));
    console.log(`buckets ${names.join(', ')}: present`);
  } finally {
    await nc.close().catch(() => undefined);
  }
}

if (process.argv[1]?.endsWith('seed-buckets.ts')) {
  main().catch((error: unknown) => {
    console.error(`seed-buckets: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
