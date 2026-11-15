// The supervisor's process entry (C7-03b5). It loads the config, connects to Postgres and NATS, and hands both to
// runSupervisor (run.ts), which serves the control subjects of its shard and runs the policy in service.ts. Bodies
// are reached only through the host body helper over NATS. It holds no Docker socket (decision 0260). Config and
// secrets come from the environment and secret files; nothing logs a value.

import { connectNats } from '@geldar/contract/nats';
import pg from 'pg';
import { buildSupervisorDeps } from './composition.ts';
import { loadSupervisorConfig } from './config.ts';
import { runSupervisor } from './run.ts';
import { createSupervisor } from './service.ts';

const config = (() => {
  try {
    return loadSupervisorConfig(process.env);
  } catch (error) {
    console.error(`supervisor: ${error instanceof Error ? error.message : 'configuration failed'}`);
    return process.exit(1);
  }
})();

const pool = new pg.Pool({ ...config.db, user: 'geldar_supervisor', max: 4 });
// An idle client's error (for example a Postgres restart) names itself only; without a listener it would crash.
pool.on('error', (error) => console.error(`supervisor: database pool error (${error.name})`));
const nc = await connectNats({ name: 'geldar-supervisor', servers: config.natsServers });

const query = async (text: string, params?: unknown[]) => {
  const result = await pool.query(text, params);
  return { rows: result.rows as Record<string, unknown>[] };
};

const run = runSupervisor({
  shard: config.shard,
  nc,
  pool: { end: () => pool.end() },
  buildSupervisor: (runtime) =>
    createSupervisor(
      buildSupervisorDeps({
        query,
        runtime,
        log: (info) => console.error(`supervisor: audit lost (${info.action}, ${info.code})`),
      }),
    ),
  log: (line) => console.error(line),
  exit: (code) => process.exit(code),
});

process.on('SIGTERM', () => void run.stop());
process.on('SIGINT', () => void run.stop());
await run.ended;
