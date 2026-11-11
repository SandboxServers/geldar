import { describe, expect, it } from 'vitest';
import { assertConnectedToThrowaway, assertThrowawayDatabase } from './throwaway-db.ts';

describe('assertThrowawayDatabase', () => {
  it('refuses the dev database, the config default and an empty name', () => {
    expect(() => assertThrowawayDatabase('geldar')).toThrow(/throwaway database only/);
    expect(() => assertThrowawayDatabase('ops_dev', 'ops_dev')).toThrow(/throwaway database only/);
    // With another config default, the dev database name is still refused on its own.
    expect(() => assertThrowawayDatabase('geldar', 'ops_dev')).toThrow(/throwaway database only/);
    expect(() => assertThrowawayDatabase('')).toThrow(/throwaway database only/);
  });

  it('allows a throwaway database name', () => {
    expect(() => assertThrowawayDatabase('geldar_c105a_x7k2')).not.toThrow();
  });

  it('checks the database the pool is connected to', async () => {
    const pool = (db: string) => ({ query: async () => ({ rows: [{ db }] }) });
    await expect(assertConnectedToThrowaway(pool('geldar'))).rejects.toThrow(/throwaway/);
    await expect(assertConnectedToThrowaway(pool('geldar_c105a_x7k2'))).resolves.toBeUndefined();
  });
});
