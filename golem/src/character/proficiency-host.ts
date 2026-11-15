// AN-12a: the host's proficiency cache for one life. It is built and started only when the life's sheet comes from
// config; off and the standard fallback build no cache and send no request. The host's NATS connection is the
// transport, and each reconnect refreshes the cache.
import type { LifeCharacter } from './character-config.ts';
import { ProficiencyCache, type StateTransport } from './proficiency-cache.ts';

/** The part of a NATS connection the cache needs: core request and subscribe, and the status stream. */
export interface StateNats {
  request(
    subject: string,
    data: Uint8Array,
    opts: { timeout: number },
  ): Promise<{ data: Uint8Array }>;
  subscribe(
    subject: string,
    opts: { callback: (err: unknown, msg: { data: Uint8Array }) => void },
  ): { unsubscribe(): void };
  status(): AsyncIterable<{ type: string }>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The cache's transport over a NATS connection. A message that arrives with an error is not delivered. */
export function natsStateTransport(nc: Pick<StateNats, 'request' | 'subscribe'>): StateTransport {
  return {
    async request(subject, body, timeoutMs) {
      const msg = await nc.request(subject, encoder.encode(body), { timeout: timeoutMs });
      return decoder.decode(msg.data);
    },
    subscribe(subject, onMessage) {
      const sub = nc.subscribe(subject, {
        callback: (err, msg) => {
          if (!err) onMessage(decoder.decode(msg.data));
        },
      });
      return () => sub.unsubscribe();
    },
  };
}

export interface ProficiencyHostOptions {
  nc: StateNats;
  shard: string;
  lifeId: string;
  character: LifeCharacter | undefined;
  log: (line: string) => void;
}

/**
 * The life's started cache, or undefined when no cache is wanted: the sheet is not from config, or the config's
 * `proficiency.enabled` is false, or the life id is not a valid subject token (logged once, the Body runs without
 * a cache). The caller stops it on shutdown. A reconnect asks for a refresh; the status loop ends when the
 * connection closes.
 */
export function startProficiency(options: ProficiencyHostOptions): ProficiencyCache | undefined {
  const { nc, shard, lifeId, character, log } = options;
  if (character?.source !== 'config' || !character.config.proficiency.enabled) return undefined;
  let cache: ProficiencyCache;
  try {
    cache = new ProficiencyCache({
      transport: natsStateTransport(nc),
      shard,
      lifeId,
      thresholds: character.config.proficiency.thresholds,
      log,
    });
  } catch {
    log('proficiency cache not built: the shard or life id is not a valid subject token');
    return undefined;
  }
  void cache.start();
  void (async () => {
    try {
      for await (const status of nc.status()) {
        if (status.type === 'reconnect') void cache.refresh();
      }
    } catch {
      // the status stream ends with the connection; nothing to refresh after that
    }
  })();
  return cache;
}
