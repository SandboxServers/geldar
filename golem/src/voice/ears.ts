import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import type { Ears } from '../mind-link/senses.ts';
import { isAddressed } from './addressed.ts';
import type { SpeechEvents } from './speech-event.ts';
import { cleanLine, MAX_LINE_CHARS, MAX_NAME_CHARS } from './text.ts';

/** How many heard lines the ring keeps (the snapshot cap). */
export const HEARD_RING_SIZE = 50;
/** The same line from the same speaker within this many wall ms is one line heard by two paths. */
const DUPLICATE_WINDOW_MS = 1_000;
/** Longest raw packet text written to the log. */
const RAW_LOG_CHARS = 600;

/** The part of the executor the ears use. */
export interface AddressedListener {
  notifyAddressed(from: string): Promise<boolean>;
}

/** What the ears need. */
export interface BotEarsOptions {
  /** The Body's own username: its lines are never heard. */
  username: string;
  /** The configured display name, also taken as a name for the Body. */
  displayName?: string;
  executor: AddressedListener;
  events: SpeechEvents;
  /** Blocks between a speaker and the Body, or null when unknown. */
  distanceTo?: (from: string) => number | null;
  /** Wall clock in ms; tests pass their own. */
  now?: () => number;
  log?: (line: string) => void;
}

interface HeardLine {
  from: string;
  text: string;
  atMs: number;
}

/**
 * The Body's ears: player chat only, never system messages and never the Body's own lines. Keeps a
 * ring of the last 50 lines for the snapshot (`heard`), publishes each line as a `speech` event and
 * tells the executor when the Body is named.
 *
 * Chat on 26.1 offline mode reaches Mineflayer 4.39 as a raw `player_chat` packet (`senderUuid`,
 * `plainMessage`, `networkName`) and as the derived `chat` event; both are read and a line that
 * arrives by both is kept once. Everything read from a packet is untrusted and parsed defensively.
 */
export class BotEars implements Pick<Ears, 'heard'> {
  private readonly ring: HeardLine[] = [];
  private logged = false;
  private readonly names: string[];

  private readonly opts: BotEarsOptions;

  constructor(opts: BotEarsOptions) {
    this.opts = opts;
    this.names = [opts.username, ...(opts.displayName ? [opts.displayName] : [])];
  }

  /** Starts listening on a bot. Returns the function that stops it. */
  attach(bot: Bot): () => void {
    const client = bot._client as unknown as {
      on(event: string, fn: (data: unknown) => void): void;
      off(event: string, fn: (data: unknown) => void): void;
    };
    const onPacket = (data: unknown): void => this.onPlayerChatPacket(bot, data);
    const onChat = (username: unknown, message: unknown): void => {
      if (typeof username === 'string' && typeof message === 'string') {
        this.hear(username, message);
      }
    };
    client.on('playerChat', onPacket);
    bot.on('chat', onChat);
    return () => {
      client.off('playerChat', onPacket);
      bot.off('chat', onChat);
    };
  }

  heard(): Snapshot['heard'] {
    const now = this.now();
    return this.ring.map((line) => ({
      from: line.from,
      text: line.text,
      age_seconds: Math.max(0, Math.floor((now - line.atMs) / 1000)),
    }));
  }

  /** Reads one raw `player_chat` packet: logs its shape once, then hears it if the speaker is known. */
  onPlayerChatPacket(bot: Pick<Bot, 'players' | 'player'>, data: unknown): void {
    this.logFirstPacket(data);
    if (typeof data !== 'object' || data === null) return;
    const packet = data as Record<string, unknown>;
    const text = typeof packet.plainMessage === 'string' ? packet.plainMessage : null;
    if (text === null) return;
    const uuid = typeof packet.senderUuid === 'string' ? packet.senderUuid : null;
    if (uuid !== null && uuid === bot.player?.uuid) return;
    const named = nameFromText(packet.networkName) ?? nameFromText(packet.senderName);
    const known = Object.values(bot.players ?? {}).find((p) => uuid !== null && p.uuid === uuid);
    const from = known?.username ?? named;
    if (from) this.hear(from, text);
  }

  /**
   * Takes one line of player chat. A line from the Body, from nobody or with nothing left after
   * cleaning is dropped. Otherwise it enters the ring, is published and, if it names the Body, is
   * passed to the executor.
   */
  hear(rawFrom: string, rawText: string): void {
    const from = cleanLine(rawFrom, MAX_NAME_CHARS);
    const text = cleanLine(rawText, MAX_LINE_CHARS);
    if (!from || !text) return;
    if (from.toLowerCase() === this.opts.username.toLowerCase()) return;
    const atMs = this.now();
    const twin = this.ring.some(
      (l) => l.from === from && l.text === text && atMs - l.atMs < DUPLICATE_WINDOW_MS,
    );
    if (twin) return;
    this.ring.push({ from, text, atMs });
    if (this.ring.length > HEARD_RING_SIZE) this.ring.splice(0, this.ring.length - HEARD_RING_SIZE);
    const distance = this.opts.distanceTo?.(from) ?? null;
    this.opts.events.publish({ from, text, distance, own: false });
    if (isAddressed(text, this.names)) {
      this.opts.executor.notifyAddressed(from).catch((error: unknown) => {
        this.log(`ears: notifyAddressed failed: ${String(error)}`);
      });
    }
  }

  /** Diagnostics first: the shape of the first raw chat packet, once. */
  private logFirstPacket(data: unknown): void {
    if (this.logged) return;
    this.logged = true;
    let shape: string;
    try {
      shape = JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
    } catch (error) {
      shape = `unprintable: ${String(error)}`;
    }
    this.log(`ears: first player_chat packet: ${(shape ?? 'undefined').slice(0, RAW_LOG_CHARS)}`);
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private log(line: string): void {
    (this.opts.log ?? ((l: string) => console.error(l)))(line);
  }
}

/**
 * The plain text of a chat component as a packet carries it: a string, an NBT string
 * (`{ type, value }`), or a compound or JSON object with `text` and `extra`. Null when none is found.
 */
export function nameFromText(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
      try {
        return nameFromText(JSON.parse(trimmed), depth + 1);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (typeof value !== 'object') return null;
  const object = value as Record<string, unknown>;
  const direct = object.text ?? object.value;
  const head = direct === undefined ? '' : (nameFromText(direct, depth + 1) ?? '');
  const extra = object.extra ?? (object.value as Record<string, unknown> | undefined)?.extra;
  const tail = collectList(extra, depth);
  const joined = head + tail;
  return joined === '' ? null : joined;
}

/** Joins the text of a list of components (an NBT list is `{ value: { value: [...] } }`). */
function collectList(list: unknown, depth: number): string {
  if (typeof list !== 'object' || list === null) return '';
  const inner = (list as { value?: { value?: unknown } }).value?.value ?? list;
  if (!Array.isArray(inner)) return '';
  return inner.map((part) => nameFromText(part, depth + 1) ?? '').join('');
}
