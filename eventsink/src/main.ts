/** Entry point: connect to Postgres and NATS, run the consumer, drain on SIGINT/SIGTERM. */
import { pathToFileURL } from 'node:url';
import { connectNats } from '@geldar/contract/nats';
import pg from 'pg';
import { loadConfig, type SinkConfig } from './config.ts';
import { startConsumer } from './consumer.ts';
import { type EventsinkTelemetry, eventsinkTelemetry } from './metrics.ts';
import { pgEventWriter } from './writer.ts';

/**
 * The options for startConsumer. `metrics` is present only with telemetry on (decision 0088):
 * without GELDAR_TELEMETRY_URL the consumer counts nothing and starts no lag timer.
 */
export function consumerOptions(
  config: SinkConfig,
  telemetry: EventsinkTelemetry | undefined,
  onFatal: (error: unknown) => void,
): Parameters<typeof startConsumer>[2] {
  return { ...config, ...(telemetry ? { metrics: telemetry.metrics } : {}), onFatal };
}

/** Runs the sink until a signal, then stops the consumer and closes the connections. */
export async function main(): Promise<void> {
  const config = loadConfig();
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
  const nc = await connectNats({ servers: config.natsUrl, name: 'eventsink' });
  // Push-only metrics: no telemetry URL means no metrics object, no timer and no request.
  const telemetry = eventsinkTelemetry(process.env, {
    service: 'eventsink',
    log: (line) => console.error('eventsink: telemetry', JSON.stringify(line)),
  });
  const consumer = await startConsumer(
    nc,
    pgEventWriter(pool),
    consumerOptions(config, telemetry, (error) => {
      console.error('eventsink: giving up after repeated failures, exiting for a restart', error);
      process.exit(1);
    }),
  );
  console.log('eventsink: consuming GELDAR_EVENTS');

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    await consumer.stop();
    telemetry?.stop();
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
