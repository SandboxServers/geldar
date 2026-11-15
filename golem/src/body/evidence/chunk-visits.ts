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
/** A chunk whose publish has failed this many times is given up on for the run. */
const MAX_PUBLISH_ATTEMPTS = 3;

/**
 * Emits one `chunk_visited` WorldEvent the first time this run enters a chunk in a dimension.
 * The key is the life, the dimension and the chunk index; the event id is derived from that key
 * alone, so a restart that walks a known chunk again produces the same `source_event_id`. A chunk
 * that cannot be recorded is logged once and not retried on every move: an invalid envelope or a
 * failing clock gives up at once, and a failing publish gives up after MAX_PUBLISH_ATTEMPTS. This
 * runs inside mineflayer's move event, so nothing here throws into the physics tick. Returns
 * stop(), which removes the move listener and forgets the known chunks.
 */
export function watchChunkVisits(options: ChunkWatchOptions): () => void {
  const { bot, shard, lifeId, tick, publish, now = () => new Date(), log } = options;
  const maxKnown = options.maxKnown ?? DEFAULT_MAX_KNOWN;
  /** Chunks seen this run, and chunks given up on. */
  const known = new Set<string>();
  /** Failed publish attempts so far, for chunks not yet given up on. */
  const failedPublishes = new Map<string, number>();

  const safeLog = (line: string): void => {
    try {
      log(line);
    } catch {
      // A logger that throws is not allowed to reach the physics tick.
    }
  };

  /** Stops trying this chunk for the run, with one log line saying why. */
  const giveUp = (key: string, reason: string): void => {
    known.add(key);
    failedPublishes.delete(key);
    safeLog(`chunk visit ${key} dropped: ${reason}`);
  };

  const recordFailure = (key: string, error: unknown): void => {
    known.delete(key);
    const attempts = (failedPublishes.get(key) ?? 0) + 1;
    if (attempts >= MAX_PUBLISH_ATTEMPTS) {
      giveUp(key, `publish failed ${attempts} times: ${String(error)}`);
      return;
    }
    failedPublishes.set(key, attempts);
    safeLog(
      `chunk visit ${key} not published (attempt ${attempts} of ${MAX_PUBLISH_ATTEMPTS}): ${String(error)}`,
    );
  };

  /** The chunk stays marked known while the publish is in flight; a failure unmarks it. */
  const publishOnce = (key: string, event: WorldEvent): void => {
    let result: unknown;
    try {
      result = publish(event);
    } catch (error) {
      recordFailure(key, error);
      return;
    }
    if (result instanceof Promise) {
      void result.then(
        () => failedPublishes.delete(key),
        (error: unknown) => recordFailure(key, error),
      );
    } else {
      failedPublishes.delete(key);
    }
  };

  const onMove = (): void => {
    let key: string | undefined;
    try {
      const position = bot.entity?.position;
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return;
      const dimension = String(bot.game?.dimension ?? '');
      const cx = Math.floor(position.x / CHUNK_SIZE);
      const cz = Math.floor(position.z / CHUNK_SIZE);
      key = `${dimension}:${cx}:${cz}`;
      if (known.has(key)) return;

      const worldTick = tick();
      const payload = { life_id: lifeId, dimension, cx, cz, tick: worldTick };
      const check = validateChunkVisitedPayload(payload);
      if (!check.ok) {
        giveUp(key, `not recorded: ${check.errors.join('; ')}`);
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
        giveUp(key, `not recorded: ${whole.errors.join('; ')}`);
        return;
      }
      if (known.size >= maxKnown) {
        known.clear();
        failedPublishes.clear();
      }
      known.add(key);
      publishOnce(key, event);
    } catch (error) {
      if (key === undefined) safeLog(`chunk visit not recorded: ${String(error)}`);
      else giveUp(key, `not recorded: ${String(error)}`);
    }
  };

  bot.on('move', onMove);
  return () => {
    bot.removeListener('move', onMove);
    known.clear();
    failedPublishes.clear();
  };
}
