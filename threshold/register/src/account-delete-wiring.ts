import { signOutCookies } from './account.ts';
import { type AccountDeleteDeps, accountDeleteDeps } from './api/account-data-delete.ts';
import type { BodyStopLink } from './api/body-retire.ts';

/**
 * The account delete deps as main.ts mounts them (C7-09a): the store's owner, roster and erase, the body link (null
 * without NATS) and the cookie clears of signOutCookies(). A function, so a test can assert that the real clears arrive.
 */
export function accountDeleteWiring(
  store: Parameters<typeof accountDeleteDeps>[0],
  body: BodyStopLink | null,
): AccountDeleteDeps {
  return accountDeleteDeps(store, body, signOutCookies());
}
