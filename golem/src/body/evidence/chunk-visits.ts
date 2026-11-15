// AN-09b: the Body's first-visit evidence. Owned by AN-09b; the signatures are the AN-S0 scaffold.
import { validateChunkVisitedPayload, validateWorldEvent, type WorldEvent } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { eventIdFor } from '../derived-id.ts';

export interface ChunkWatchOptions {
  bot: Bot;
  shard: string;
  lifeId: string;
  tick: () => number;
  publish: (event: WorldEvent) => void;
  now?: () => Date;
  log: (l: string) => void;
  maxKnown?: number /* default 20000 */;
}

/** Minecraft ticks in one world day. */
const TICKS_PER_DAY = 24_000;
/** Chunks are 16 blocks on each horizontal axis. */
const CHUNK_SIZE = 16;
const DEFAULT_MAX_KNOWN = 20_000;

/**
 * Emits one `chunk_visited` WorldEvent the first time this run enters a chunk in a dimension.
 * The key is the life, the dimension and the chunk index; the event id is derived from that key
 * alone, so a restart that walks a known chunk again produces the same `source_event_id`. Returns
 * stop(), which removes the move listener and forgets the known chunks.
 */
export function watchChunkVisits(options: ChunkWatchOptions): () => void {
  const { bot, shard, lifeId, tick, publish, now = () => new Date(), log } = options;
  const maxKnown = options.maxKnown ?? DEFAULT_MAX_KNOWN;
  const known = new Set<string>();

  const onMove = (): void => {
    const position = bot.entity?.position;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return;
    const dimension = String(bot.game?.dimension ?? '');
    const cx = Math.floor(position.x / CHUNK_SIZE);
    const cz = Math.floor(position.z / CHUNK_SIZE);
    const key = `${dimension}:${cx}:${cz}`;
    if (known.has(key)) return;

    const worldTick = tick();
    const payload = { life_id: lifeId, dimension, cx, cz, tick: worldTick };
    const check = validateChunkVisitedPayload(payload);
    if (!check.ok) {
      log(`chunk visit ${key} not recorded: ${check.errors.join('; ')}`);
      return;
    }
    const event: WorldEvent = {
      source_event_id: eventIdFor(`chunk_visited:${lifeId}:${dimension}:${cx}:${cz}`),
      at: now().toISOString(),
      shard,
      world_day: Math.floor(worldTick / TICKS_PER_DAY),
      world_tick: worldTick,
      type: 'chunk_visited',
      agent_id: lifeId,
      payload: payload as WorldEvent['payload'],
    };
    const whole = validateWorldEvent(event);
    if (!whole.ok) {
      log(`chunk visit ${key} not recorded: ${whole.errors.join('; ')}`);
      return;
    }
    if (known.size >= maxKnown) known.clear();
    try {
      publish(event);
    } catch (error) {
      log(`chunk visit ${key} not published: ${String(error)}`);
      return;
    }
    known.add(key);
  };

  bot.on('move', onMove);
  return () => {
    bot.removeListener('move', onMove);
    known.clear();
  };
}
