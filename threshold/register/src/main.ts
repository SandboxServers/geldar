import { loadConfig } from './config.ts';
import { discordProvider, githubProvider } from './providers.ts';
import { createRegisterServer } from './server.ts';

const config = loadConfig(process.env);
const server = createRegisterServer({
  config,
  providers: { github: githubProvider(config.github), discord: discordProvider(config.discord) },
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  log: (line) => console.log(line),
});
server.listen(config.port, config.host, () => {
  console.log(`register listening killSwitch=${config.killSwitch}`);
});
