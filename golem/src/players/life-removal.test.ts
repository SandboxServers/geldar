import { describe, expect, it } from 'vitest';
import type { GolemConfig } from '../config.ts';
import { type RemovalSteps, removeLifeFromShard } from './life-removal.ts';

const LIFE = 'ag_kestrel_01';

/** Fake steps that record their calls; each side effect can be made to fail. */
function fakeSteps(fail: { key?: boolean; whitelist?: boolean } = {}) {
  const calls: string[] = [];
  const steps: RemovalSteps = {
    async deleteKey(natsUrl, lifeId) {
      calls.push(`key ${natsUrl} ${lifeId}`);
      if (fail.key) throw new Error('NATS is unreachable');
    },
    async removeWhitelist(cfg: GolemConfig, lifeId) {
      calls.push(`whitelist ${cfg.rconPort} ${lifeId}`);
      if (fail.whitelist) throw new Error('RCON authentication failed');
    },
  };
  return { steps, calls };
}

describe('removeLifeFromShard', () => {
  it('deletes the registry key and removes the whitelist entry, with the stack defaults', async () => {
    const { steps, calls } = fakeSteps();
    const lines = await removeLifeFromShard(LIFE, {}, steps);
    expect(calls).toEqual([`key nats://127.0.0.1:4222 ${LIFE}`, `whitelist 25575 ${LIFE}`]);
    expect(lines).toEqual([`registry key ${LIFE}: deleted`, `whitelist ${LIFE}: removed`]);
  });

  it('skips the key when NATS is off, and still removes the whitelist entry', async () => {
    const { steps, calls } = fakeSteps();
    const lines = await removeLifeFromShard(LIFE, { GELDAR_NATS_URL: '' }, steps);
    expect(calls).toEqual([`whitelist 25575 ${LIFE}`]);
    expect(lines[0]).toContain('NATS is off');
    expect(lines[0]).toContain(`nats kv del geldar-life-registry ${LIFE}`);
    expect(lines[1]).toBe(`whitelist ${LIFE}: removed`);
  });

  it('reports a failed key delete with the manual command and still tries the whitelist', async () => {
    const { steps, calls } = fakeSteps({ key: true });
    const lines = await removeLifeFromShard(LIFE, {}, steps);
    expect(calls).toHaveLength(2);
    expect(lines[0]).toBe(
      `registry key ${LIFE}: not deleted (NATS is unreachable); run: nats kv del geldar-life-registry ${LIFE}`,
    );
    expect(lines[1]).toBe(`whitelist ${LIFE}: removed`);
  });

  it('reports a failed whitelist removal with the manual command and does not throw', async () => {
    const { steps } = fakeSteps({ whitelist: true });
    const lines = await removeLifeFromShard(LIFE, {}, steps);
    expect(lines[1]).toContain(`whitelist ${LIFE}: not removed (RCON authentication failed)`);
    expect(lines[1]).toContain(`whitelist remove ${LIFE}`);
    expect(lines[0]).toBe(`registry key ${LIFE}: deleted`);
  });

  it('names both manual commands and runs no step when the shard settings are unreadable', async () => {
    const { steps, calls } = fakeSteps();
    const lines = await removeLifeFromShard(LIFE, { GELDAR_MC_HOST: '10.0.0.5' }, steps);
    expect(calls).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('shard settings unreadable');
    expect(lines[0]).toContain(`nats kv del geldar-life-registry ${LIFE}`);
    expect(lines[0]).toContain(`whitelist remove ${LIFE}`);
  });
});
