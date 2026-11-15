import { signOutCookies } from './account.ts';
import {
  type AccountDeleteDeps,
  accountDeleteDeps,
  accountDeleteRoutes,
} from './api/account-data-delete.ts';
import type { BodyStopLink } from './api/body-retire.ts';
import type { ApiRoute } from './api/route.ts';
import { mountBodyApi } from './nats-body.ts';

/**
 * The account delete deps as main.ts mounts them (C7-09a): the store's owner, roster and erase, the body link (null
 * without NATS), the cookie clears of signOutCookies() and the log. A function, so a test can assert that the real
 * clears arrive.
 */
export function accountDeleteWiring(
  store: Parameters<typeof accountDeleteDeps>[0],
  body: BodyStopLink | null,
  log: (line: string) => void,
): AccountDeleteDeps {
  return accountDeleteDeps(store, body, signOutCookies(), log);
}

/**
 * The account delete as main.ts mounts it (C7-09a review fix 2). Returns the deps the page action uses and the API with
 * the account delete route appended to the body routes. main.ts calls this, and a test calls it too, so a change that
 * drops either wiring fails the test.
 */
export function mountAccountDelete<A extends object>(
  store: Parameters<typeof accountDeleteDeps>[0],
  body: { readonly link: BodyStopLink | null; readonly routes: readonly ApiRoute[] },
  api: A,
  log: (line: string) => void,
): { accountDelete: AccountDeleteDeps; api: A & { readonly routes: readonly ApiRoute[] } } {
  const accountDelete = accountDeleteWiring(store, body.link, log);
  return {
    accountDelete,
    api: mountBodyApi(api, { routes: [...body.routes, ...accountDeleteRoutes(accountDelete)] }),
  };
}
