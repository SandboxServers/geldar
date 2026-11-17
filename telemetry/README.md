# @geldar/telemetry

Shared OpenTelemetry setup for Geldar's Node services: traces, logs and metrics over OTLP/HTTP,
with trace context carried in NATS message headers.

## Operator notes

- **Off by default.** The package does nothing unless a collector URL is given. With no URL there are
  no providers, no timers, no network calls and no-op API calls. The URL comes from the environment
  variable `GELDAR_TELEMETRY_URL`, read by the calling service. It is never written in the repo.
- **Never blocks.** Each signal has a bounded queue (512 items by default). When the queue is full,
  new items are dropped. Exports time out after 5 seconds. Export failures and sink failures never
  reach the caller.
- **Trace context only.** The only propagated header is `traceparent`. Baggage is never installed or
  injected, and `tracestate` is not carried over NATS. That deliberately narrows decision 0350
  point 7, because vendor state could carry unreviewed data.
- **Attribute policy, enforced in the SDK.** Every span, span event and log record passes an
  allow-list in a span or log processor, and every metric data point passes a metric View. Raw
  OpenTelemetry API calls are filtered the same as the package helpers. Unknown names are dropped
  and counted (`attributeDropCount()`). Metrics refuse any attribute that names a life, a player, an
  agent or a token. Keys that name a credential or an email are dropped everywhere. A `token` word
  (`auth_token`, `accessToken`) is dropped, and joined forms (`apiKey`, `authtoken`, `emailAddress`,
  `pass_word`) are matched after camelCase is split. Plural token counts such as
  `gen_ai.usage.input_tokens` are not credentials.
- **Large text.** Content fields (`geldar.content.*`) are capped at 32 KiB in the SDK processors, on
  spans, span events and logs. The cut never splits a UTF-8 character, so capped text is always
  valid. Each capped field carries a `truncated` flag and its original byte size.
- **Resource.** Every signal carries `service.name`, `service.version`, `service.namespace` (always
  `geldar`), a per-start `service.instance.id` (a random UUID; tests may inject one), and
  `deployment.environment.name`. `geldar.shard` is set when the `shard` option is given. Life and
  player identifiers are never resource attributes.
- **Signals option.** `startTelemetry({ signals: { traces, metrics, logs } })` turns each signal on
  or off; each defaults to on. A signal set to `false` gets no provider, no exporter and no timer,
  and its global API stays a no-op (`metrics: false` means no metric reader and no export at all).
  The global check then looks only at the signals that are on, so a foreign owner of an off signal's
  global does not block the start. With `traces` on, `tracerProvider` is set and `shutdown()` works
  as usual. The context and propagator globals are always installed.
- **All signals off.** `signals: { traces: false, metrics: false, logs: false }` still returns an
  enabled handle, with `tracerProvider` undefined and no exporter, provider, reader or timer. The
  context and propagator globals are still installed, so a foreign propagator or context manager
  makes the call return off, as it does for any start. `shutdown()` is safe to call.

## Modules

| File | Purpose |
|---|---|
| `src/sdk.ts` | `startTelemetry()`: providers, exporters, queue limits, shutdown |
| `src/nats-trace.ts` | `injectTrace()` and `extractTrace()` for NATS-style headers |
| `src/logger.ts` | `createLogger()`: JSON stdout lines stamped with trace ids, plus OTLP log records |
| `src/attributes.ts` | Attribute allow-list, identity refusal for metrics, forbidden key names |
| `src/sdk-processors.ts` | Span, log and metric-View processors that run the allow-list inside the SDK |
| `src/cap-text.ts` | `capText()`: the UTF-8 byte cap for large text |
| `src/redact.ts` | `redactContent()`, `scrubText()`, `errorFields()`: credential redaction of captured content (rules below the table) |
| `src/content.ts` | `contentAttributes()`, `addContentEvent()` |

### Redaction rules (`src/redact.ts`)

Decision 0350 says capture everything and redact only credentials, so the free-text rules are narrow. Run captured content through `redactContent()`, `scrubText()` or `errorFields()` before it is exported.

`redactContent()` copies a value as plain JSON-safe data. An object key that names a credential (the attribute allow-list's rule: the whole words `token` and `pwd`, and the stems `password`, `passphrase`, `signature`, `secret`, `cookie`, `apiKey`, `sessionId`, `email` and others inside any name; not `tokens`, `max_tokens` or `input_tokens`. The stems match as substrings, so `secretary`, `cookies`, `secretDoor`, `tokenCount` and `emailCount` as OBJECT KEYS are redacted too: a known over-redaction, unlike the free-text rule below) gets `[redacted]` whatever its value. Strings go through `scrubText()`. A bigint, Date, Map, Set, Error or binary value becomes text or entries, and a throwing getter or Proxy becomes `[unreadable]`. Work per call is bounded: depth 32, 100,000 objects, 100,000 array elements, 1,000 Map or Set entries and 4 MiB of string content (later strings become `[omitted N chars]`).

`scrubText()` hides:

- an `Authorization` or `Proxy-Authorization` value (also in a JSON pair, also doubly encoded as `\"Authorization\":\"...\"`): a scheme Basic, Bearer, Token, Negotiate or NTLM and the rest up to a quote or the end of the line; Digest and AWS4-HMAC-SHA256 to the end of the line (so `response=` and `Signature=` go); or a bare run of 16 or more token characters with a digit or one of `._~+/=`;
- `Bearer <run>` (also `Bearer: <run>`, `Bearer "<run>"`): the capitalised `Bearer` or `BEARER` only when the run is 8 or more characters and not a plain word (`Standard Bearer Alexander` stays); another case only when the run has a digit or one of `_~+/=-` or is 20 or more characters (`the bearer of bad news` stays);
- `gmcp-` plus 64 hex characters, a bare JWT (`eyJ...` three base64url segments) and PEM `PRIVATE KEY` blocks (to the END line, or to the end of the text when it is cut);
- URL userinfo passwords, up to the last `@` before the path (a password containing `/` is not caught; any scheme prefix or length, only the last 32 scheme characters are examined);
- `key=value`, `key: value`, `"key":"value"` (also escaped) where the key ends in a whole credential word (`password`, `passwd`, `passphrase`, `secret`, `token`, `cookie`, `signature`, `api_key`, `private_key`, `secret_key`, `aws_secret_access_key`, `access_token`, ...). `session_id`, `jwt`, `auth`, `access_key`, `signing_key` and `ssh_key` count too. In free text `secretary`, `cookies`, `secrets`, `tokens`, `pwd`, `sig`, `key` and `code` are not credential keys. In `key: value` and `key=value` form the unquoted value is hidden only when it looks like a secret: 8 or more characters, not a single plain word shorter than 12 (`Secret: north`, `password: swordfish`, `token: 5` stay). An unquoted value after `=` or `:` that is followed by `, ; & ) }`, a backslash or a quote inside the same run (`password=Zq9x,K2mP7vL4Ab`) is read to the next whitespace (at most 512 characters, whatever the length of the first segment) and hidden whole when that whole run looks secret (8 or more characters and not a plain word, or a digit and a letter). The run ends early where another pair starts (`,user=bob`, `&x=1`; so `password=Zq9x,K2mP7vL4Ab,user=bob` keeps `,user=bob`), at a closing quote (`?token=abc"}`) and, after a quoted key, at any quote. Trailing `, ; . ) } ]` stay out of the hidden span and out of the test, so `password: swordfish, then` stays. Known over-redaction: `token=12,34,56,78`, `Signature: 10,20,30,40`, `secret=north;south;east;west` and `password=swordfish,okay` are hidden (comma-joined words or numbers of 8+ characters), and `token=ab1,x` hides `x`. Not hidden: a password with a space (`password=Zq9x, K2mP7vL4Ab`) and a password with `=`-pair look-alike (`,name=value`) after a delimiter. A quoted value ends at the first quote that is not escaped (the escapes of JSON inside a JSON string are followed; a value ending in a backslash still closes). Known gap: in raw non-JSON text a value that ends in a backslash before its closing quote (`password="C:\x\" token="..." end`) is read as an escaped quote, so the value runs on to the next quote and the second secret can stay visible. A value after `?token=`, `&token=` or `--password=` is hidden whatever it is. A quoted value (spaces included) is hidden when the key is quoted (`"password":"..."`), when the separator is `=` (`password="open sesame"`) or in a query; `password: "open sesame"` in prose stays. A `Cookie`/`Set-Cookie` value in `name=value` form is hidden to the end of the line.

The redactor is a safety net on top of the attribute allow-list, not the primary control; the following are known gaps for the owner to rule on. Not scrubbed as free text: query parameters `sig`, `key`, `code` and `X-Amz-Credential`; Azure `AccountKey=`; `--password VALUE` and `--token VALUE` with a space, `curl -u user:pass`, `-pVALUE`; header pairs given as data (`[['authorization','...']]` tuples, `rawHeaders`); XML elements (`<password>...</password>`); PGP `PRIVATE KEY BLOCK`; an array or object value in JSON text (`{"password":["..."]}`); a `pwd=` value; a password with a space outside quotes or a `/` in a URL; Unicode look-alike keys. Also not scrubbed: AWS access key ids, `sk-...` API keys, `ghp_...` and `xoxb-...` tokens, a header pair given as data with no key in front (`{"name":"Authorization","value":"Basic ..."}` hides only by the key rule), a short lower-case bearer (`bearer abcdefghij`), a short value after a plain `key=value` (`secret=abc`), userinfo without a password, a token split over two lines.

Guarantees: `scrubText()` never throws (on any failure it returns `[unscrubbable N chars]`, never the original) and every pattern is linear. No regex has a counted greedy loop over unbounded input, so none can overflow V8's regex stack: 64 MiB after `Bearer` and 16 MiB after every other prefix are tested. Measured on a loaded developer machine (1 MiB / 10 MiB): `Bearer a` repeated 29 ms / 308 ms; `key=` 158 ms / 1.6 s; `password=` 16 ms / 158 ms; `a=b ` 31 ms / 281 ms; `"password":"` 67 ms / 749 ms; a run of `a` 106 ms / 1.7 s; `eyJ-` 93 ms / 1.1 s. The tests assert 1 MiB under 1 s, 10 MiB under 5 s and a 3x bound on doubling. `errorFields()` cuts message and stack at 64 KiB (`MAX_ERROR_TEXT_CHARS`) before scrubbing and a cut ends in `…[truncated N chars]`; the JSON of a thrown plain object is cut the same way. Inside `redactContent()` an Error is charged to the 4 MiB budget before it is scrubbed (message plus stack, each at most 64 KiB), so an exhausted budget stops the work and a later Error becomes `[omitted N chars]`; a boxed `String`, `Number` or `Boolean` is read as its primitive (also one made in another realm, such as a `node:vm` context). The delimiter-run read costs at most 512 characters per credential key and the tests hold dense and trailing-punctuation shapes under 1 s at 1 MiB and 3 s at 10 MiB.

## Use

```ts
import { createLogger, startTelemetry } from '@geldar/telemetry';

const telemetry = startTelemetry({
  service: 'geldar-example',
  version: process.env.GELDAR_VERSION ?? 'dev',
  endpoint: process.env.GELDAR_TELEMETRY_URL,
});
const log = createLogger({ name: 'geldar-example' });
log.info('started', { shard: 'phase1' });
// on exit:
await telemetry.shutdown();
```

## Tests

```sh
./geldar.ps1 pnpm --filter @geldar/telemetry test
```

The tests use fake exporters and never open a network connection.
