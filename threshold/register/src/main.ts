import pg from 'pg';
import { loadConfig } from './config.ts';
import { dbUrl } from './db-url.ts';
import { productionBodyWiring } from './nats-body.ts';
import { PgStore } from './pg-store.ts';
import { productionApi } from './production-api.ts';
import { providersFor } from './providers.ts';
import { createRegisterServer } from './server.ts';
import { mountOwnerApi } from './skin-wiring.ts';

const config = loadConfig(process.env);
const connection = dbUrl(process.env);
const store = new PgStore(connection, { shard: config.shard });
// The owner API goes through the same geldar_register role; a second small pool keeps it apart from sign-in.
const db = new pg.Pool({ connectionString: connection, max: 2 });
const log = (line: string) => console.log(line);
// The body routes mount only with NATS configured (C7-04c2); without it they answer 404 and the start is unaffected.
// The retire route (C7-04d-mount) mounts with them, on the same slot and link, and uses the store's retirePlayer.
const body = productionBodyWiring(config, store, log);
// The account delete (C7-09a) mounts always: its body stop uses the body link, and is a no-op without NATS.
// mountAccountDelete gives the page action its deps and appends the delete route to the body routes.
// The skin upload routes (C7-13a) mount on the owner API over the same pool, inside mountOwnerApi (skin-wiring.ts).
const { accountDelete, api } = mountOwnerApi(
  store,
  body,
  productionApi({ db, store, tokenPepper: config.tokenPepper, log }),
  db,
  log,
);
const server = createRegisterServer({
  config,
  store,
  sessions: store,
  providers: providersFor(config),
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  log,
  accountDelete,
  api,
});
// The gate (signup-gate.ts) can hold the switch on after REGISTER_KILL_SWITCH=false; say so, since the env alone looks open.
if (process.env.REGISTER_KILL_SWITCH === 'false' && config.killSwitch) {
  log(
    'register kill switch held on: terms version not in APPROVED_TERMS_VERSIONS (signup-gate.ts)',
  );
}
server.listen(config.port, config.host, () => {
  log(`register listening killSwitch=${config.killSwitch}`);
});
