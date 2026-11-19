import type { WorldEvent } from '@geldar/contract';
import type { Domain } from '@geldar/psyche';
import { awardsFor as baseAwardsFor, EVIDENCE_KEY_MAX, type XpAward } from './awards.ts';

/**
 * The length of one exchange window, in world ticks, counted from the line that opens it.
 * PROVISIONAL: an owner parameter that is not measured (AN-49 worknote). The window index in the
 * key is floor(openTick / EXCHANGE_WINDOW_TICKS).
 */
export const EXCHANGE_WINDOW_TICKS = 600;

/** A pair that has been idle for this many windows is forgotten, its lines and window too. */
const EXPIRY_WINDOWS = 2;

/** The bounds the speech schema allows (speech-event.schema.json). */
const NAME_MAX = 32;
const TEXT_MAX = 256;

/** One pair of lives: each speaker's last text, and the open window (if any). */
interface Pair {
  lastText: Map<string, string>;
  opener: string | null;
  openTick: number;
  qualified: boolean;
  lastTick: number;
}

interface Line {
  life: string;
  from: string;
  text: string;
  own: boolean;
}

/** The speech payload, or null when the event is not a well-formed speech line. */
function lineOf(event: WorldEvent): Line | null {
  const payload =
    typeof event.payload === 'object' && event.payload !== null
      ? (event.payload as Record<string, unknown>)
      : null;
  if (!payload || typeof event.agent_id !== 'string' || event.agent_id.length === 0) return null;
  const { from, text, distance, own } = payload;
  if (typeof from !== 'string' || from.length < 1 || from.length > NAME_MAX) return null;
  if (typeof text !== 'string' || text.length > TEXT_MAX) return null;
  if (typeof own !== 'boolean') return null;
  if (distance !== null && (typeof distance !== 'number' || distance < 0)) return null;
  return { life: event.agent_id, from, text, own };
}

/** Insert or refresh a key, keeping the map at most `max` entries (oldest out first). */
function remember<V>(map: Map<string, V>, key: string, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

/**
 * Social awards for a bilateral conversation. A speech line the Body heard as non-own binds the
 * speaker's in-game name to the life that said it (its own line). A window opens at the first
 * line of a pair (the opener's line, heard by the other side). It qualifies at the second
 * speaker's first line, heard by the opener's Body, and then both lives get one `social` award
 * with key `exch:<lifeLow>:<lifeHigh>:<windowIndex>`. Monologue, one-way overheard speech, a
 * repeated line (identical text from the same speaker in the pair), and a line outside the window
 * do not qualify. Everything else (give, craft, and so on) is `awardsFor` from ./awards.ts.
 *
 * Limits, documented not fixed: the state is in memory, so a restart loses an open window and the
 * name bindings; the pair and name maps are LRU-bounded at `maxPairs`; the speech payload carries
 * no addressee, so a reply heard by a third party does not count for that party.
 */
export class ExchangeTracker {
  private readonly maxPairs: number;
  private readonly pairs = new Map<string, Pair>();
  private readonly lives = new Map<string, string>();

  constructor(maxPairs = 512) {
    this.maxPairs = maxPairs;
  }

  /** The awards one WorldEvent gives: the stateless awards plus any exchange award it completes. */
  awardsFor(event: WorldEvent): XpAward[] {
    const base = baseAwardsFor(event);
    const line = event.type === 'speech' ? lineOf(event) : null;
    if (!line) return base;
    return [...base, ...this.speechAwards(line, event)];
  }

  private speechAwards(line: Line, event: WorldEvent): XpAward[] {
    if (line.own) {
      remember(this.lives, line.from, line.life, this.maxPairs);
      return [];
    }
    const speaker = this.lives.get(line.from);
    if (speaker === undefined || speaker === line.life) return [];
    return this.hear(line.life, speaker, line.text, event);
  }

  private hear(hearer: string, speaker: string, text: string, event: WorldEvent): XpAward[] {
    const [low, high] = hearer < speaker ? [hearer, speaker] : [speaker, hearer];
    const id = `${low}|${high}`;
    const tick = event.world_tick;
    const existing = this.pairs.get(id);
    const fresh = !existing || tick - existing.lastTick >= EXPIRY_WINDOWS * EXCHANGE_WINDOW_TICKS;
    const pair: Pair = fresh
      ? { lastText: new Map(), opener: null, openTick: tick, qualified: false, lastTick: tick }
      : existing;
    remember(this.pairs, id, pair, this.maxPairs);
    pair.lastTick = tick;
    // A repeated line (the same text from the same speaker) opens nothing and qualifies nothing.
    if (pair.lastText.get(speaker) === text) return [];
    pair.lastText.set(speaker, text);
    if (pair.opener === null || tick - pair.openTick >= EXCHANGE_WINDOW_TICKS) {
      pair.opener = speaker;
      pair.openTick = tick;
      pair.qualified = false;
      return [];
    }
    if (speaker === pair.opener || pair.qualified) return [];
    pair.qualified = true;
    return this.bothAwards(low, high, pair.openTick, event);
  }

  private bothAwards(low: string, high: string, openTick: number, event: WorldEvent): XpAward[] {
    const evidenceKey = `exch:${low}:${high}:${Math.floor(openTick / EXCHANGE_WINDOW_TICKS)}`;
    if (evidenceKey.length > EVIDENCE_KEY_MAX) return [];
    const domain: Domain = 'social';
    return [low, high].map((lifeId) => ({
      lifeId,
      domain,
      evidenceKey,
      sourceEventId: event.source_event_id,
      worldTick: event.world_tick,
    }));
  }
}
