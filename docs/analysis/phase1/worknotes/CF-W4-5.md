# CF-W4-5: `__Host-` prefix for the session cookies

Status: Built (C7 hardening commit).

## What changed

- Names: the web session cookie is `__Host-gr_session` (`SESSION_COOKIE` in `threshold/register/src/account.ts`, read by `api/auth.ts` through the same constant). The sign-in state cookie is `__Host-gr_state` (`STATE_COOKIE` in `pkce.ts`).
- Attributes: both start with `__Host-`, carry `Path=/`, `Secure`, `HttpOnly`, `SameSite=Lax`, and no `Domain`. A browser refuses a `__Host-` cookie that breaks these, so a planted `Domain=` copy cannot shadow the owner's own.
- Duplicate rule: a request header with two or more cookies of the same name gives no value. The account pages treat it as no session. The owner API treats it as an empty session and does not fall back to a Bearer key. The sign-in callback refuses it, so the state check fails with 403 (the planted-state case).
- Contract: `threshold/register/src/api/owner-api-v1.yaml` names `__Host-gr_session` for the `cookieSession` scheme. A test reads the yaml and checks the name.

## Legacy clears (`LEGACY_CLEARS`)

For one release, sign-in and logout send `Max-Age=0` for the old `gr_session` and `gr_state` names (host-only, no `Domain`). The old names no longer authenticate.

Removal: `LEGACY_CLEARS` in `threshold/register/src/account.ts` goes one release after the release that ships CF-5. The ledger row CF-W4-5 carries the tracking line "remove LEGACY_CLEARS after one release".

## Onboarding fetch-metadata (CF-4, CF-W4-4)

`GET /register/onboarding` serves the held token only when `Sec-Fetch-Site` is `same-origin` or `none`, or the header is absent (old clients). A `cross-site` or `same-site` load renders the empty page without taking the token, and the text says the token is still held in the browser that signed in. The held token is not burned by a cross-site load.

## Not changed

- `gk_session` (the Kino/Glass cookie in `session-cookie.ts`) is not renamed. That is an orchestrator decision.
- Old worknotes (for example `C7-04a.md`) keep the names they had when written.
