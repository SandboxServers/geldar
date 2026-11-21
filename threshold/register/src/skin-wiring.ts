import type { ApiRoute } from './api/route.ts';
import { mountSkinRoutes } from './api/skins.ts';
import type { QueryClient } from './owner-keys-pg.ts';
import { skinStoreOf } from './skin-pg.ts';

// The skin upload routes (C7-13a) join the body routes on the owner API over the same pool.
// A store without the methods mounts none, so the body routes are returned unchanged in that case.
export function withSkinRoutes<B extends { readonly routes: readonly ApiRoute[] }>(
  body: B,
  db: QueryClient,
): B {
  return { ...body, routes: [...body.routes, ...mountSkinRoutes(skinStoreOf(db))] };
}
