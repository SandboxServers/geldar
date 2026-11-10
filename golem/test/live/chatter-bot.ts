/**
 * The scripted chatter bot (P0-33b, Q10, principle 1): a model-free TEST life. It is a Mineflayer bot
 * that joins the arena through the standard fixture (so it is registered in the life registry like
 * any bot), says scripted lines on cue and records what it hears. It is a test agent, not a human
 * act: every record it keeps carries `test_life: true`, and its life id says so (`ag_chatter_01`).
 * It speaks through the same `BotVoice` as a Body, so its lines have the same limits: cleaned,
 * at most `chat.max_chars`, a leading `/` refused, one line per `chat.rate_limit_seconds`.
 */
import type { WorldEvent } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import type { SayOutcome } from '../../src/mind-link/senses.ts';
import { BotEars } from '../../src/voice/ears.ts';
import { SpeechEvents } from '../../src/voice/speech-event.ts';
import { BotVoice } from '../../src/voice/voice.ts';
import { type LiveContext, withLiveBot } from './fixture.ts';

/** The chatter's life id: a LifeId, so the registry keeps it unchanged and the ingress admits it. */
export const CHATTER_LIFE_ID = 'ag_chatter_01';

/** One thing the chatter did or heard. */
export interface ChatterRecord {
  /** Always true: this record belongs to a test life, not to a player. */
  test_life: true;
  life_id: string;
  at: string;
  kind: 'said' | 'refused' | 'heard';
  /** The speaker of a `heard` record, else the chatter itself. */
  from: string;
  text: string;
  /** Why a line was refused. */
  reason?: string;
}

/** What the chatter needs. */
export interface ChatterBotOptions {
  /** `chat.rate_limit_seconds`: the least time between two lines. */
  rateLimitSeconds: number;
  /** `chat.max_chars`. */
  maxChars: number;
  /**
   * Starts silent: `say` is refused (reason `silent`, nothing sent, no speech event) until the case
   * calls `speak()`. Default false.
   */
  silent?: boolean;
  lifeId?: string;
  /** Wall clock in ms; tests pass their own. */
  now?: () => number;
  /** Waits `ms`; tests pass an instant one. */
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A `say` outcome, or the refusal of a silent chatter (nothing was sent, no speech event). */
export type ChatOutcome = SayOutcome | { status: 'refused'; reason: 'silent' };

/** The scripted chatter on one joined bot. */
export class ChatterBot {
  /** Everything said, refused and heard, oldest first. */
  readonly records: ChatterRecord[] = [];

  private readonly lifeId: string;
  private readonly voice: BotVoice;
  private readonly detach: () => void;
  private readonly opts: ChatterBotOptions;
  private silent: boolean;

  constructor(bot: Bot, opts: ChatterBotOptions) {
    this.opts = opts;
    this.silent = opts.silent ?? false;
    this.lifeId = opts.lifeId ?? CHATTER_LIFE_ID;
    const log = opts.log ?? (() => undefined);
    const events = new SpeechEvents({
      publish: (event) => this.onSpeech(event),
      shard: 'chatter',
      log,
    });
    this.voice = new BotVoice({
      username: this.lifeId,
      send: (text) => bot.chat(text),
      connected: () => bot.entity !== undefined,
      events,
      rateLimitSeconds: opts.rateLimitSeconds,
      maxChars: opts.maxChars,
      ...(opts.now ? { now: opts.now } : {}),
    });
    const ears = new BotEars({
      username: this.lifeId,
      executor: { notifyAddressed: async () => true },
      events,
      log,
    });
    this.detach = ears.attach(bot);
  }

  /**
   * Lets a silent chatter speak from now on. A case calls it once Adam has acted, so the chatter
   * does not greet him before he has a plan of his own.
   */
  speak(): void {
    this.silent = false;
  }

  /** Says one line, with the Body voice's limits. A refusal is recorded and returned, not thrown. */
  async say(text: string): Promise<ChatOutcome> {
    if (this.silent) return { status: 'refused', reason: 'silent' };
    const outcome = await this.voice.say(text);
    if (outcome.status === 'refused') {
      this.push({ kind: 'refused', from: this.lifeId, text, reason: outcome.reason });
    }
    return outcome;
  }

  /**
   * Says each line in turn, waiting out the rate limit between them; a line refused for any reason
   * other than the rate limit is returned as is. Returns one outcome per line.
   */
  async sayAll(lines: string[]): Promise<ChatOutcome[]> {
    const sleep = this.opts.sleep ?? realSleep;
    const outcomes: ChatOutcome[] = [];
    for (const [index, line] of lines.entries()) {
      if (index > 0) await sleep(this.opts.rateLimitSeconds * 1000 + 250);
      let outcome = await this.say(line);
      if (outcome.status === 'refused' && outcome.reason === 'rate_limited') {
        await sleep(this.opts.rateLimitSeconds * 1000 + 250);
        outcome = await this.say(line);
      }
      outcomes.push(outcome);
    }
    return outcomes;
  }

  /** The lines heard from other speakers, oldest first. */
  heard(): ChatterRecord[] {
    return this.records.filter((r) => r.kind === 'heard');
  }

  /** Waits (wall clock) until a heard line from `from` passes `match`; returns it or null at the deadline. */
  async waitForHeard(
    from: string,
    match: (text: string) => boolean,
    timeoutMs: number,
    pollMs = 250,
  ): Promise<ChatterRecord | null> {
    const sleep = this.opts.sleep ?? realSleep;
    const now = this.opts.now ?? Date.now;
    const deadline = now() + timeoutMs;
    for (;;) {
      const found = this.heard().find((r) => r.from === from && match(r.text));
      if (found) return found;
      if (now() >= deadline) return null;
      await sleep(pollMs);
    }
  }

  /** A one-line summary of the records, for failure messages. */
  describe(): string {
    return JSON.stringify(this.records.map((r) => `${r.kind} ${r.from}: ${r.text}`));
  }

  /** Stops listening. */
  stop(): void {
    this.detach();
  }

  private onSpeech(event: WorldEvent): void {
    const payload = event.payload as { from: string; text: string; own: boolean };
    this.push({ kind: payload.own ? 'said' : 'heard', from: payload.from, text: payload.text });
  }

  private push(entry: Omit<ChatterRecord, 'test_life' | 'life_id' | 'at'>): void {
    this.records.push({
      test_life: true,
      life_id: this.lifeId,
      at: new Date(this.opts.now?.() ?? Date.now()).toISOString(),
      ...entry,
    });
  }
}

/**
 * Runs `fn` with the chatter joined to the arena of `slot` through the standard live fixture (so the
 * life registry and the whitelist are handled there) and stops it afterwards.
 */
export async function withChatterBot(
  opts: { slot: number; rateLimitSeconds: number; maxChars: number; silent?: boolean },
  fn: (chatter: ChatterBot, ctx: LiveContext) => Promise<void>,
): Promise<void> {
  await withLiveBot({ name: CHATTER_LIFE_ID, slot: opts.slot }, async (ctx) => {
    const chatter = new ChatterBot(ctx.bot, {
      rateLimitSeconds: opts.rateLimitSeconds,
      maxChars: opts.maxChars,
      silent: opts.silent ?? false,
    });
    try {
      await fn(chatter, ctx);
    } finally {
      chatter.stop();
    }
  });
}
