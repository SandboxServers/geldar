/**
 * The command line behind `./geldar.ps1 adam`: `up [--model strong|fast]`, `select --model strong|fast|smoke`, `down`, `status`,
 * `logs [service] [--follow]` and `models [--record]`. Run with `node tools/adam-cli/src/cli.ts`.
 * Exit codes: 0 done, 1 a refusal or failure with the reason printed, 2 bad usage.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { restartBody } from './body-restart.ts';
import { adamEnv, loopbackProblems, parseComposePs, parseEnvFile, shardProblems } from './env.ts';
import {
  compare,
  installedFromTags,
  type LifeKey,
  type PinRow,
  preflightProblems,
  readLives,
  readPins,
  readSeed,
  readTierTags,
  type Tier,
} from './pins.ts';
import { BODY, formatStatus, isLifeId, latencySql, parseLatency, SERVICES } from './procs.ts';
import { retireSelected } from './retire.ts';
import {
  compose,
  followLog,
  isAlive,
  logFile,
  logSince,
  logSize,
  lookupProcess,
  ROOT,
  readOwner,
  readRows,
  startAll,
  startService,
  stopAll,
  tailLines,
} from './run.ts';
import { recordDigests, selectLife } from './yaml-edit.ts';

const USAGE =
  'usage: ./geldar.ps1 adam up [--model strong|fast] | select --model strong|fast|smoke | down | status | logs [body|animus|lantern-local] [--follow] | models [--record] | restart-body';

class Refusal extends Error {}

function shardFile(env: Record<string, string | undefined>): string {
  return join(ROOT, 'shards', `${env.GELDAR_SHARD ?? 'phase0'}.yaml`);
}

function runEnv(): Record<string, string> {
  const envFile = join(ROOT, '.env');
  const fileEnv = existsSync(envFile) ? parseEnvFile(readFileSync(envFile, 'utf8')) : {};
  const env = adamEnv(fileEnv, process.env);
  const problems = loopbackProblems(env);
  if (problems.length > 0) throw new Refusal(problems.join('\n'));
  return env;
}

/** Asks Ollama which models it has; throws a Refusal that says what to do when it does not answer. */
async function installedModels(env: Record<string, string>): Promise<Map<string, string>> {
  const base = (env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
  try {
    const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return installedFromTags(await response.json());
  } catch (error) {
    throw new Refusal(`Ollama does not answer at ${base} (${String(error)}); start Ollama first`);
  }
}

function printRows(rows: PinRow[]): void {
  for (const row of rows) {
    const found = row.found ?? 'not installed';
    console.log(
      `${row.tag.padEnd(22)} ${row.state.padEnd(11)} pinned ${row.pinned}  found ${found}`,
    );
  }
}

function argValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}

/** Rewrites the life lines of the shard file for a tier (shared by `up --model` and `select`). */
function applyLife(file: string, source: string, tier: Tier, life: string): void {
  const updated = selectLife(source, tier, life);
  if (updated !== source) {
    writeFileSync(file, updated);
    console.log(`${file}: life set to ${life} (${tier})`);
  }
}

/** `select --model strong|fast|smoke`: only the rewrite; checks nothing and starts nothing. */
function select(args: string[]): void {
  const wanted = argValue(args, '--model');
  if (wanted !== 'strong' && wanted !== 'fast' && wanted !== 'smoke')
    throw new Refusal('select needs --model strong|fast|smoke');
  selectInFile(shardFile(runEnv()), wanted);
}

/** Points the shard file at a life from its `mind.lives` table; the smoke life runs on the fast tier. */
export function selectInFile(file: string, key: LifeKey): string {
  const source = readFileSync(file, 'utf8');
  const life = readLives(parse(source))[key];
  applyLife(file, source, key === 'smoke' ? 'fast' : key, life);
  console.log(`selected: life ${life} (${key})`);
  return life;
}

async function up(args: string[]): Promise<void> {
  const running = readRows().filter((r) => r.state === 'running');
  if (running.length > 0) {
    throw new Refusal(
      `already running (${running.map((r) => r.name).join(', ')}); run ./geldar.ps1 adam down first`,
    );
  }
  const env = runEnv();
  const file = shardFile(env);
  const source = readFileSync(file, 'utf8');
  const doc: unknown = parse(source);
  const wanted = argValue(args, '--model');
  if (args.includes('--model') && wanted !== 'strong' && wanted !== 'fast') {
    throw new Refusal('--model takes strong or fast');
  }
  const lives = readLives(doc);
  const agent = (doc as { mind: { agent: { tier: Tier } } }).mind.agent;
  const tier: Tier = (wanted as Tier | undefined) ?? agent.tier;
  const shard = env.GELDAR_SHARD ?? (doc as { shard: string }).shard;
  try {
    const rows = parseComposePs(await compose(shard, ['ps', '--format', 'json']));
    const problems = shardProblems(rows, shard);
    if (problems.length > 0) throw new Refusal(`the shard is not healthy:\n${problems.join('\n')}`);
  } catch (error) {
    if (error instanceof Refusal) throw error;
    throw new Refusal(
      `could not read the shard state with docker compose (${String(error)}); is Docker running?`,
    );
  }
  const rows = compare(readPins(doc), await installedModels(env));
  const problems = preflightProblems(rows, readTierTags(doc, tier), readSeed(doc));
  if (problems.length > 0) throw new Refusal(`refusing to start:\n${problems.join('\n')}`);
  const life = lives[tier];
  if (wanted !== undefined) applyLife(file, source, tier, life);
  if (tier === 'fast') {
    console.log(`${life} is the 8B life: it needs a fresh world volume (decision 0051)`);
  }
  const dead = await startAll(env);
  if (dead.length > 0) {
    for (const name of dead) {
      const service = SERVICES.find((s) => s.name === name);
      if (service)
        console.log(`--- ${name} (last lines of ${logFile(service)})\n${tailLines(service, 15)}`);
    }
    await stopAll();
    throw new Refusal(`${dead.join(', ')} exited at start; the rest was stopped`);
  }
  console.log(upLine(readFileSync(file, 'utf8')));
}

/** The last line of `up`: the life the Mind selects now (its username), which is not always a `mind.lives` entry. */
export function upLine(source: string): string {
  const selected = (parse(source) as { mind: { agent: { username: string } } }).mind.agent.username;
  return `up: life ${selected}; see ./geldar.ps1 adam status`;
}

async function lastLatency(shard: string, life: string): Promise<number | null> {
  if (!isLifeId(life)) return null;
  try {
    const out = await compose(shard, [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'geldar',
      '-d',
      'geldar',
      '-tA',
      '-c',
      latencySql(life),
    ]);
    return parseLatency(out);
  } catch {
    return null;
  }
}

/** After `down`: retires the selected life from the registry and whitelist, printing each step. */
async function retireAfterStop(): Promise<void> {
  const file = shardFile(process.env);
  const source = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const anyRunning = readRows().some((r) => r.state === 'running');
  for (const line of await retireSelected(source, anyRunning)) console.log(line);
}

async function status(): Promise<void> {
  const rows = readRows();
  let life = 'unknown';
  let latency: number | null = null;
  if (rows.some((r) => r.state === 'running')) {
    try {
      const file = shardFile(process.env);
      const doc = parse(readFileSync(file, 'utf8')) as {
        shard: string;
        mind: { agent: { username: string } };
      };
      life = doc.mind.agent.username;
      latency = await lastLatency(process.env.GELDAR_SHARD ?? doc.shard, life);
    } catch {
      // status never fails on a missing shard file
    }
  }
  for (const line of formatStatus(rows, life, latency)) console.log(line);
}

async function models(args: string[]): Promise<void> {
  const env = runEnv();
  const file = shardFile(env);
  const source = readFileSync(file, 'utf8');
  const doc: unknown = parse(source);
  const installed = await installedModels(env);
  const pins = readPins(doc);
  const rows = compare(pins, installed);
  printRows(rows);
  if (!args.includes('--record')) return;
  const missing = rows.filter((r) => r.found === null);
  if (missing.length > 0) {
    throw new Refusal(`not recording: ${missing.map((r) => `ollama pull ${r.tag}`).join(' ; ')}`);
  }
  const found = new Map(rows.map((r) => [r.tag, r.found as string]));
  const embedding = pins.find((p) => p.kind === 'embedding');
  if (embedding === undefined) throw new Refusal('no embedding pin in the shard file');
  const result = recordDigests(
    source,
    pins.filter((p) => p.kind === 'model').map((p) => p.tag),
    embedding.tag,
    found,
    new Date().toISOString().slice(0, 10),
  );
  if (result.text !== source) writeFileSync(file, result.text);
  console.log(`recorded: ${result.recorded.join(', ') || 'none'}`);
  if (result.kept.length > 0) {
    console.log(`kept (already a real digest, never overwritten): ${result.kept.join(', ')}`);
  }
}

async function logs(args: string[]): Promise<void> {
  const name = args.find((a) => !a.startsWith('--'));
  const picked = name === undefined ? SERVICES : SERVICES.filter((s) => s.name === name);
  if (picked.length === 0) throw new Refusal(`unknown service '${name}'; ${USAGE}`);
  for (const service of picked) {
    console.log(`--- ${service.name} (${logFile(service)})`);
    console.log(tailLines(service, 200));
  }
  const [only] = picked;
  if (args.includes('--follow') && picked.length === 1 && only !== undefined) await followLog(only);
}

/**
 * `restart-body`: ends only the Body (verified by its owner record) and starts a fresh one with the command and the
 * environment `adam up` gives it. animus and lantern-local keep running.
 */
async function restartBodyCommand(): Promise<void> {
  const env = runEnv();
  const message = await restartBody(
    {
      adamUp: () => readRows().some((r) => r.state === 'running'),
      owner: () => readOwner(BODY),
      lookup: lookupProcess,
      alive: isAlive,
      signal: (pid, signal) => process.kill(pid, signal),
      spawn: (service, serviceEnv) => startService(service, serviceEnv),
      env: () => env,
      logSize: () => logSize(BODY),
      logSince: (offset) => logSince(BODY, offset),
      sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
      now: () => Date.now(),
    },
    { graceMs: 15_000, readyMs: 120_000, pollMs: 500 },
  );
  console.log(message);
}

/** Runs one command; returns the exit code. */
export async function run(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  try {
    switch (command) {
      case 'up':
        await up(args);
        return 0;
      case 'select':
        select(args);
        return 0;
      case 'down':
        await stopAll();
        await retireAfterStop();
        return 0;
      case 'status':
        await status();
        return 0;
      case 'logs':
        await logs(args);
        return 0;
      case 'models':
        await models(args);
        return 0;
      case 'restart-body':
        await restartBodyCommand();
        return 0;
      default:
        console.error(USAGE);
        return 2;
    }
  } catch (error) {
    if (error instanceof Refusal) {
      console.error(error.message);
      return 1;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2));
}
