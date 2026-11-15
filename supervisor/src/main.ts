// The supervisor's process entry (C7-03b5). It answers the control subjects of its shard, runs the policy in
// service.ts over Postgres, and reaches Body containers only through the host body helper over NATS. It holds no
// Docker socket (decision 0260). Config and secrets come from the environment and secret files; nothing logs a value.

import { connectNats } from '@geldar/contract/nats';
import pg from 'pg';
import { buildSupervisorDeps } from './composition.ts';
import { loadSupervisorConfig } from './config.ts';
import { createHelperRuntime, natsHelperRequest } from './helper-client.ts';
import { unexpectedEndLine } from './lifecycle.ts';
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
// An idle client's error (for example a Postgres restart) names itself only; without a listener it would crash.
pool.on('error', (error) => console.error(`supervisor: database pool error (${error.name})`));
const nc = await connectNats({ name: 'geldar-supervisor', servers: config.natsServers });

const runtime = createHelperRuntime({
  shard: config.shard,
  request: natsHelperRequest(nc),
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

let stopping = false;
// Declared before the signal handlers so a signal during connect cannot reach it in its dead zone.
let served: Promise<void> = Promise.resolve();

// A second signal is a no-op. The drain ends the subscription; serveCtl then waits for in-flight answers, and only
// after that does the pool close and the process exit.
const stop = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  try {
    await nc.drain();
    await served;
    await pool.end();
    process.exit(0);
  } catch {
    console.error('supervisor: shutdown failed');
    process.exit(1);
  }
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());

console.log(`supervisor listening shard=${config.shard}`);
served = serveCtl({ wire, shard: config.shard, supervisor, stats });
await served;
// The subscription ended. During a stop that is the drain; otherwise the process would stay up answering nothing.
const ended = unexpectedEndLine(stopping, stats);
if (ended !== null) {
  console.error(ended);
  process.exit(1);
}
