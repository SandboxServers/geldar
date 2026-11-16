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
  injected, and `tracestate` is not carried over NATS.
- **Attribute policy.** Each signal has an allow-list of attribute names. Unknown names are dropped
  and counted (`attributeDropCount()`). Metrics refuse any attribute that names a life, a player, an
  agent or a token. Names containing `token`, `secret`, `password`, `cookie`, `authorization` or
  `email` are dropped everywhere.
- **Large text.** Content fields are capped at 32 KiB and carry a `truncated` flag and their original
  byte size.
- **Resource.** Every signal carries `service.name`, `service.version` and
  `deployment.environment.name`.

## Modules

| File | Purpose |
|---|---|
| `src/sdk.ts` | `startTelemetry()`: providers, exporters, queue limits, shutdown |
| `src/natsTrace.ts` | `injectTrace()` and `extractTrace()` for NATS-style headers |
| `src/logger.ts` | `createLogger()`: JSON stdout lines stamped with trace ids, plus OTLP log records |
| `src/attributes.ts` | Attribute allow-list, identity refusal for metrics, forbidden key names |
| `src/content.ts` | `capText()`, `contentAttributes()`, `addContentEvent()` |

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
