import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// A fake pg.Client: records every instance, its listeners and its end() calls, and can be told to fail a query.
const fake = vi.hoisted(() => {
  const made: Array<{
    listeners: Map<string, (err: Error) => void>;
    ended: number;
    failNext: boolean;
  }> = [];
  class FakeClient {
    readonly listeners = new Map<string, (err: Error) => void>();
    ended = 0;
    failNext = false;
    constructor() {
      made.push(this);
    }
    on(event: string, fn: (err: Error) => void): this {
      this.listeners.set(event, fn);
      return this;
    }
    async connect(): Promise<void> {}
    async query(text: string): Promise<{ rows: unknown[] }> {
      if (this.failNext) {
        this.failNext = false;
        throw new Error(`connection lost on ${text}`);
      }
      return { rows: [] };
    }
    async end(): Promise<void> {
      this.ended++;
    }
  }
  return { made, FakeClient };
});

vi.mock('pg', () => ({ default: { Client: fake.FakeClient } }));

const { createGlassClient } = await import('./adapters.ts');

function env(): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'adam-run-glass-'));
  const file = join(dir, 'pw.txt');
  writeFileSync(file, 'not-a-real-secret-xyz\n');
  return { GELDAR_GLASS_PG_PASSWORD_FILE: file };
}

describe('the glass client connection', () => {
  it('close ends the connection, so the process can exit when the run ends', async () => {
    fake.made.length = 0;
    const client = createGlassClient(env());
    await client.query('SELECT 1', []);
    await client.close?.();
    expect(fake.made).toHaveLength(1);
    expect(fake.made[0]?.ended).toBe(1);
  });

  it('closing a client that never connected does nothing', async () => {
    fake.made.length = 0;
    await createGlassClient(env()).close?.();
    expect(fake.made).toHaveLength(0);
  });

  it('an error event on the connection is not a crash: the next query reconnects', async () => {
    fake.made.length = 0;
    const client = createGlassClient(env());
    await client.query('SELECT 1', []);
    fake.made[0]?.listeners.get('error')?.(new Error('terminating connection due to restart'));
    await client.query('SELECT 2', []);
    expect(fake.made).toHaveLength(2);
    expect(fake.made[0]?.ended).toBe(1);
  });

  it('a failed query drops the connection, and the next query reconnects', async () => {
    fake.made.length = 0;
    const client = createGlassClient(env());
    await client.query('SELECT 1', []);
    const first = fake.made[0];
    if (first) first.failNext = true;
    await expect(client.query('SELECT 2', [])).rejects.toThrow('connection lost');
    await client.query('SELECT 3', []);
    expect(fake.made).toHaveLength(2);
  });
});
