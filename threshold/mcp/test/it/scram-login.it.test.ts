/**
 * WM-02 integration: a password set by the migration runner logs in over SCRAM-SHA-256. Skipped
 * unless GELDAR_IT=1 (integrationEnabled). The case makes a throwaway role with a random password,
 * never geldar_mcp, and drops it afterwards, even on failure.
 */
import { randomBytes } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { passwordStatement } from '../../../../tools/migrate/src/migrate.ts';
import { scramVerifier } from '../../../../tools/migrate/src/scram.ts';
import { integrationEnabled } from '../live/gate.ts';
import { adminConfig, freshSuffix } from './scratch-db.ts';

describe.skipIf(!integrationEnabled())('a runner-set password against a real Postgres', () => {
  const role = `geldar_it_scram_${freshSuffix()}`;
  const password = randomBytes(18).toString('base64url');

  /** Connects as `user` over TCP with the given password; the caller ends the client. */
  function connectAs(user: string, secret: string): Client {
    return new Client({ ...adminConfig('postgres'), user, password: secret });
  }

  afterAll(async () => {
    const admin = new Pool({ ...adminConfig('postgres'), max: 1 });
    try {
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
    } finally {
      await admin.end();
    }
  });

  it('logs in with the password and refuses a wrong one', async () => {
    const admin = new Pool({ ...adminConfig('postgres'), max: 1 });
    try {
      const client = await admin.connect();
      try {
        await client.query(`CREATE ROLE ${role}`);
        const verifier = scramVerifier(password);
        const sql = passwordStatement(role, verifier, (value) => client.escapeLiteral(value));
        await client.query(sql);
      } finally {
        client.release();
      }
    } finally {
      await admin.end();
    }

    const good = connectAs(role, password);
    try {
      await good.connect();
      const result = await good.query<{ who: string }>('SELECT current_user AS who');
      expect(result.rows[0]?.who).toBe(role);
    } finally {
      await good.end().catch(() => undefined);
    }

    const bad = connectAs(role, `${password}x`);
    await expect(bad.connect()).rejects.toThrow();
    await bad.end().catch(() => undefined);
  });
});
