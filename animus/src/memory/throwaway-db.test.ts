import { describe, expect, it, vi } from 'vitest';
import { assertConnectedToThrowaway, assertThrowawayDatabase } from './throwaway-db.ts';

const REFUSED = /throwaway database only/;

describe('assertThrowawayDatabase', () => {
  it('refuses the dev database, the config default and an empty name without the opt-in', () => {
    expect(() => assertThrowawayDatabase('geldar', 'geldar', false)).toThrow(REFUSED);
    expect(() => assertThrowawayDatabase('ops_dev', 'ops_dev', false)).toThrow(REFUSED);
    // With another config default, the dev database name is still refused on its own.
    expect(() => assertThrowawayDatabase('geldar', 'ops_dev', false)).toThrow(REFUSED);
    expect(() => assertThrowawayDatabase('', 'geldar', false)).toThrow(REFUSED);
  });

  it('allows the shared CI database name and the config default only with the opt-in', () => {
    expect(() => assertThrowawayDatabase('geldar', 'geldar', true)).not.toThrow();
    expect(() => assertThrowawayDatabase('ops_dev', 'ops_dev', true)).not.toThrow();
    expect(() => assertThrowawayDatabase('geldar', 'ops_dev', true)).not.toThrow();
  });

  it('refuses an empty name even with the opt-in', () => {
    expect(() => assertThrowawayDatabase('', 'geldar', true)).toThrow(REFUSED);
  });

  it('allows a throwaway database name', () => {
    expect(() => assertThrowawayDatabase('geldar_c105a_x7k2', 'geldar', false)).not.toThrow();
  });

  it('reads the opt-in from GELDAR_IT_ALLOW_SHARED_DB when no flag is passed', () => {
    try {
      vi.stubEnv('GELDAR_IT_ALLOW_SHARED_DB', '');
      expect(() => assertThrowawayDatabase('geldar')).toThrow(REFUSED);
      vi.stubEnv('GELDAR_IT_ALLOW_SHARED_DB', '1');
      expect(() => assertThrowawayDatabase('geldar')).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('checks the database the pool is connected to', async () => {
    const pool = (db: string) => ({ query: async () => ({ rows: [{ db }] }) });
    await expect(assertConnectedToThrowaway(pool('geldar'), false)).rejects.toThrow(/throwaway/);
    await expect(assertConnectedToThrowaway(pool('geldar'), true)).resolves.toBeUndefined();
    await expect(
      assertConnectedToThrowaway(pool('geldar_c105a_x7k2'), false),
    ).resolves.toBeUndefined();
  });
});
