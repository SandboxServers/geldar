# W6-11: the cross-site scripting review of Glass

## Method

Every piece of world or agent text that Glass shows can reach a browser by three paths: the JSON
API, the server-sent event stream, and the page. The review follows each path from the database
to the screen and checks, with a test, the step that stops a payload from running.

1. **Static checks.** `glass/src/page-safety.test.ts` forbids markup-from-string and
   code-from-string APIs under `glass/public` and the render modules, and checks that the page has
   no inline script, style or event-handler attribute. `glass/test/import-graph.test.ts` keeps
   Glass from importing any write-capable package.
2. **The API and the stream, over a real loopback socket.** Each corpus value is stored as a
   thought and read back through `GET /api/thoughts`, `GET /api/thoughts/:id` and `GET /api/stream`.
3. **The page, in happy-dom.** The render code draws each value into a row, with no network
   allowed. `glass/test/page-script.test.ts` runs the shipped `app.js` with the shipped markup.
   happy-dom does not enforce the Content-Security-Policy, and its script evaluation is off, so
   the page tests show what the page builds. They do not show that a browser refuses to run it.
   The CSP is checked as a header string (`glass/test/readonly-routes.test.ts`).

## Corpus

`glass/test/corpus.ts` holds 31 inert payloads. Each one would set `__glassCanary`, or fetch a
canary host, if a browser ran it. They cover: script, img, svg and MathML tags; `javascript:` and
`data:` URLs, in mixed case too; anchors, forms, `formaction`, `meta refresh` and `base`; HTML
comment tricks; breakouts from textarea, title and attributes; `iframe srcdoc`; CSS injection;
template literals; markdown links; bidirectional controls and zero-width runs; NUL and lone
surrogates; escaped `<` text; a fake canary marker; a 200 000-character string; and
500-level nested JSON.

## Results

Every row passes. "Enters" names the field and path where the value comes in. "Cannot execute"
names the step that stops it. Tests are named as they appear in the test files.

| Vector | Enters | Why it cannot execute | Test |
| --- | --- | --- | --- |
| Every corpus value (31) | `name`, `wake_reason`, `prompt_template_version`, `plan` through the page | Built with `textContent` after `display()`, so markup is text; the page tag set has no script, img or iframe; no `on*` attribute; no network call | `adversarial fixtures through the page` › `renders %s as text only` (one case per corpus value, `glass/test/adversarial.test.ts`) |
| Every corpus value | API reply | `application/json` with `nosniff`; the value is a JSON string and round-trips to the same text; no reply byte escapes a quoted value | `returns every hostile value as JSON data...`, `keeps a hostile string inside its JSON string...` (`glass/test/adversarial.test.ts`) |
| Every corpus value | Stream frame | One `data:` line per event, JSON-escaped, so a newline in text cannot start a new frame | `sends each hostile thought as one event with one data line...` (`glass/test/adversarial-stream.test.ts`) |
| Deeply nested `model_input` | `GET /api/thoughts/:id` | Returned as a capped JSON string, never parsed into structure the page could walk | `returns a deeply nested model_input as a capped JSON string...` (`glass/test/adversarial.test.ts`) |
| Agent names in filters | Agent list, option element | Option value is an index; the name is text only | `uses an index as each option value and the name only as text` (`glass/src/render-view.test.ts`); `loads the agents and the first page...with names as text only` (`glass/test/page-script.test.ts`) |
| `javascript:` and `onerror` values | Any text field | No link, image or script is built from a value; no `href` or `src` is set from data | `builds no link, image or script from a javascript: URL or an onerror attribute` (`glass/src/render-view.test.ts`) |
| Markup in the page source | Shipped files | No `innerHTML`, `eval`, `new Function`, `document.write`; no inline script, style or handler | `use no markup-from-string or code-from-string API`, `has no inline style, style element or event-handler attribute` (`glass/src/page-safety.test.ts`) |
| Inline script, `eval`, foreign origins | Page response | CSP `script-src 'self'`, `style-src 'self'`, `img-src 'none'`, `connect-src 'self'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, plus `nosniff` | `sends the CSP and the security headers on every reply...` (`glass/test/readonly-routes.test.ts`); `glass/test/readme.test.ts` checks the README quotes the same string |
| Page URL reached with a foreign `Host` (DNS rebinding) | Any path | 421 before any route runs | `refuses a Host header that is not loopback, on every kind of path (DNS rebinding)` (`glass/test/readonly-routes.test.ts`) |
| Write verbs against the page | Any method | 405 with `Allow: GET`; no statement sent | `answers 405 to every write-like method on every known path...` (`glass/test/readonly-routes.test.ts`) |

## Residual risks

- **CSP bypass classes.** The policy is only as strong as its browser. The page tests cannot prove
  that a browser enforces it; they check the header string. Any future endpoint that returns text
  with a script or HTML content type, or an allow-listed script that echoes data, would be an
  exception to this review and must be reviewed again. `script-src 'self'` trusts every script
  file the origin serves, so no route may serve user text as a script.
- **Other local users can read Glass.** Glass binds to loopback and has no authentication in
  Phase 0. Any local user on the same machine can read every thought. This is stated in the
  README. Phase 0 has no per-user control.
- **The Host check stops only browsers.** A local process can send any `Host` header it likes.
  The check defends against DNS rebinding from a page on another site; it is not an access control.
- **Model input and raw replies are read by the Glass role.** Migration `0005` grants `SELECT` on
  `thoughts`, so Glass can read `model_input` and `raw_output`. Together these are the full prompt
  and the raw reply of each thought, and they can contain in-world text. Glass shows them to humans
  only. No agent reads Glass, and the import-graph test keeps the code from writing back.
- **Text as persuasion, not code.** Hostile text that is shown as plain text can still mislead a
  human reader. The render path marks invisible characters (`render-model.ts`), but the review does
  not treat a convincing sentence as a cross-site scripting issue.
- **The corpus is finite.** It is a list of known classes, not a proof. A new vector must be added
  to `glass/test/corpus.ts` and the render code must still build text only.
