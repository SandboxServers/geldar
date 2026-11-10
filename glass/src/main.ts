/** Glass entry point: `node src/main.ts`. Binds to 127.0.0.1 and refuses any other address. */
import { loadGlassConfig } from './config.ts';
import { buildGlass } from './server.ts';

const config = loadGlassConfig();
const { server, hub, pool } = buildGlass(config);

server.listen(config.port, config.host, () => {
  console.log(`glass listening on ${config.host}:${config.port}`);
});

function stop(): void {
  hub.close();
  server.close();
  void pool.end();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
