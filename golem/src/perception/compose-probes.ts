import type { Bot } from 'mineflayer';

/**
 * One feature's probe: it reads the Body's state and returns the fields it owns. `file` is the
 * probe's file name without `.ts` in its folder; the registry test checks every file is listed.
 */
export interface Probe<T> {
  file: string;
  probe: (bot: Bot) => Partial<T>;
}

/**
 * Runs the probes in list order and merges what they return. A later probe's key wins over an
 * earlier one's, so the result depends only on the list, never on the order files were read.
 */
export function composeProbes<T>(probes: readonly Probe<T>[], bot: Bot): Partial<T> {
  const out: Partial<T> = {};
  for (const { probe } of probes) Object.assign(out, probe(bot));
  return out;
}
