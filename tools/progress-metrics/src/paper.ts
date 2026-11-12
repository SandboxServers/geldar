import { splitDockerPrefix } from './time.ts';

export type PaperEvent = {
  agent: string;
  at: number;
  kind: 'death' | 'join' | 'leave' | 'chat';
  /** The death message after the player name ("was slain by Zombie"), empty otherwise. */
  cause: string;
};

const CLOCK = /^\[(\d{2}):(\d{2}):(\d{2}) [A-Z]+\]: (.*)$/;
const DEATH =
  /^(\S+) (was (?:slain|shot|killed|blown|burnt|burned|pricked|squashed|impaled|fireballed|pummeled|doomed|struck|stung|skewered|squished|poked|obliterated|roasted|frozen)\b.*|drowned.*|died.*|fell .*|hit the ground.*|burned to death.*|tried to swim in lava.*|starved to death.*|suffocated.*|experienced kinetic energy.*|went up in flames.*|walked into .*|withered away.*|blew up.*|discovered the floor was lava.*|froze to death.*|was .*)$/;
const JOIN = /^(\S+) joined the game$/;
const LEAVE = /^(\S+) left the game$/;
const CHAT = /^<(\S+)> /;

/**
 * Parses one Paper console line (`[12:34:56 INFO]: ag_x was slain by Zombie`), with an optional
 * `docker logs --timestamps` prefix. Without that prefix the clock time is placed on `baseDate`
 * (epoch ms of 00:00 that day, UTC); the caller carries `dayOffsetMs` forward across midnight.
 */
export function parsePaperLine(
  raw: string,
  baseDate: number,
  state: { dayOffsetMs: number; lastClock: number },
): PaperEvent | null {
  const { at: dockerAt, rest } = splitDockerPrefix(raw.trimEnd());
  const m = CLOCK.exec(rest);
  if (!m) return null;
  const body = m[4] as string;
  let at: number;
  if (dockerAt !== null) at = dockerAt;
  else {
    const clock = ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
    if (clock < state.lastClock - 3_600_000) state.dayOffsetMs += 86_400_000;
    state.lastClock = clock;
    at = baseDate + state.dayOffsetMs + clock;
  }
  const j = JOIN.exec(body);
  if (j) return { agent: j[1] as string, at, kind: 'join', cause: '' };
  const l = LEAVE.exec(body);
  if (l) return { agent: l[1] as string, at, kind: 'leave', cause: '' };
  const c = CHAT.exec(body);
  if (c) return { agent: c[1] as string, at, kind: 'chat', cause: '' };
  if (/ (?:the game|lost connection|logged in)/.test(body)) return null;
  const d = DEATH.exec(body);
  if (d) {
    // "was .*" is the catch-all; keep only genuine death phrasing for it.
    const cause = d[2] as string;
    if (/^was (?:the|a|an)\b/.test(cause) && !/\b(?:by|into|off|from)\b/.test(cause)) return null;
    return { agent: d[1] as string, at, kind: 'death', cause };
  }
  return null;
}

export function parsePaperLog(text: string, baseDate: number): PaperEvent[] {
  const state = { dayOffsetMs: 0, lastClock: 0 };
  const out: PaperEvent[] = [];
  for (const line of text.split('\n')) {
    const e = parsePaperLine(line, baseDate, state);
    if (e) out.push(e);
  }
  return out;
}
