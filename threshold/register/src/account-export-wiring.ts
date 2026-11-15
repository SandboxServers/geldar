import { accountExportRoutes, ExportBusyError, ExportTimeoutError } from './api/account-export.ts';
import type { ApiRoute } from './api/route.ts';
import { FixedWindow } from './server.ts';

/** The export port of a store (C7-09b). Optional: a store without it mounts no export route. */
export interface ExportStorePort {
  exportOwnerData?: ((identityHash: string) => Promise<string | null>) | undefined;
}

/**
 * How long one export may hold the process gate (C7-09b). The statement itself is cut at 60 s by the server
 * (statement_timeout); this bound is for a call that never settles (a half-open connection), so the gate is freed.
 */
export const EXPORT_TIMEOUT_MS = 70_000;

/**
 * The export route as main.ts mounts it (C7-09b): the store's exportOwnerData, one export per minute per owner (the
 * register's FixedWindow, the same limiter as the owner writes), and at most ONE export running at a time in this
 * process: a second one while the first runs is refused with ExportBusyError (503 at the route), never queued, so the
 * export cannot take every connection of the pool. A busy answer does not spend the owner window (the window is charged
 * only when the export runs). A call that does not settle within timeoutMs is refused with ExportTimeoutError (503) and
 * frees the gate. Empty when the store has no exportOwnerData, so the route is unmounted and answers 404.
 */
export function accountExportMount(
  store: ExportStorePort,
  now: () => number = Date.now,
  timeoutMs: number = EXPORT_TIMEOUT_MS,
): readonly ApiRoute[] {
  const exportOwnerData = store.exportOwnerData;
  if (typeof exportOwnerData !== 'function') return [];
  const window = new FixedWindow(1, now);
  let running = false;
  return accountExportRoutes({
    exportOwnerData: async (identityHash) => {
      if (running) throw new ExportBusyError();
      running = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          exportOwnerData.call(store, identityHash),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new ExportTimeoutError()), timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        running = false;
      }
    },
    charge: (ownerId) => (running ? 0 : window.charge(ownerId)),
    now,
  });
}
