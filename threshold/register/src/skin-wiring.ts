import { mountAccountDelete } from './account-delete-wiring.ts';
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

/**
 * The owner API as main.ts mounts it (C7-13a review fix 4): the skin routes join the body routes, then the account
 * delete mounts on them. main.ts calls this, and a test calls it too, so dropping the skin wrap fails the test.
 */
export function mountOwnerApi<A extends object>(
  store: Parameters<typeof mountAccountDelete>[0],
  body: Parameters<typeof mountAccountDelete>[1],
  api: A,
  db: QueryClient,
  log: (line: string) => void,
): ReturnType<typeof mountAccountDelete<A>> {
  return mountAccountDelete(store, withSkinRoutes(body, db), api, log);
}
