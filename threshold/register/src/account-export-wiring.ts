import { accountExportRoutes } from './api/account-export.ts';
import type { ApiRoute } from './api/route.ts';
import { FixedWindow } from './server.ts';

/** The export port of a store (C7-09b). Optional: a store without it mounts no export route. */
export interface ExportStorePort {
  exportOwnerData?: ((identityHash: string) => Promise<unknown>) | undefined;
}

/**
 * The export route as main.ts mounts it (C7-09b): the store's exportOwnerData, one export per minute per owner (the
 * register's FixedWindow, the same limiter as the owner writes). Empty when the store has no exportOwnerData, so the
 * route is unmounted and answers 404.
 */
export function accountExportMount(
  store: ExportStorePort,
  now: () => number = Date.now,
): readonly ApiRoute[] {
  const exportOwnerData = store.exportOwnerData;
  if (typeof exportOwnerData !== 'function') return [];
  const window = new FixedWindow(1, now);
  return accountExportRoutes({
    exportOwnerData: (identityHash) => exportOwnerData.call(store, identityHash),
    charge: (ownerId) => window.charge(ownerId),
    now,
  });
}
