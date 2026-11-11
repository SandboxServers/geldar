// Creates the geldar-skins KV bucket when it is missing (C2-07j). The Velocity plugin is read-only on the bucket (decision
// 0087 correction), so it cannot create it; the admin container runs this once per deploy as the body NATS user, which
// holds the JetStream API permission, the same account that creates geldar-life-registry. The bucket config is the one
// tools/players-cli/src/skin-store.ts uses (`Kvm.create` with defaults), so a later `skin set` finds the same stream.
import { connectNats } from '@geldar/contract/nats';
import { jetstream } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { golemNatsAuth } from './nats-credentials.ts';

export const SKINS_BUCKET = 'geldar-skins';

/** The slice of the KV manager this needs, so the test can fake it. */
export interface BucketCreator {
  create(name: string): Promise<unknown>;
}

/** Creates the bucket (a no-op when it exists with the same config) and returns its name. */
export async function ensureSkinsBucket(kvm: BucketCreator): Promise<string> {
  await kvm.create(SKINS_BUCKET);
  return SKINS_BUCKET;
}

async function main(): Promise<void> {
  const url = process.env.GELDAR_NATS_URL;
  if (!url) throw new Error('GELDAR_NATS_URL is not set');
  const nc = await connectNats({ servers: url, name: 'ensure-skins-bucket', ...golemNatsAuth() });
  try {
    const name = await ensureSkinsBucket(new Kvm(jetstream(nc)));
    console.log(`bucket ${name}: present`);
  } finally {
    await nc.close().catch(() => undefined);
  }
}

if (process.argv[1]?.endsWith('ensure-skins-bucket.ts')) {
  main().catch((error: unknown) => {
    console.error(`ensure-skins-bucket: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
