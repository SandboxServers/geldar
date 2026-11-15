import { accountExportRoutes, ExportBusyError } from './api/account-export.ts';
import type { ApiRoute } from './api/route.ts';
import { FixedWindow } from './server.ts';

/** The export port of a store (C7-09b). Optional: a store without it mounts no export route. */
export interface ExportStorePort {
  exportOwnerData?: ((identityHash: string) => Promise<string | null>) | undefined;
}

/**
 * The export route as main.ts mounts it (C7-09b): the store's exportOwnerData, one export per minute per owner (the
 * register's FixedWindow, the same limiter as the owner writes), and at most ONE export running at a time in this
 * process: a second one while the first runs is refused with ExportBusyError (503 at the route), never queued, so the
 * export cannot take every connection of the pool. Empty when the store has no exportOwnerData, so the route is
 * unmounted and answers 404.
 */
export function accountExportMount(
  store: ExportStorePort,
  now: () => number = Date.now,
): readonly ApiRoute[] {
  const exportOwnerData = store.exportOwnerData;
  if (typeof exportOwnerData !== 'function') return [];
  const window = new FixedWindow(1, now);
  let running = false;
  return accountExportRoutes({
    exportOwnerData: async (identityHash) => {
      if (running) throw new ExportBusyError();
      running = true;
      try {
        return await exportOwnerData.call(store, identityHash);
      } finally {
        running = false;
      }
    },
    charge: (ownerId) => window.charge(ownerId),
    now,
  });
}
