import { describe, expect, it } from 'vitest';
import { loginProbeOn, type ProbeClient, probeDatabase, probeLogin } from './migrate.ts';

/** A fake pg Client whose connect() either succeeds or fails with the given error. */
function fakeClient(connectError?: unknown): {
  make: (config: {
    user: string;
    password: string;
    connectionTimeoutMillis: number;
  }) => ProbeClient;
  seen: { config?: { user: string; password: string; connectionTimeoutMillis: number } };
  ended: { count: number };
} {
  const seen: { config?: { user: string; password: string; connectionTimeoutMillis: number } } = {};
  const ended = { count: 0 };
  const make = (config: { user: string; password: string; connectionTimeoutMillis: number }) => {
    seen.config = config;
    return {
      connect: async () => {
        if (connectError !== undefined) throw connectError;
      },
      end: async () => {
        ended.count += 1;
      },
    };
  };
  return { make, seen, ended };
}

function pgError(message: string, code?: string): Error {
  return Object.assign(new Error(message), code === undefined ? {} : { code });
}

describe('probeLogin', () => {
  it('returns true when the role logs in, and ends the client', async () => {
    const fake = fakeClient();
    const ok = await probeLogin(fake.make, 'geldar_helper', 'pw-from-file');
    expect(ok).toBe(true);
    expect(fake.ended.count).toBe(1);
  });

  it('connects as the role with the file password and a 5 s connection timeout', async () => {
    const fake = fakeClient();
    await probeLogin(fake.make, 'geldar_helper', 'pw-from-file');
    expect(fake.seen.config).toEqual({
      user: 'geldar_helper',
      password: 'pw-from-file',
      connectionTimeoutMillis: 5000,
    });
  });

  it('returns false for a wrong password (SQLSTATE 28P01), and ends the client', async () => {
    const fake = fakeClient(
      pgError('password authentication failed for user "geldar_helper"', '28P01'),
    );
    const ok = await probeLogin(fake.make, 'geldar_helper', 'wrong');
    expect(ok).toBe(false);
    expect(fake.ended.count).toBe(1);
  });

  it('returns false when pg_hba refuses the role (SQLSTATE 28000), and ends the client', async () => {
    const fake = fakeClient(pgError('no pg_hba.conf entry for host', '28000'));
    const ok = await probeLogin(fake.make, 'geldar_helper', 'pw');
    expect(ok).toBe(false);
    expect(fake.ended.count).toBe(1);
  });

  it('rethrows a refused connection (ECONNREFUSED), so no ALTER runs, and ends the client', async () => {
    const fake = fakeClient(pgError('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED'));
    await expect(probeLogin(fake.make, 'geldar_helper', 'pw')).rejects.toThrow('ECONNREFUSED');
    expect(fake.ended.count).toBe(1);
  });

  it('rethrows a connection timeout (no SQLSTATE), so no ALTER runs, and ends the client', async () => {
    const fake = fakeClient(pgError('Connection terminated due to connection timeout'));
    await expect(probeLogin(fake.make, 'geldar_helper', 'pw')).rejects.toThrow('timeout');
    expect(fake.ended.count).toBe(1);
  });

  it('rethrows any other SQLSTATE, such as an undefined database (3D000)', async () => {
    const fake = fakeClient(pgError('database "geldar_helper" does not exist', '3D000'));
    await expect(probeLogin(fake.make, 'geldar_helper', 'pw')).rejects.toThrow('does not exist');
  });
});

describe('the cli login wiring (C7-03c2)', () => {
  it('probeDatabase throws before any connection when PGDATABASE is unset or empty', () => {
    expect(() => probeDatabase({})).toThrow(/needs PGDATABASE/);
    expect(() => probeDatabase({ PGDATABASE: '' })).toThrow(/needs PGDATABASE/);
  });

  it('probeDatabase returns the PGDATABASE value', () => {
    expect(probeDatabase({ PGDATABASE: 'geldar' })).toBe('geldar');
  });

  it('the probe client config carries the database and the role login', async () => {
    const seen: Array<{ user: string; password: string; database: string }> = [];
    const loginWorks = loginProbeOn('geldar', (config) => {
      seen.push(config);
      return { connect: async () => undefined, end: async () => undefined };
    });
    await expect(loginWorks('geldar_helper', 'pw')).resolves.toBe(true);
    expect(seen).toEqual([
      expect.objectContaining({ user: 'geldar_helper', password: 'pw', database: 'geldar' }),
    ]);
  });

  it('through the wiring a refused login is false and any other connect failure is rethrown', async () => {
    const refused = loginProbeOn('geldar', () => ({
      connect: async () => {
        throw Object.assign(new Error('refused'), { code: '28P01' });
      },
      end: async () => undefined,
    }));
    await expect(refused('geldar_helper', 'pw')).resolves.toBe(false);
    const down = loginProbeOn('geldar', () => ({
      connect: async () => {
        throw Object.assign(new Error('unreachable'), { code: 'ECONNREFUSED' });
      },
      end: async () => undefined,
    }));
    await expect(down('geldar_helper', 'pw')).rejects.toThrow('unreachable');
  });
});
