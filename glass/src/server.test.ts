import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GlassConfig } from './config.ts';
import { buildGlass, type GlassParts } from './server.ts';

const CONFIG: GlassConfig = {
  host: '127.0.0.1',
  port: 0,
  pg: { host: '127.0.0.1', port: 5432, user: 'geldar_glass', database: 'geldar', password: 'x' },
  sseMaxClients: 2,
  sseBufferFrames: 10,
  ssePollMs: 1000,
};

const built: GlassParts[] = [];

function build(): GlassParts {
  const parts = buildGlass(CONFIG);
  built.push(parts);
  return parts;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const parts of built.splice(0)) {
    parts.close();
  }
});

describe('the Glass server parts', () => {
  it('gives the pool a connect timeout of 5 seconds, so a hung connect cannot stall a poll', () => {
    const { pool } = build();
    expect(pool.options.connectionTimeoutMillis).toBe(5000);
  });

  it('ends the pool once when close() runs twice, as a second SIGTERM does', () => {
    const parts = build();
    const end = vi.spyOn(parts.pool, 'end');
    const hubClose = vi.spyOn(parts.hub, 'close');
    parts.close();
    parts.close();
    expect(end).toHaveBeenCalledTimes(1);
    expect(hubClose).toHaveBeenCalledTimes(1);
  });
});
