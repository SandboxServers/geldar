// The global cap on running Bodies (GLOBAL-CAP, decision 0261). It is read from one place only: the
// GELDAR_GLOBAL_BODY_CAP env name. A caller cannot pass a cap, and the helper never raises it.

export const DEFAULT_GLOBAL_BODY_CAP = 100;
export const CAP_ENV = 'GELDAR_GLOBAL_BODY_CAP';

/**
 * Unset gives the default. Zero, a negative number, text or an empty value throws: a bad cap is a start failure,
 * so the helper never runs with a cap it cannot trust.
 */
export function globalBodyCapFromEnv(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env[CAP_ENV];
  if (raw === undefined) return DEFAULT_GLOBAL_BODY_CAP;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${CAP_ENV} must be a positive whole number`);
  return Number(raw);
}
