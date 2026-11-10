/**
 * What each wait of the live stub case returned, for the message of a failed run: the wake reason and the type and
 * text of every event the player saw. The texts are the server's fixed templates, never the Body's detail.
 */

/** One wait's result, reduced to what a failed run needs to explain itself. */
export interface WaitTrace {
  step: number;
  wake_reason: string;
  events: { type: string; text: string }[];
}

/** Reads one wait's structured result. A missing field reads as none; an event without a text is skipped. */
export function traceOf(
  step: number,
  result: { wake_reason?: unknown; events?: unknown },
): WaitTrace {
  const wake_reason = typeof result.wake_reason === 'string' ? result.wake_reason : 'none';
  const events: WaitTrace['events'] = [];
  for (const item of Array.isArray(result.events) ? result.events : []) {
    if (typeof item !== 'object' || item === null) continue;
    const { type, text } = item as { type?: unknown; text?: unknown };
    if (typeof text === 'string')
      events.push({ type: typeof type === 'string' ? type : 'unknown', text });
  }
  return { step, wake_reason, events };
}

/** One line per wait: its step, its wake reason, then the events it returned. */
export function describeWaits(traces: readonly WaitTrace[]): string {
  if (traces.length === 0) return 'No wait returned.';
  return traces
    .map((t) => {
      const seen =
        t.events.length === 0
          ? 'no events'
          : t.events.map((e) => `${e.type} "${e.text}"`).join('; ');
      return `wait ${t.step}: wake_reason ${t.wake_reason}; ${seen}`;
    })
    .join('\n');
}
