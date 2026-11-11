export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy':
    "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

export const HOME_PAGE = page(
  'Register',
  '<h1>Register</h1><p><a href="/login/github">Sign in with GitHub</a></p><p><a href="/login/discord">Sign in with Discord</a></p>',
);

/** The one refusal page: it never says which check failed. */
export const REFUSED_PAGE = page(
  'Not available',
  '<h1>Sign-in could not be completed</h1><p>This account cannot register.</p>',
);

export const SIGNED_IN_PAGE = page('Signed in', '<h1>Signed in</h1>');
