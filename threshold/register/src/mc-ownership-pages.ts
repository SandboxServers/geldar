/**
 * The refusal page for a sign-up the Minecraft Java check did not admit. Only the fixed texts of mc-ownership.ts
 * appear here: no token, no identifier, no Microsoft or Mojang reply.
 */
import type { OwnershipRefusal } from './mc-signup-gate.ts';
import { page } from './pages.ts';

export function ownershipRefusedPage(refusal: OwnershipRefusal): string {
  const heading =
    refusal.status === 'not_owned'
      ? 'No Minecraft Java account'
      : refusal.status === 'failed' && refusal.code === 'check_unavailable'
        ? 'Ownership check not available yet'
        : 'Sign-up could not be completed';
  return page('Not available', `<h1>${heading}</h1><p>${refusal.message}</p>`);
}

/** The page after a new Game Pass sign-up: the launcher hint (a fixed text of mc-ownership.ts), then the account link. */
export function gamepassSignedInPage(hint: string): string {
  return page(
    'Signed in',
    `<h1>Signed in</h1><p>${hint}</p><p><a href="/register/account">Continue to your account</a></p>`,
  );
}
