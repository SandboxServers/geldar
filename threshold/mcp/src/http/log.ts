import { REFUSAL_REASONS, type RefusalReason } from '../ports.ts';

/** A fixed refusal or outcome template: lowercase words joined by underscores. */
const TEMPLATE = /^[a-z][a-z_]{0,60}$/;
/** A failure class name, such as `TypeError`: the message after the colon is never kept. */
const CLASS = /^[A-Za-z][A-Za-z0-9]{0,60}$/;
const PLAYER = /^[a-z][a-z0-9-]{1,38}$/;
/** The most of a cause a log line keeps: its first line, cut to this many characters. */
const CAUSE_MAX = 200;
/** Text that looks like a credential: a bearer token, a `password=`-style value, or a long opaque run. */
const SECRET_LIKE =
  /bearer\s+\S+|[a-z_]*(?:password|passwd|secret|token|key)"?\s*[=:]\s*"?[^\s",]+|(?:password|passwd|token|secret)\s*[=:]\s*\S*|[A-Za-z0-9+/_-]{32,}/gi;
/** An `Authorization` or `Cookie` header in the cause: the rest of the line is credential text. */
const AUTH_LINE = /(?:authorization|cookie)\s*:\s*\S.*/gi;
/** The userinfo of a connection string, `scheme://user:password@host`: the scheme is kept. */
const USERINFO = /(:\/\/)[^/\s:@]+:[^@\s]+@/g;

/**
 * Keeps only the fields a request log line may carry: the event, the player id from the URL,
 * the status, a fixed error template and a bounded cause. Headers, bodies and world text never
 * pass. An error message that is not a template is reduced to its class name, or `unknown`.
 */
export function safeLogLine(line: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (typeof line.event === 'string' && TEMPLATE.test(line.event)) out.event = line.event;
  if (typeof line.player_id === 'string' && PLAYER.test(line.player_id)) {
    out.player_id = line.player_id;
  }
  if (typeof line.status === 'number') out.status = line.status;
  if (typeof line.reason === 'string' && isRefusalReason(line.reason)) out.reason = line.reason;
  if (typeof line.error === 'string') out.error = errorTemplate(line.error);
  if (typeof line.cause === 'string') out.cause = causeText(line.cause);
  if (typeof line.suppressed === 'number') out.suppressed = line.suppressed;
  return out;
}

/** True for one of the closed refusal reasons; any other text is dropped, never kept. */
function isRefusalReason(value: string): value is RefusalReason {
  return (REFUSAL_REASONS as readonly string[]).includes(value);
}

/**
 * The first line of a cause, with credential-looking text replaced and the rest cut off at
 * `CAUSE_MAX` characters. Redaction runs before the cut, so a secret is never half kept.
 */
function causeText(cause: string): string {
  const first = cause.split('\n', 1)[0] ?? '';
  const redacted = first
    .replace(AUTH_LINE, '[redacted]')
    .replace(USERINFO, '$1[redacted]@')
    .replace(SECRET_LIKE, '[redacted]');
  return redacted.slice(0, CAUSE_MAX);
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
