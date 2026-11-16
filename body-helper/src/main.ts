// The helper's entry point (C7-03c1). It reads the config (env names and root-only secret files), connects to NATS as
// the `helper` user, serves the four body subjects, runs the stray sweep (BH-6: it removes orphans only when managed
// Bodies are on), and shuts down on SIGTERM or SIGINT. It logs names and counts only: never a password, a template or
// a request body.
import { readFileSync, statSync } from 'node:fs';
import { connectNats, exitOnFatalClose } from '@geldar/contract/nats';
import { Pool } from 'pg';
import { createDockerEngine, socketRequest } from './engine.ts';
import { type HelperConfig, loadHelperConfig } from './helperConfig.ts';
import { type HelperWire, newHelperStats, serveHelper } from './listener.ts';
import { rosterFromQuery } from './roster.ts';
import { createBodyHelper, runLifeRemove } from './service.ts';
import { shutdownHelper, shutdownOnce } from './shutdown.ts';
import { orphanRemovalFor, startSweep } from './sweep.ts';

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
  // The names whose stop timed out and is not confirmed: the helper adds and clears them, the sweep reports them.
  const stopTimeouts = new Set<string>();
  // The names of a late start that could not be removed and still runs: the helper adds and clears them, the sweep reports them.
  const orphanStarts = new Set<string>();
  const template = {
    image: config.image,
    wiring: config.wiring,
    limits: config.limits,
    managed: config.managed,
  };
  // BH-6: the sweep removes an orphaned managed Body only when managed Bodies are on; otherwise it reports only.
  const orphanRemoval = orphanRemovalFor(config.managed.enabled, (lifeId: string) =>
    runLifeRemove(engine, template, lifeId),
  );
  const handle = createBodyHelper({
    roster,
    engine,
    cap: config.cap,
    template,
    requestDeadlineMs: config.requestDeadlineMs,
    stopTimeouts,
    orphanStarts,
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
  const stopSweep = startSweep(
    { engine, roster, stopTimeouts, orphanStarts, removal: orphanRemoval, audit: log },
    config.sweepMinutes,
  );
  const stats = newHelperStats();
  const serving = serveHelper({ wire, shard: config.shard, handle, stats });
  log(
    `body-helper started shard=${config.shard} cap=${config.cap} sweep_minutes=${config.sweepMinutes}`,
  );

  // Order: end the subscriptions (no new request), await the in-flight answers (capped), then close the connection
  // and the pool. See shutdown.ts.
  // Once: a second signal during the shutdown gets the same run, so nothing closes twice.
  const shutdown = shutdownOnce(async () => {
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
  });
  // `on`, not `once`: a second signal reaches the guard and is ignored, rather than the default kill.
  process.on('SIGTERM', () => void shutdown().catch(() => process.exit(1)));
  process.on('SIGINT', () => void shutdown().catch(() => process.exit(1)));
  await serving;
}

void main();
