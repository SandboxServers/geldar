/** Entry point: connect to Postgres and NATS, run the consumer, drain on SIGINT/SIGTERM. */
import { connectNats } from '@geldar/contract/nats';
import pg from 'pg';
import { loadConfig } from './config.ts';
import { startConsumer } from './consumer.ts';
import { pgEventWriter } from './writer.ts';

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
const consumer = await startConsumer(nc, pgEventWriter(pool), {
  ...config,
  onFatal: (error) => {
    console.error('eventsink: giving up after repeated failures, exiting for a restart', error);
    process.exit(1);
  },
});
console.log('eventsink: consuming GELDAR_EVENTS');

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await consumer.stop();
  await nc.drain();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
