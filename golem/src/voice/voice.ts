import type { SayOutcome, Voice } from '../mind-link/senses.ts';
import type { SpeechEvents } from './speech-event.ts';
import { cleanLine, MAX_LINE_CHARS } from './text.ts';

/** Why a line was not spoken, in the Body's own words (spec 5.8). */
export type VoiceRefusal = 'empty' | 'refused_command' | 'refused_rate' | 'not_connected';

/** The result of `BotVoice.sayChecked`: the line as sent, or the reason it was not. */
export type VoiceResult =
  | { status: 'said'; text: string }
  | { status: 'refused'; reason: VoiceRefusal };

/** What the voice needs. */
export interface BotVoiceOptions {
  /** The Body's own username, the `from` of its speech events. */
  username: string;
  /** Sends one cleaned line to chat. */
  send: (text: string) => void | Promise<void>;
  /** Whether the bot is in the world. */
  connected: () => boolean;
  events: SpeechEvents;
  /** `chat.rate_limit_seconds`: the least time between two lines. */
  rateLimitSeconds: number;
  /** `chat.max_chars`, capped at the contract's 256. */
  maxChars?: number;
  /** Wall clock in ms; tests pass their own. */
  now?: () => number;
}

/**
 * The Body's voice. A line is cleaned (control characters stripped, newlines collapsed, cut to the
 * cap) before anything else; a line that starts with `/` is a command and is refused, never sent; a
 * second line inside the rate-limit window is refused, not queued. A sent line is published as a
 * `speech` event with `own: true`.
 */
export class BotVoice implements Voice {
  private lastSentAt: number | null = null;

  private readonly opts: BotVoiceOptions;

  constructor(opts: BotVoiceOptions) {
    this.opts = opts;
  }

  /** `Voice.say`: the checked result in the shared interface's words. */
  async say(text: string): Promise<SayOutcome> {
    const result = await this.sayChecked(text);
    if (result.status === 'said') return result;
    // The shared `SayRefusal` has no command case; `empty` is the nearest: nothing was sent.
    const mapped = { refused_rate: 'rate_limited', refused_command: 'empty' } as const;
    const reason =
      result.reason === 'refused_rate' || result.reason === 'refused_command'
        ? mapped[result.reason]
        : result.reason;
    return { status: 'refused', reason };
  }

  /** Speaks `text`, or says why not. Rejects only when sending to the connection fails. */
  async sayChecked(text: string): Promise<VoiceResult> {
    const max = Math.min(this.opts.maxChars ?? MAX_LINE_CHARS, MAX_LINE_CHARS);
    const line = cleanLine(text, max);
    if (!line) return { status: 'refused', reason: 'empty' };
    if (line.startsWith('/')) return { status: 'refused', reason: 'refused_command' };
    if (!this.opts.connected()) return { status: 'refused', reason: 'not_connected' };
    const now = this.opts.now?.() ?? Date.now();
    if (this.lastSentAt !== null && now - this.lastSentAt < this.opts.rateLimitSeconds * 1000) {
      return { status: 'refused', reason: 'refused_rate' };
    }
    // Reserved before the send, so two lines in flight at once cannot both pass.
    this.lastSentAt = now;
    try {
      await this.opts.send(line);
    } catch (error) {
      this.lastSentAt = null;
      throw error;
    }
    this.opts.events.publish({ from: this.opts.username, text: line, distance: null, own: true });
    return { status: 'said', text: line };
  }
}
