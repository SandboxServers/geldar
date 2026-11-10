/** A fixed refusal or outcome template: lowercase words joined by underscores. */
const TEMPLATE = /^[a-z][a-z_]{0,60}$/;
/** A failure class name, such as `TypeError`: the message after the colon is never kept. */
const CLASS = /^[A-Za-z][A-Za-z0-9]{0,60}$/;
const PLAYER = /^[a-z][a-z0-9-]{1,38}$/;

/**
 * Keeps only the fields a request log line may carry: the event, the player id from the URL,
 * the status and a fixed error template. Headers, bodies, tokens and world text never pass.
 * An error message that is not a template is reduced to its class name, or `unknown`.
 */
export function safeLogLine(line: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (typeof line.event === 'string' && TEMPLATE.test(line.event)) out.event = line.event;
  if (typeof line.player_id === 'string' && PLAYER.test(line.player_id)) {
    out.player_id = line.player_id;
  }
  if (typeof line.status === 'number') out.status = line.status;
  if (typeof line.error === 'string') out.error = errorTemplate(line.error);
  return out;
}

function errorTemplate(error: string): string {
  if (TEMPLATE.test(error)) return error;
  const name = error.split(':')[0] ?? '';
  return CLASS.test(name) ? name : 'unknown';
}

/** Wraps a sink so every line it receives is cut down by `safeLogLine` first. */
export function frontLog(
  sink: (line: Record<string, string | number>) => void,
): (line: Record<string, unknown>) => void {
  return (line) => sink(safeLogLine(line));
}
