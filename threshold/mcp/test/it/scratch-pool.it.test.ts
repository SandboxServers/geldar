/**
 * Regression for the CI integration flake (FIX-IT-FLAKE): a scratch database dropped with FORCE
 * ends every open backend with 57P01. A pooled client that is idle at that moment must not raise
 * an uncaught 'error' on its pool. Skipped unless GELDAR_IT=1 (integrationEnabled).
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationEnabled } from '../live/gate.ts';
import {
  adminConfig,
  createScratchDatabase,
  dropScratchDatabase,
  scratchPool,
} from './scratch-db.ts';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!integrationEnabled())(
  'scratch pools survive a backend ended by the server',
  () => {
    let db = '';

    beforeAll(async () => {
      db = await createScratchDatabase();
    });

    afterAll(async () => {
      await dropScratchDatabase(db);
    });

    it('a scratch pool listens for its idle-client errors', async () => {
      const pool = scratchPool(db);
      try {
        expect(pool.listenerCount('error')).toBeGreaterThan(0);
      } finally {
        await pool.end();
      }
    });

    it('an idle pooled client ended by the server raises no error and the pool stays usable', async () => {
      const pool = scratchPool(db);
      try {
        await pool.query('SELECT 1');
        expect(pool.idleCount).toBe(1);

        const admin = new Pool({ ...adminConfig('postgres'), max: 1 });
        try {
          const { rows } = await admin.query<{ ok: boolean }>(
            'SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
            [db],
          );
          expect(rows).toHaveLength(1);
          expect(rows[0]?.ok).toBe(true);
        } finally {
          await admin.end();
        }

        // The pool's error event arrives on the socket after the FATAL packet. Wait for it: an
        // unhandled error here fails the file.
        await sleep(300);
        const { rows } = await pool.query<{ one: number }>('SELECT 1 AS one');
        expect(rows[0]?.one).toBe(1);
      } finally {
        await pool.end();
      }
    });
  },
);
