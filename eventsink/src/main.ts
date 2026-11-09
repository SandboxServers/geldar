/** Entry point: connect to Postgres and NATS, run the consumer, drain on SIGINT/SIGTERM. */
import { connect } from '@nats-io/transport-node';
import pg from 'pg';
import { loadConfig } from './config.ts';
import { startConsumer } from './consumer.ts';
import { pgEventWriter } from './writer.ts';

const config = loadConfig();
const pool = new pg.Pool({ ...config.pg, max: 2 });
const nc = await connect({ servers: config.natsUrl, name: 'eventsink', maxReconnectAttempts: -1 });
const consumer = await startConsumer(nc, pgEventWriter(pool), config);
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
