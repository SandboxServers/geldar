// The supervisor's process entry (C7-03b5). It answers the control subjects of its shard, runs the policy in
// service.ts over Postgres, and reaches Body containers only through the host body helper over NATS. It holds no
// Docker socket (decision 0260). Config and secrets come from the environment and secret files; nothing logs a value.

import { connectNats } from '@geldar/contract/nats';
import pg from 'pg';
import { buildSupervisorDeps } from './composition.ts';
import { loadSupervisorConfig } from './config.ts';
import {
  createHelperRuntime,
  HELPER_TIMEOUT_MS,
  HelperFailure,
  isNatsTimeout,
} from './helper-client.ts';
import { type CtlStats, type CtlWire, serveCtl } from './nats.ts';
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
const nc = await connectNats({ name: 'geldar-supervisor', servers: config.natsServers });

const runtime = createHelperRuntime({
  shard: config.shard,
  // The library's own timeout closes the inbox; a library timeout is the helper's `timeout` kind, not `unavailable`.
  request: async (subject, payload) => {
    try {
      const reply = await nc.request(subject, payload, { timeout: HELPER_TIMEOUT_MS });
      return reply.data;
    } catch (error) {
      if (isNatsTimeout(error)) throw new HelperFailure('timeout');
      throw error;
    }
  },
});

const supervisor = createSupervisor(
  buildSupervisorDeps({
    query: async (text, params) => {
      const result = await pool.query(text, params);
      return { rows: result.rows as Record<string, unknown>[] };
    },
    runtime,
    log: (info) => console.error(`supervisor: audit lost (${info.action}, ${info.code})`),
  }),
);

const wire: CtlWire = {
  subscribe: (subject) => nc.subscribe(subject),
  respond: async (inbox, data) => {
    nc.publish(inbox, data);
  },
};
const stats: CtlStats = {
  dropped: 0,
  invalid: 0,
  busy: 0,
  handlerFailed: 0,
  replyFailed: 0,
  subscribeFailed: 0,
};

const stop = async (): Promise<void> => {
  await nc.drain();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());

console.log(`supervisor listening shard=${config.shard}`);
await serveCtl({ wire, shard: config.shard, supervisor, stats });
