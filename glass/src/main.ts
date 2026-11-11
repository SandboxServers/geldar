/** Glass entry point: `node src/main.ts`. Binds to 127.0.0.1 and refuses any other address. */
import { loadGlassConfig } from './config.ts';
import type { FeedSource } from './kino/relay.ts';
import { loadKinoEnv } from './kino/wiring.ts';
import { buildGlass } from './server.ts';

const config = loadGlassConfig();
// Kino is off unless GELDAR_KINO_ENABLED is 1 or true. Off: no NATS connection, no route, no page.
const kinoEnv = loadKinoEnv();
let feed: (FeedSource & { close(): Promise<void> }) | undefined;
// natsFeed never rejects: if NATS is down or the kino user is missing, Kino stays disabled (logged) and
// reconnects in the background; the Thought Stream and everything else start regardless.
if (kinoEnv.enabled) {
  const { natsFeed } = await import('./kino/nats-feed.ts');
  feed = natsFeed({
    url: kinoEnv.natsUrl,
    shard: kinoEnv.shard,
    user: process.env.GELDAR_NATS_USER,
    passwordFile: process.env.GELDAR_NATS_PASSWORD_FILE,
  });
}
const { server, close } = buildGlass(config, feed, kinoEnv.otlpEndpoint);

server.listen(config.port, config.host, () => {
  console.log(`glass listening on ${config.host}:${config.port}${feed ? ' (kino on)' : ''}`);
});

/** Idempotent: a second signal is a no-op, so the pool is ended once. */
function stop(): void {
  close();
  void feed?.close().catch(() => {});
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
