import type { WorldEvent } from '@geldar/contract';
import { DEFAULT_THRESHOLDS } from '@geldar/psyche';
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
    expect(calls[0]?.params).toHaveLength(11);
    expect(calls[0]?.params[0]).toEqual([EVENT.source_event_id, 'ev_2']);
    expect(calls[0]?.params[5]).toEqual(['ag_kestrel_01', 'ag_kestrel_01']);
    expect(calls[0]?.params[6]).toEqual([null, null]);
    expect(calls[0]?.params[7]).toEqual(['{"bed":[1,2,3]}', '{"bed":[1,2,3]}']);
    expect(calls[0]?.params[8]).toEqual([null, null]);
    expect(calls[0]?.params[9]).toEqual([null, null]);
    expect(calls[0]?.params[10]).toEqual([null, null]);
  });

  it('binds trace_id per event, null when the batch carries none', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const pool = {
      query: async (sql: string, params: unknown[]) => void calls.push({ sql, params }),
    } as unknown as Pool;
    const traced = '4bf92f3577b34da6a3ce929d0e0e4736';
    await pgEventWriter(pool).insertBatch(
      [EVENT, { ...EVENT, source_event_id: 'ev_2' }],
      [traced, null],
    );
    expect(calls[0]?.sql).toContain('trace_id');
    expect(calls[0]?.params[10]).toEqual([traced, null]);
    expect(calls[0]?.params[8]).toEqual([null, null]);
    expect(calls[0]?.params[9]).toEqual([null, null]);
  });

  it('binds trace ids on the transaction path too', async () => {
    const texts: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        texts.push({ sql, params: params ?? [] });
        if (/FROM agents/.test(sql)) return { rows: [{ '?column?': 1 }] };
        if (/INSERT INTO xp_evidence/.test(sql)) return { rows: [{ '?column?': 1 }] };
        if (/INSERT INTO proficiency /.test(sql)) return { rows: [{ xp: 1 }] };
        if (/SUM\(xp\)/.test(sql)) return { rows: [{ total: 1 }] };
        return { rows: [] };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client } as unknown as Pool;
    const reflex: WorldEvent = { ...EVENT, type: 'reflex_fired', payload: { name: 'eat' } };
    const traced = '4bf92f3577b34da6a3ce929d0e0e4736';
    const xp = { enabled: true, thresholds: DEFAULT_THRESHOLDS };
    await pgEventWriter(pool, xp).insertBatch(
      [reflex, { ...reflex, source_event_id: 'ev_reflex_2' }],
      [traced, null],
    );
    const insert = texts.find((t) => t.sql.includes('INSERT INTO events'));
    expect(insert?.params[10]).toEqual([traced, null]);
  });

  it('binds harness and model per event, null when the envelope has none', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const pool = {
      query: async (sql: string, params: unknown[]) => void calls.push({ sql, params }),
    } as unknown as Pool;
    const stamped: WorldEvent = { ...EVENT, harness: 'claude', model: 'claude-sonnet-5.5' };
    await pgEventWriter(pool).insertBatch([stamped, EVENT]);
    expect(calls[0]?.sql).toContain('harness, model');
    expect(calls[0]?.params[8]).toEqual(['claude', null]);
    expect(calls[0]?.params[9]).toEqual(['claude-sonnet-5.5', null]);
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
