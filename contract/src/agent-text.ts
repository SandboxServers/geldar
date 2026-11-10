/**
 * The marker words that must not reach an agent as text it can read (decisions 0058, 0059, 0068):
 * a word that tells the agent it is watched, that it is software, or that it is in a test. One list
 * for the prompt scan, the contract scan and the persona lint.
 */

/** A word that tells the agent it is watched, that it is software, or that it is in a test. */
export const MARKER_WORD = /observer|watch|human|maker|stream|credit|colo|shard|harness/i;

/**
 * Minecraft-the-game phrases that contain a marker word (the Observer block, the Echo Shard, the
 * end credits, spectator mode, the happy ghast harness). They are removed before the scan.
 */
export const MINECRAFT_PHRASES: readonly RegExp[] = [
  /\bobservers? blocks?\b/gi,
  /\becho shards?\b/gi,
  /\b(?:end )?credits (?:screen|roll|sequence)\b/gi,
  /\bend credits\b/gi,
  /\bspectator mode\b/gi,
  /\bhappy ghast harness(?:es)?\b/gi,
];

/**
 * The marker words in a text, in order. `allowed` maps lower-case words that may stay, each with
 * its reason (empty by default: add a word only with a reason an in-world reader would accept).
 */
export function markedWords(
  text: string,
  allowed: Readonly<Record<string, string>> = {},
): string[] {
  const plain = MINECRAFT_PHRASES.reduce((rest, phrase) => rest.replace(phrase, ' '), text);
  const words = plain.match(/[A-Za-z][A-Za-z_-]*/g) ?? [];
  return words.filter((word) => MARKER_WORD.test(word) && !(word.toLowerCase() in allowed));
}
