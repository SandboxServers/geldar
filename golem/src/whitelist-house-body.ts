// Whitelists the Colo house Body on Paper over RCON before it joins (C2-07k). Paper runs with white-list and
// enforce-whitelist on, and Velocity's identity gate admits the Body but Paper then refuses it. The admin container runs
// this once per deploy, after Paper is healthy and before golem-body starts, so the RCON secret reaches only that
// one-shot and Paper (threat model rule 9: the Body holds no command socket).
// The name is the one golem-body derives: mind.agent.username of the shard file (the life id). Nothing else is whitelisted.
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { loadStackConfig, readRconPassword } from './config.ts';
import { admitLifeOverRcon } from './players/whitelist.ts';
import { RconClient } from './rcon.ts';

const HOUSE_NAME = /^ag_[a-z0-9_]{1,12}$/;

/** The house Body name from a parsed shard file; throws when absent or not a life id. */
export function houseBodyName(shard: unknown): string {
  const mind = (shard as { mind?: { agent?: { username?: unknown } } } | null)?.mind;
  const name = mind?.agent?.username;
  if (typeof name !== 'string' || !HOUSE_NAME.test(name)) {
    throw new Error('the shard file has no mind.agent.username that is a house Body life id');
  }
  return name;
}

async function main(): Promise<void> {
  const file = process.env.GELDAR_SHARD_FILE;
  if (!file) throw new Error('GELDAR_SHARD_FILE is not set');
  const name = houseBodyName(parse(await readFile(file, 'utf8')));
  const stack = loadStackConfig(process.env);
  await admitLifeOverRcon(
    async () =>
      RconClient.connect({
        host: stack.rconHost,
        port: stack.rconPort,
        password: await readRconPassword(stack),
      }),
    name,
  );
  console.log(`house body ${name}: whitelisted`);
}

if (process.argv[1]?.endsWith('whitelist-house-body.ts')) {
  main().catch((error: unknown) => {
    console.error(
      `whitelist-house-body: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
