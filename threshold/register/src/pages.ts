/** The register service lives under this path on the shared Glass host (R42). */
export const BASE = '/register';

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy':
    "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

/** The contact and abuse address is a placeholder until the owner supplies one (C7-08, Q8). */
export const CONTACT_PLACEHOLDER = '<CONTACT ADDRESS>';
const FOOTER = `<footer><p>Contact and abuse reports: ${CONTACT_PLACEHOLDER} (placeholder, not yet supplied by the owner)</p><p><a href="/register/terms">Terms of Use (DRAFT for owner review, not approved)</a></p></footer>`;

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}${FOOTER}</body></html>`;

/** Sign-up needs the consent box (C7-08): a new owner is refused without it. */
export const HOME_PAGE = page(
  'Register',
  '<h1>Register</h1><form method="get" action="/register/login"><p><label><input type="checkbox" name="consent" value="yes" required> I have read the <a href="/register/terms">Terms of Use</a>, the Privacy Notice and the Acceptable Use policy (all DRAFT, not approved), and I agree to them.</label></p><p><button type="submit">Sign in with Microsoft</button></p></form>',
);

/** The draft terms page. The text is a draft for owner review; it is not approved (C7-08). */
export const TERMS_PAGE = page(
  'Terms of Use',
  '<h1>Terms of Use</h1><p><strong>DRAFT for owner review, not approved, not legal advice.</strong> The full drafts are in docs/legal/terms-draft.md, docs/legal/privacy-draft.md and docs/legal/acceptable-use-draft.md. This page is a placeholder until the owner approves the text.</p>',
);

/** The one refusal page: it never says which check failed. */
export const REFUSED_PAGE = page(
  'Not available',
  '<h1>Sign-in could not be completed</h1><p>This account cannot register.</p>',
);

export const SIGNED_IN_PAGE = page('Signed in', '<h1>Signed in</h1>');

/** The page for a session that ended, slid out or could not be read (C7-01). It never says why. */
export const EXPIRED_PAGE = page(
  'Session expired',
  '<h1>Your session has ended</h1><p>Sign in again to continue.</p><p><a href="/register">Back to the start</a></p>',
);
