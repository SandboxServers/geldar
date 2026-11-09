/** Escapes a name for use inside a regular expression. */
function escapeRegExp(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when `text` names the Body: any of `names` appears as a whole word, ignoring case. A word
 * character is a letter, a digit or an underscore, so `Adam,` and `hey adam` match `Adam`, while
 * `adamant` and `Adam_2` do not. Empty names are ignored.
 */
export function isAddressed(text: string, names: readonly string[]): boolean {
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const whole = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}_])`,
      'iu',
    );
    if (whole.test(text)) return true;
  }
  return false;
}
