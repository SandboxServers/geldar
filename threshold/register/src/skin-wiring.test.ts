import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ApiRoute } from './api/route.ts';
import type { QueryClient } from './owner-keys-pg.ts';
import { withSkinRoutes } from './skin-wiring.ts';

const db = { query: async () => ({ rows: [] }) } as unknown as QueryClient;

describe('withSkinRoutes', () => {
  it('appends the POST and GET skin routes after the body routes and keeps the other fields', () => {
    const out = withSkinRoutes({ marker: 'body', routes: [] as ApiRoute[] }, db);
    expect(out.marker).toBe('body');
    expect(out.routes.map((r) => r.method)).toEqual(['POST', 'GET']);
    for (const route of out.routes) {
      expect(route.pattern.test('/agents/abc/skin')).toBe(true);
    }
  });

  it('keeps the existing body routes first', () => {
    const existing = { method: 'GET', pattern: /^\/body$/ } as unknown as ApiRoute;
    const out = withSkinRoutes({ routes: [existing] }, db);
    expect(out.routes[0]).toBe(existing);
    expect(out.routes).toHaveLength(3);
  });
});

describe('main.ts wiring', () => {
  it('passes the body through withSkinRoutes before mountAccountDelete', () => {
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(main).toContain('withSkinRoutes(body, db)');
    expect(main).not.toContain('mountSkinRoutes(skinStoreOf(db))');
  });
});
