/**
 * The production switch for the Body's `observations` option (AN-50d, decision 0391 item 5). `GELDAR_OBSERVATIONS`
 * set to '1' or 'on' turns it on; anything else, absent or empty included, leaves it off, as it is today. Compose
 * passes the variable through empty, so nothing is on by default.
 */

/** True only for '1' or 'on'. */
export function observationsFromEnv(value: string | undefined): boolean {
  return value === '1' || value === 'on';
}

/** The Body env spread: `{ observations: true }` when on, and nothing when off, so an off env is the same object as today. */
export function observationsOption(value: string | undefined): { observations?: true } {
  return observationsFromEnv(value) ? { observations: true } : {};
}
