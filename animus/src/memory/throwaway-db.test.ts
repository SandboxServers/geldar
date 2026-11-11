import { describe, expect, it, vi } from 'vitest';
import { assertConnectedToThrowaway, assertThrowawayDatabase } from './throwaway-db.ts';

const REFUSED = /throwaway database only/;

/** Names that must never be truncated: the dev database, look-alikes, and non-scratch names. */
const NOT_THROWAWAY = [
  'geldar_colo',
  'Geldar',
  'geldar ',
  ' geldar',
  'postgres',
  'ops_dev',
  'geldar_c105a_x7k2',
  'geldar_it_',
  'geldar_it_9F3A',
  'geldar_it_9f3a ',
  'xgeldar_it_9f3a',
  '',
];

describe('assertThrowawayDatabase', () => {
  it('allows a scratch database name without the opt-in', () => {
    expect(() => assertThrowawayDatabase('geldar_it_9f3a0c1b2d4e', false)).not.toThrow();
  });

  it('refuses every other name without the opt-in', () => {
    for (const database of [...NOT_THROWAWAY, 'geldar']) {
      expect(() => assertThrowawayDatabase(database, false), database).toThrow(REFUSED);
    }
  });

  it('allows the shared CI database name only with the opt-in', () => {
    expect(() => assertThrowawayDatabase('geldar', true)).not.toThrow();
  });

  it('refuses every other name even with the opt-in', () => {
    for (const database of NOT_THROWAWAY) {
      expect(() => assertThrowawayDatabase(database, true), database).toThrow(REFUSED);
    }
  });

  it('refuses the shared name when the opt-in is set but the run is not on GitHub Actions', () => {
    try {
      vi.stubEnv('GELDAR_IT_ALLOW_SHARED_DB', '1');
      vi.stubEnv('GITHUB_ACTIONS', '');
      expect(() => assertThrowawayDatabase('geldar')).toThrow(REFUSED);
      vi.stubEnv('GITHUB_ACTIONS', 'false');
      expect(() => assertThrowawayDatabase('geldar')).toThrow(REFUSED);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses the shared name when the run is on GitHub Actions but the opt-in is not set', () => {
    try {
      vi.stubEnv('GELDAR_IT_ALLOW_SHARED_DB', '');
      vi.stubEnv('GITHUB_ACTIONS', 'true');
      expect(() => assertThrowawayDatabase('geldar')).toThrow(REFUSED);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('allows the shared name only with the opt-in and GITHUB_ACTIONS=true', () => {
    try {
      vi.stubEnv('GELDAR_IT_ALLOW_SHARED_DB', '1');
      vi.stubEnv('GITHUB_ACTIONS', 'true');
      expect(() => assertThrowawayDatabase('geldar')).not.toThrow();
      expect(() => assertThrowawayDatabase('geldar_colo')).toThrow(REFUSED);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('checks the database the pool is connected to', async () => {
    const pool = (db: string) => ({ query: async () => ({ rows: [{ db }] }) });
    await expect(assertConnectedToThrowaway(pool('geldar'), false)).rejects.toThrow(REFUSED);
    await expect(assertConnectedToThrowaway(pool('geldar'), true)).resolves.toBeUndefined();
    await expect(assertConnectedToThrowaway(pool('geldar_colo'), true)).rejects.toThrow(REFUSED);
    await expect(
      assertConnectedToThrowaway(pool('geldar_it_9f3a0c1b2d4e'), false),
    ).resolves.toBeUndefined();
  });
});
