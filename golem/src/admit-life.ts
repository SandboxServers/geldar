// The admit one-shot (BH-3). The body helper's `start` runs this image once, before it creates a managed Body: it adds one
// life id to Paper's whitelist over RCON and exits. The id arrives in GELDAR_ADMIT_LIFE_ID only; the RCON password is read
// from the file named by GELDAR_RCON_PASSWORD_FILE and is never printed. The command is pinned by admissionOnly, so this
// process sends `whitelist add <id>` and nothing else (threat model rule 9).
import { loadStackConfig, readRconPassword } from './config.ts';
import { admitLifeOverRcon } from './players/whitelist.ts';
import { RconClient } from './rcon.ts';

/** A managed life id: ag_ plus 1 to 12 lower-case letters or digits (no underscore). The helper checks the same shape. */
export const ADMIT_LIFE_PATTERN = /^ag_[a-z0-9]{1,12}$/;

/** The life id from the environment, or a throw with a fixed message. The message never carries the value. */
export function admitLifeId(env: Readonly<Record<string, string | undefined>>): string {
  const id = env.GELDAR_ADMIT_LIFE_ID;
  if (id === undefined || !ADMIT_LIFE_PATTERN.test(id)) {
    throw new Error('GELDAR_ADMIT_LIFE_ID is not a managed life id');
  }
  return id;
}

async function main(): Promise<void> {
  const id = admitLifeId(process.env);
  const stack = loadStackConfig(process.env);
  await admitLifeOverRcon(
    async () =>
      RconClient.connect({
        host: stack.rconHost,
        port: stack.rconPort,
        password: await readRconPassword(stack),
      }),
    id,
  );
  console.log(`admit-life: ${id} admitted`);
}

if (process.argv[1]?.endsWith('admit-life.ts')) {
  main().catch(() => {
    // A fixed line only: the RCON error text is not printed, so no password or reply can leak into the log.
    console.error('admit-life: admission failed');
    process.exit(1);
  });
}
