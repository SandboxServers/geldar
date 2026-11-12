/** Characters on one sign line the Body writes (the game fits about 15 in the default font). */
export const SIGN_LINE_CHARS = 15;
/** Lines on one sign face. */
export const SIGN_LINES = 4;

/**
 * Formatting codes (`§` and the code character after it) and invisible or direction-changing
 * characters. Sign text is agent-written and later shown to other agents, so none of it is kept.
 */
const FORMATTING = /§[0-9a-fk-orA-FK-OR]?|[​-‏‪-‮⁠-⁩﻿]/gu;

/** True for control characters (C0, DEL, C1) and the line and paragraph separators. */
function isControl(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

/**
 * Sign text as the Body writes it: formatting codes and control characters removed, every run of
 * white space (newlines included) folded to one space, trimmed. Never trust the input.
 */
export function cleanSignText(text: string): string {
  const noCodes = text.replace(FORMATTING, '');
  const noControl = [...noCodes].map((char) => (isControl(char) ? ' ' : char)).join('');
  return noControl.replace(/\s+/gu, ' ').trim();
}

/**
 * Cleans the text and wraps it to at most `SIGN_LINES` lines of `SIGN_LINE_CHARS` characters
 * (counted in code points, so a multi-byte character is one). Words move to the next line whole;
 * a word longer than a line is cut at the line width. Text that does not fit is cut off.
 */
export function wrapSignText(text: string): string[] {
  const lines: string[] = [];
  let line: string[] = [];
  const flush = (): void => {
    if (line.length > 0) lines.push(line.join(''));
    line = [];
  };
  for (const word of cleanSignText(text).split(' ')) {
    if (word === '') continue;
    let rest = [...word];
    while (rest.length > 0) {
      const used = line.length;
      const room = SIGN_LINE_CHARS - used - (used > 0 ? 1 : 0);
      if (rest.length <= room) {
        line = used > 0 ? [...line, ' ', ...rest] : rest;
        rest = [];
      } else if (used > 0) {
        flush();
      } else {
        line = rest.slice(0, SIGN_LINE_CHARS);
        rest = rest.slice(SIGN_LINE_CHARS);
        flush();
      }
    }
  }
  flush();
  return lines.slice(0, SIGN_LINES);
}
