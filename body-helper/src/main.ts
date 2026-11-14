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
import { shutdownHelper } from './shutdown.ts';
import { startSweep } from './sweep.ts';

const log = (line: string) => console.log(line);

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
    requestDeadlineMs: config.requestDeadlineMs,
    audit: log,
  });
  // The helper's subscriptions, kept so a shutdown can end them before it closes the connection.
  const subs: { unsubscribe(): void }[] = [];
  const wire: HelperWire = {
    subscribe: (subject) => {
      const sub = nc.subscribe(subject);
      subs.push(sub);
      return sub;
    },
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

  // Order: end the subscriptions (no new request), await the in-flight answers (capped), then close the connection
  // and the pool. See shutdown.ts.
  const shutdown = async () => {
    await shutdownHelper({
      stopSweep,
      stopIntake: () => {
        for (const sub of subs) sub.unsubscribe();
      },
      serving,
      closeConnection: () => nc.drain(),
      closePool: () => pool.end(),
    });
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  await serving;
}

void main();
