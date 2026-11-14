// The global cap on running Bodies (GLOBAL-CAP, decision 0261). It is read from one place only: the
// GELDAR_GLOBAL_BODY_CAP env name. A caller cannot pass a cap, and the helper never raises it.

export const DEFAULT_GLOBAL_BODY_CAP = 40;
export const CAP_ENV = 'GELDAR_GLOBAL_BODY_CAP';

export type GlobalCap = { ok: true; cap: number } | { ok: false; why: string };

/** Unset gives the default. Zero, a negative number, text or an empty value is a config error. */
export function globalBodyCapFromEnv(env: Readonly<Record<string, string | undefined>>): GlobalCap {
  const raw = env[CAP_ENV];
  if (raw === undefined) return { ok: true, cap: DEFAULT_GLOBAL_BODY_CAP };
  if (!/^[1-9]\d*$/.test(raw))
    return { ok: false, why: `${CAP_ENV} must be a positive whole number` };
  return { ok: true, cap: Number(raw) };
}
