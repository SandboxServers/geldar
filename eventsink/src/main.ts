/** Entry point: connect to Postgres and NATS, run the consumer, drain on SIGINT/SIGTERM. */
import { pathToFileURL } from 'node:url';
import { connectNats } from '@geldar/contract/nats';
import { createLogger, startTelemetry } from '@geldar/telemetry';
import pg from 'pg';
import { loadConfig, type SinkConfig } from './config.ts';
import { type ErrorLog, startConsumer } from './consumer.ts';
import { type EventsinkTelemetry, eventsinkTelemetry } from './metrics.ts';
import { eventsinkNatsAuth } from './nats-credentials.ts';
import { sinkPlan, startShardServices } from './sink-plan.ts';
import { pgStateStore } from './state/pg-state-store.ts';
import { serveProficiencyState } from './state/service.ts';
import { pgEventWriter } from './writer.ts';
import { startOutboxPublisher } from './xp/outbox.ts';

/**
 * The options for startConsumer. `metrics` is present only with telemetry on (decision 0088):
 * without GELDAR_TELEMETRY_URL the consumer counts nothing and starts no lag timer.
 */
export function consumerOptions(
  config: SinkConfig,
  telemetry: EventsinkTelemetry | undefined,
  onFatal: (error: unknown) => void,
  errorLogs?: ErrorLogs,
): Parameters<typeof startConsumer>[2] {
  return {
    ...config,
    ...(telemetry ? { metrics: telemetry.metrics } : {}),
    ...(errorLogs ? { errorLog: errorLogs.errorLog } : {}),
    onFatal,
  };
}

/** The OTLP error-log path of the consumer (T-06d4) and the call that flushes it. */
export interface ErrorLogs {
  errorLog: ErrorLog;
  stop(): Promise<void>;
}

/**
 * Starts the SDK for logs only (the metrics push above stays as it is) and returns the error log.
 * With no GELDAR_TELEMETRY_URL, or an unusable one, it returns undefined: no logger, no request.
 * The logger's stdout line is dropped: the consumer already writes its own text line to stderr.
 */
export function startErrorLogs(env: NodeJS.ProcessEnv): ErrorLogs | undefined {
  const sdk = startTelemetry({
    service: 'geldar-eventsink',
    version: env.GELDAR_VERSION ?? 'dev',
    endpoint: env.GELDAR_TELEMETRY_URL,
    signals: { traces: false, metrics: false, logs: true },
  });
  if (!sdk.enabled) return undefined;
  const logger = createLogger({
    name: 'geldar-eventsink',
    write: () => {},
    extraKeys: ['subject', 'delivery_count', 'batch_size'],
  });
  return { errorLog: (event, fields) => logger.error(event, fields), stop: () => sdk.shutdown() };
}

/** Runs the sink until a signal, then stops the consumer and closes the connections. */
export async function main(): Promise<void> {
  const config = loadConfig();
  // Read before any connection: a malformed threshold list with XP on fails here, not mid-stream.
  const plan = sinkPlan(process.env);
  const pool = new pg.Pool({
    ...config.pg,
    max: 2,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    statement_timeout: 30_000,
    idleTimeoutMillis: 60_000,
  });
  // An idle client dropping must not crash the process; the next query reconnects.
  pool.on('error', (error) => console.error('eventsink: idle postgres client error', error));
  const nc = await connectNats({
    servers: config.natsUrl,
    name: 'eventsink',
    ...eventsinkNatsAuth(),
  });
  // Push-only metrics: no telemetry URL means no metrics object, no timer and no request.
  const telemetry = eventsinkTelemetry(process.env, {
    service: 'eventsink',
    log: (line) => console.error('eventsink: telemetry', JSON.stringify(line)),
  });
  const errorLogs = startErrorLogs(process.env);
  // GELDAR_SHEET_SHARD unset starts nothing here (sink-plan.ts); a bad shard name throws before the consumer runs.
  const services = startShardServices(plan, {
    startState: (shard) =>
      serveProficiencyState({
        nc,
        store: pgStateStore(pool),
        shard,
        log: (line) => console.error('eventsink: state', line),
      }),
    startOutbox: () =>
      startOutboxPublisher({
        pool,
        push: { publish: (subject, body) => nc.publish(subject, body) },
        log: (line) => console.error('eventsink: outbox', line),
      }),
  });
  const consumer = await startConsumer(
    nc,
    pgEventWriter(pool, plan.xp),
    consumerOptions(
      config,
      telemetry,
      (error) => {
        console.error('eventsink: giving up after repeated failures, exiting for a restart', error);
        process.exit(1);
      },
      errorLogs,
    ),
  );
  console.log('eventsink: consuming GELDAR_EVENTS');

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    await consumer.stop();
    for (const service of services) await service.stop();
    await telemetry?.stop();
    await errorLogs?.stop();
    await nc.drain();
    await pool.end();
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

// Runs only as the entry point, so a test can import the helpers without connecting.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error('eventsink: failed to start', error);
    process.exit(1);
  });
}
