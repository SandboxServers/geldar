/**
 * The end of a failed child process's stderr, for the error that an abort reason carries: the last lines on one
 * line, with token- and password-like values replaced and the length capped. The next failure stays visible
 * without a re-run, and no secret reaches abort.json.
 */
const TAIL_LINES = 20;
const TAIL_CAP = 1500;
const SECRET_PAIR =
  /\b([\w.-]*(?:password|passwd|secret|token|api[_-]?key)[\w.-]*)(\s*[=:]\s*)\S+/gi;
const BEARER = /\bBearer\s+\S+/gi;

export function stderrTail(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line !== '');
  const tail = lines
    .slice(-TAIL_LINES)
    .join(' | ')
    .replace(SECRET_PAIR, '$1$2<redacted>')
    .replace(BEARER, 'Bearer <redacted>');
  return tail.length > TAIL_CAP ? `...${tail.slice(-TAIL_CAP)}` : tail;
}
