import pg from 'pg';
import { signOutCookies } from './account.ts';
import { accountDeleteDeps, accountDeleteRoutes } from './api/account-data-delete.ts';
import { loadConfig } from './config.ts';
import { dbUrl } from './db-url.ts';
import { mountBodyApi, productionBodyWiring } from './nats-body.ts';
import { PgStore } from './pg-store.ts';
import { productionApi } from './production-api.ts';
import { microsoftProvider } from './providers.ts';
import { createRegisterServer } from './server.ts';

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
const accountDelete = accountDeleteDeps(store, body.link, signOutCookies());
const server = createRegisterServer({
  config,
  store,
  sessions: store,
  providers: { microsoft: microsoftProvider(config.microsoft) },
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  log,
  accountDelete,
  api: mountBodyApi(productionApi({ db, store, tokenPepper: config.tokenPepper, log }), {
    routes: [...body.routes, ...accountDeleteRoutes(accountDelete)],
  }),
});
server.listen(config.port, config.host, () => {
  log(`register listening killSwitch=${config.killSwitch}`);
});
