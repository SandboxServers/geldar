import { jetstream } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { connect } from '@nats-io/transport-node';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import {
  LifeRegistration,
  lifeIdFor,
  openRegistryBucket,
  REGISTRY_BUCKET,
} from '../../src/registry.ts';

const NAME = 'GolemRegistryLive';

// Needs the Phase 0 stack (NATS on loopback). The registry is opt-in, so the URL defaults here.
const natsUrl = loadConfig().natsUrl ?? 'nats://127.0.0.1:4222';

describe('life registry (live NATS)', () => {
  it('creates the bucket, registers the username and deletes it again', async () => {
    const reg = new LifeRegistration(() => openRegistryBucket(natsUrl));
    const nc = await connect({ servers: natsUrl, name: 'golem-registry-live' });
    try {
      await reg.register(NAME);
      const kv = await new Kvm(jetstream(nc)).open(REGISTRY_BUCKET);
      const entry = await kv.get(NAME.toLowerCase());
      expect(entry?.operation).toBe('PUT');
      const lifeId = lifeIdFor(NAME);
      expect(lifeId).toMatch(/^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/);
      expect(JSON.parse(entry?.string() ?? '{}')).toMatchObject({ life_id: lifeId });
      await reg.unregister(NAME);
      const gone = await kv.get(NAME.toLowerCase());
      expect(gone === null || gone.operation !== 'PUT').toBe(true);
    } finally {
      await reg.close();
      await nc.close();
    }
  });
});
