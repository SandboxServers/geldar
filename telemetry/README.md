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
| `src/redact.ts` | `redactContent()` copies a value as plain JSON-safe data: secret-named keys (the attribute allow-list's rule, so `token`, `password`, `apiKey`, `sessionId` and `email` are redacted but `tokens` and `max_tokens` are not) get `[redacted]`, strings go through `scrubText()`, a bigint, Date, Map, Set, Error or binary value becomes text or an array or object of entries, and a throwing getter or Proxy becomes `[unreadable]`. `scrubText()` hides: an `Authorization` or `Proxy-Authorization` value (a scheme Basic, Bearer, Token, Digest, Negotiate or NTLM and the rest up to a quote or end of line, or a bare run of 16 or more token characters with a digit or symbol; also inside a JSON pair); `Bearer <run>` of 6 or more characters in any case (a lower-case `bearer` only when the run has a digit or one of `_~+/=`, or has 20 or more characters, so "the bearer of bad news" stays); `gmcp-` tokens; URL passwords up to the last `@` before the path (a password containing `/` is not caught); and `key=value`, `key: value` or `"key":"value"` pairs whose key is a credential name (`password`, `token`, `api_key`, `cookie`, `access_token`, and the rest of the key rule), up to a space, quote, `&`, `,` or `;`. It does not catch a secret with no key or scheme in front of it. Every pattern is linear: a 10 MB string scrubs in well under 500 ms. `errorFields()` returns scrubbed `exception.*` fields; message and stack are cut at 64 KiB (`MAX_ERROR_TEXT_CHARS`) before scrubbing and a cut ends in `…[truncated N chars]`, which loses nothing visible because the package caps content at 32 KiB afterwards. Run captured content through these before it is exported |
| `src/content.ts` | `contentAttributes()`, `addContentEvent()` |

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
