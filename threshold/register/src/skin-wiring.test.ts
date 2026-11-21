import { describe, expect, it } from 'vitest';
import type { ApiRoute } from './api/route.ts';
import type { QueryClient } from './owner-keys-pg.ts';
import { mountOwnerApi, withSkinRoutes } from './skin-wiring.ts';

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

describe('mountOwnerApi (the owner API as main.ts mounts it)', () => {
  it('mounts the skin POST and GET on the API it returns, next to the body routes', () => {
    const store = {} as Parameters<typeof mountOwnerApi>[0];
    const out = mountOwnerApi(store, { link: null, routes: [] }, {}, db, () => {});
    const skin = out.api.routes.filter((r) => r.pattern.test('/agents/abc/skin'));
    expect(skin.map((r) => r.method)).toEqual(expect.arrayContaining(['POST', 'GET']));
  });

  it('keeps a body route that is already mounted', () => {
    const store = {} as Parameters<typeof mountOwnerApi>[0];
    const existing = { method: 'GET', pattern: /^\/body$/ } as unknown as ApiRoute;
    const out = mountOwnerApi(store, { link: null, routes: [existing] }, {}, db, () => {});
    expect(out.api.routes).toContain(existing);
    expect(out.api.routes.some((r) => r.pattern.test('/agents/abc/skin'))).toBe(true);
  });
});
