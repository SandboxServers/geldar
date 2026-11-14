import pg from 'pg';
import { loadConfig } from './config.ts';
import { dbUrl } from './db-url.ts';
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
const server = createRegisterServer({
  config,
  store,
  sessions: store,
  providers: { microsoft: microsoftProvider(config.microsoft) },
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  log,
  api: productionApi({ db, store, tokenPepper: config.tokenPepper, log }),
});
server.listen(config.port, config.host, () => {
  log(`register listening killSwitch=${config.killSwitch}`);
});
