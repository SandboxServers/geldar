/** Glass entry point: `node src/main.ts`. Binds to 127.0.0.1 and refuses any other address. */
import { loadGlassConfig } from './config.ts';
import { buildGlass } from './server.ts';

const config = loadGlassConfig();
const { server, close } = buildGlass(config);

server.listen(config.port, config.host, () => {
  console.log(`glass listening on ${config.host}:${config.port}`);
});

/** Idempotent: a second signal is a no-op, so the pool is ended once. */
function stop(): void {
  close();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
