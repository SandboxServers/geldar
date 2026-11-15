// The admit one-shot (BH-3, BH-5a). The body helper runs this image once: `start` with GELDAR_ADMIT_MODE=add (it adds one life
// id to Paper's whitelist before it creates a managed Body), and `stop` with GELDAR_ADMIT_MODE=remove (it removes that id when
// the Body is stopped). The id arrives in GELDAR_ADMIT_LIFE_ID only; the RCON password is read from the file named by
// GELDAR_RCON_PASSWORD_FILE and is never printed. The mode is fixed in the environment and must be exactly `add` or `remove`:
// anything else is refused before any connection. Each mode sends one whitelist command for this id and nothing else
// (threat model rule 9; admissionOnly in players/whitelist.ts pins the command).
import { loadStackConfig } from './config.ts';
import { admitLifeWithConfig, removeLifeWithConfig } from './players/whitelist.ts';

/** A managed life id: ag_ plus 1 to 12 lower-case letters or digits (no underscore). The helper checks the same shape. */
export const ADMIT_LIFE_PATTERN = /^ag_[a-z0-9]{1,12}$/;

/** The two modes of this one-shot. Any other value is refused. */
export type AdmitMode = 'add' | 'remove';

/** The printed refusal when the mode is missing or unknown. It never carries the value. */
export const MODE_REFUSAL = 'admit-life: refused, GELDAR_ADMIT_MODE must be add or remove';

/** The mode from the environment: exactly `add` or `remove`. Unset or any other value throws a fixed message. */
export function admitMode(env: Readonly<Record<string, string | undefined>>): AdmitMode {
  const mode = env.GELDAR_ADMIT_MODE;
  if (mode !== 'add' && mode !== 'remove') throw new Error(MODE_REFUSAL);
  return mode;
}

/** The life id from the environment, or a throw with a fixed message. The message never carries the value. */
export function admitLifeId(env: Readonly<Record<string, string | undefined>>): string {
  const id = env.GELDAR_ADMIT_LIFE_ID;
  if (id === undefined || !ADMIT_LIFE_PATTERN.test(id)) {
    throw new Error('GELDAR_ADMIT_LIFE_ID is not a managed life id');
  }
  return id;
}

type StackConfig = ReturnType<typeof loadStackConfig>;

/** The side effects of the one-shot, injected so the dispatch can be tested without RCON. */
export interface AdmitDeps {
  loadConfig: (env: Readonly<Record<string, string | undefined>>) => StackConfig;
  admit: (cfg: StackConfig, id: string) => Promise<void>;
  remove: (cfg: StackConfig, id: string) => Promise<void>;
}

/** Checks the mode and the id first (no config read, no connection on refusal), then sends the one command for the mode. */
export async function runAdmit(
  env: Readonly<Record<string, string | undefined>>,
  deps: AdmitDeps,
): Promise<string> {
  const mode = admitMode(env);
  const id = admitLifeId(env);
  const stack = deps.loadConfig(env);
  if (mode === 'add') {
    await deps.admit(stack, id);
    return `admit-life: ${id} admitted`;
  }
  await deps.remove(stack, id);
  return `admit-life: ${id} removed`;
}

/** The one line printed on failure. A fixed line only: the RCON error text is never printed, so no password or reply can leak. */
export function failureLine(error: unknown): string {
  if (error instanceof Error && error.message === MODE_REFUSAL) return MODE_REFUSAL;
  return 'admit-life: admission or removal failed';
}

/** The real side effects the entry block runs with: the config reader and the one whitelist command per mode. */
export const defaultDeps: AdmitDeps = {
  loadConfig: loadStackConfig,
  admit: (cfg, id) => admitLifeWithConfig(cfg, id),
  remove: (cfg, id) => removeLifeWithConfig(cfg, id),
};

if (process.argv[1]?.endsWith('admit-life.ts')) {
  runAdmit(process.env, defaultDeps)
    .then((line) => console.log(line))
    .catch((error: unknown) => {
      console.error(failureLine(error));
      process.exit(1);
    });
}
