/**
 * The wake phase of the Wave M live cases (L3). A life may start hibernated: its Body is down, so `look`
 * answers `body_unavailable` (world.ts `guarded`). The call that meets it asks the Body up (world.ts `bound`,
 * presence.ts `wantBody`), and the Body starts in the player host. This helper retries `look` with backoff
 * until one succeeds. It is pure: the clock and the attempt are injected, so the unit test runs on fake time.
 */

/** How long the wake may take, from the first look to the last one that may still count. */
export const WAKE_DEADLINE_MS = 120_000;
/** The first pause between looks; each pause doubles until WAKE_MAX_DELAY_MS. */
export const WAKE_FIRST_DELAY_MS = 2_000;
export const WAKE_MAX_DELAY_MS = 10_000;

/** The tool error code that means the Body is not up yet: the expected signal during the wake phase only. */
export const WAKE_SIGNAL = 'body_unavailable';

export interface WakeClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** One `look`, reduced to what the wake needs: it answered, or it failed with a tool error code. */
export type WakeAttempt = { ok: true } | { ok: false; code: string; message: string };

export interface WakeOptions {
  /** One `look` call. A thrown error is not caught here: a transport failure fails the case. */
  attempt: () => Promise<WakeAttempt>;
  clock: WakeClock;
  deadlineMs?: number;
  /** Read only when the wake times out: names the presence record's state for the operator. */
  describeState?: () => string;
}

export interface WakeReport {
  attempts: number;
  waitedMs: number;
}

/**
 * Reads one MCP tool result. A result that is not an error is ok. An error's text is `code: message`
 * (the form world.ts gives a ToolError); a text without that form has the code `unknown`.
 */
export function attemptOf(result: { isError?: boolean; content?: unknown }): WakeAttempt {
  if (result.isError !== true) return { ok: true };
  const text = firstText(result.content);
  const match = /^([a-z_]+): ([\s\S]*)$/.exec(text);
  if (match === null) return { ok: false, code: 'unknown', message: text };
  return { ok: false, code: match[1] ?? 'unknown', message: match[2] ?? '' };
}

function firstText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  for (const item of content) {
    if (typeof item === 'object' && item !== null && 'text' in item) {
      const text = (item as { text: unknown }).text;
      if (typeof text === 'string') return text;
    }
  }
  return '';
}

/**
 * Retries the attempt until it succeeds. Pauses are 2 s, 4 s, 8 s, then 10 s each, and the last pause is cut
 * to the deadline, so the final look happens at the deadline itself. Only `body_unavailable` is retried; any
 * other failure throws at once with its message. A timeout throws a message that names the presence state.
 */
export async function waitForWake(options: WakeOptions): Promise<WakeReport> {
  const { attempt, clock } = options;
  const deadlineMs = options.deadlineMs ?? WAKE_DEADLINE_MS;
  const start = clock.now();
  let delay = WAKE_FIRST_DELAY_MS;
  let attempts = 0;
  let last = 'no answer yet';
  for (;;) {
    attempts += 1;
    const result = await attempt();
    if (result.ok) return { attempts, waitedMs: clock.now() - start };
    if (result.code !== WAKE_SIGNAL) {
      throw new Error(`look failed during the wake phase: ${result.code}: ${result.message}`);
    }
    last = result.code;
    const elapsed = clock.now() - start;
    if (elapsed >= deadlineMs) {
      throw new Error(timeoutMessage(deadlineMs, attempts, last, options.describeState));
    }
    await clock.sleep(Math.min(delay, deadlineMs - elapsed));
    delay = Math.min(delay * 2, WAKE_MAX_DELAY_MS);
  }
}

function timeoutMessage(
  deadlineMs: number,
  attempts: number,
  last: string,
  describeState: (() => string) | undefined,
): string {
  let state: string;
  try {
    state = describeState?.() ?? 'The presence record was not read.';
  } catch {
    state = 'The presence record could not be read.';
  }
  return [
    `the Body did not answer look within ${deadlineMs / 1000} s (${attempts} tries, last: ${last}).`,
    state,
    'Check `./geldar.ps1 players logs` and `./geldar.ps1 players status`, then run the case again.',
  ].join(' ');
}
