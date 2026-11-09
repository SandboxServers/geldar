import type { WorldEvent } from '@geldar/contract';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { loadConfig, STREAM_CONFIG } from './config.ts';
import { pgEventWriter } from './writer.ts';

const EVENT: WorldEvent = {
  source_event_id: 'ev_01HZZZZZZZZZZZZZZZZZZZZZZZ',
  at: '2026-11-09T12:00:00Z',
  shard: 'phase0',
  world_day: 3,
  world_tick: 72_000,
  type: 'sleep',
  agent_id: 'ag_kestrel_01',
  payload: { bed: [1, 2, 3] },
};

describe('pgEventWriter', () => {
  it('issues one idempotent INSERT with one array per column', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const pool = {
      query: async (sql: string, params: unknown[]) => void calls.push({ sql, params }),
    } as unknown as Pool;
    await pgEventWriter(pool).insertBatch([EVENT, { ...EVENT, source_event_id: 'ev_2' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('ON CONFLICT (source_event_id) DO NOTHING');
    expect(calls[0]?.params).toHaveLength(8);
    expect(calls[0]?.params[0]).toEqual([EVENT.source_event_id, 'ev_2']);
    expect(calls[0]?.params[5]).toEqual(['ag_kestrel_01', 'ag_kestrel_01']);
    expect(calls[0]?.params[6]).toEqual([null, null]);
    expect(calls[0]?.params[7]).toEqual(['{"bed":[1,2,3]}', '{"bed":[1,2,3]}']);
  });

  it('does not touch the database for an empty batch', async () => {
    const pool = {
      query: async () => {
        throw new Error('should not be called');
      },
    } as unknown as Pool;
    await expect(pgEventWriter(pool).insertBatch([])).resolves.toBeUndefined();
  });
});

describe('config', () => {
  it('reads the password from the secret file, never from the environment', () => {
    const config = loadConfig({ POSTGRES_PASSWORD_FILE: '/run/secrets/postgres' }, () => 'pw\n');
    expect(config.pg.password).toBe('pw');
    expect(config.batchSize).toBe(50);
  });

  it('refuses to start without a password file', () => {
    expect(() => loadConfig({}, () => '')).toThrow('POSTGRES_PASSWORD_FILE');
  });

  it('keeps the stream definition in one place', () => {
    expect(STREAM_CONFIG).toMatchObject({
      name: 'GELDAR_EVENTS',
      subjects: ['geldar.*.*'],
      storage: 'file',
      retentionDays: 30,
    });
  });
});
