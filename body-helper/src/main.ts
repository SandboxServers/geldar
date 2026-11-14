// The helper's entry point (C7-03c1). It reads the config (env names and root-only secret files), connects to NATS as
// the `helper` user, serves the four body subjects, runs the report-only stray sweep, and shuts down on SIGTERM or
// SIGINT. It logs names and counts only: never a password, a template or a request body.
import { readFileSync, statSync } from 'node:fs';
import { connectNats, exitOnFatalClose } from '@geldar/contract/nats';
import { Pool } from 'pg';
import { createDockerEngine, socketRequest } from './engine.ts';
import { type HelperConfig, loadHelperConfig } from './helperConfig.ts';
import { type HelperWire, newHelperStats, serveHelper } from './listener.ts';
import { rosterFromQuery } from './roster.ts';
import { createBodyHelper } from './service.ts';
import { startSweep } from './sweep.ts';

const log = (line: string) => console.log(line);
/** How long a shutdown waits for in-flight requests before it exits anyway. */
const SHUTDOWN_WAIT_MS = 10_000;

function loadConfig(): HelperConfig {
  try {
    return loadHelperConfig(process.env, {
      stat: (path) => statSync(path),
      read: (path) => readFileSync(path, 'utf8'),
    });
  } catch (error) {
    console.error(`body-helper: ${(error as Error).message}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const nc = await connectNats(
    {
      name: 'body-helper',
      servers: config.natsUrl,
      user: config.natsUser,
      pass: config.natsPassword,
    },
    exitOnFatalClose,
  );
  const pool = new Pool({ ...config.pg, max: 2 });
  pool.on('error', () => log('body-helper: database pool error'));
  const engine = createDockerEngine(socketRequest(config.dockerSocket));
  const roster = rosterFromQuery((sql, values) => pool.query(sql, [...values]));
  const handle = createBodyHelper({
    roster,
    engine,
    cap: config.cap,
    template: { image: config.image, wiring: config.wiring, limits: config.limits },
    audit: log,
  });
  const wire: HelperWire = {
    subscribe: (subject) => nc.subscribe(subject),
    respond: async (inbox, data) => {
      nc.publish(inbox, data);
    },
  };
  const stopSweep = startSweep({ engine, roster, audit: log }, config.sweepMinutes);
  const stats = newHelperStats();
  const serving = serveHelper({ wire, shard: config.shard, handle, stats });
  log(
    `body-helper started shard=${config.shard} cap=${config.cap} sweep_minutes=${config.sweepMinutes}`,
  );

  const shutdown = async () => {
    stopSweep();
    await nc.drain().catch(() => undefined);
    // In-flight requests finish (their Engine calls and replies) before the pool closes; a stuck one is cut at the wait.
    await Promise.race([serving, new Promise((done) => setTimeout(done, SHUTDOWN_WAIT_MS))]);
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  await serving;
}

void main();
