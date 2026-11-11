import { loadConfig } from './config.ts';
import { dbUrl } from './db-url.ts';
import { PgStore } from './pg-store.ts';
import { discordProvider, githubProvider } from './providers.ts';
import { createRegisterServer } from './server.ts';

const config = loadConfig(process.env);
const store = new PgStore(dbUrl(process.env), {
  shard: config.shard,
  startCredits: config.startCredits,
});
const server = createRegisterServer({
  config,
  store,
  providers: { github: githubProvider(config.github), discord: discordProvider(config.discord) },
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  log: (line) => console.log(line),
});
server.listen(config.port, config.host, () => {
  console.log(`register listening killSwitch=${config.killSwitch}`);
});
