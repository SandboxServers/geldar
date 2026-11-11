import { loadConfig } from './config.ts';
import { dbUrl } from './db-url.ts';
import { PgStore } from './pg-store.ts';
import { microsoftProvider } from './providers.ts';
import { createRegisterServer } from './server.ts';

const config = loadConfig(process.env);
const store = new PgStore(dbUrl(process.env), { shard: config.shard });
const server = createRegisterServer({
  config,
  store,
  providers: { microsoft: microsoftProvider(config.microsoft) },
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  log: (line) => console.log(line),
});
server.listen(config.port, config.host, () => {
  console.log(`register listening killSwitch=${config.killSwitch}`);
});
