import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Bot } from 'mineflayer';
import { watchRecipeBook } from '../actions/craft-table.ts';
import { createRegistry } from '../actions/index.ts';
import { restoreWorld } from '../arena.ts';
import { type GolemConfig, loadConfig, readRconPassword, repoRoot } from '../config.ts';
import { ConnectionManager } from '../connection.ts';
import { RconClient } from '../rcon.ts';
import { TestControl } from '../test-control.ts';
import { collectMeta, isDirty, runGit } from './meta.ts';
import { writeResults } from './results.ts';
import { type ManagerLike, runCell } from './runner.ts';
import { gotoSmoke } from './scenarios/goto-smoke.ts';
import { findScenario, visibleScenarios } from './scenarios/index.ts';
import { installTpsRestore, parseTargetRate } from './tps.ts';
import type { CellResult, Scenario } from './types.ts';

/** The bench bot's player name. */
export const BENCH_NAME = 'GolemBench';
/** The arena slot every bench run uses: 5 for P0-10a (10b uses 6, 10c uses 7). */
const BENCH_SLOT = 5;
const DEFAULT_TPS = [20, 10, 5];
const NOTE_PATTERN = /^[A-Za-z0-9 ,.:_()/+-]{0,200}$/;
const LIST_PATTERN = /There are (\d+) of a max of (\d+) players online/;
const KICK_WAIT_MS = 15_000;

const USAGE =
  'usage: bench [--scenario <name|all>] [--tps <1-20>]... [--runs <1-100>] [--max-minutes <n>] ' +
  '[--record] [--allow-dirty] [--note <text>] [--dry-run] [--list] [--restore]';

/** Bad command-line input: the CLI prints the usage line and exits 2. */
export class UsageError extends Error {}

/** The resolved command line. */
export interface Options {
  scenario: string;
  scenarios: string[];
  tps: number[];
  runs: number;
  maxMinutes: number | null;
  record: boolean;
  allowDirty: boolean;
  note: string;
  dryRun: boolean;
  list: boolean;
  restore: boolean;
}

function integerIn(name: string, raw: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw)) throw new UsageError(`${name} must be an integer, got '${raw}'`);
  const value = Number(raw);
  if (value < min || value > max)
    throw new UsageError(`${name} must be ${min} to ${max}, got ${value}`);
  return value;
}

/**
 * Parses and validates the arguments. A leading lone `--` (pnpm may forward it) is stripped first.
 * Throws `UsageError` for any invalid value, an unknown scenario, `--record` with a hidden
 * scenario, or `--record` on a dirty tree without `--allow-dirty`.
 */
export function parseCli(argv: string[], dirty: () => boolean = () => isDirty(runGit)): Options {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    values = parseArgs({
      args,
      allowPositionals: false,
      options: {
        scenario: { type: 'string' },
        tps: { type: 'string', multiple: true },
        runs: { type: 'string' },
        'max-minutes': { type: 'string' },
        record: { type: 'boolean' },
        'allow-dirty': { type: 'boolean' },
        note: { type: 'string' },
        'dry-run': { type: 'boolean' },
        list: { type: 'boolean' },
        restore: { type: 'boolean' },
      },
    }).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const scenario = (values.scenario as string | undefined) ?? 'all';
  const tpsRaw = (values.tps as string[] | undefined) ?? DEFAULT_TPS.map(String);
  const tps = [
    ...new Set(tpsRaw.flatMap((v) => v.split(',')).map((v) => integerIn('--tps', v, 1, 20))),
  ];
  const runs = values.runs === undefined ? 5 : integerIn('--runs', values.runs as string, 1, 100);
  const maxMinutes =
    values['max-minutes'] === undefined
      ? null
      : integerIn('--max-minutes', values['max-minutes'] as string, 1, 100_000);
  const note = (values.note as string | undefined) ?? '';
  if (!NOTE_PATTERN.test(note))
    throw new UsageError('--note has characters outside A-Za-z0-9 ,.:_()/+- or is over 200 long');
  const record = values.record === true;
  const allowDirty = values['allow-dirty'] === true;

  let picked: Scenario[];
  if (scenario === 'all') picked = visibleScenarios();
  else {
    const found = findScenario(scenario);
    if (!found) throw new UsageError(`unknown scenario '${scenario}'`);
    picked = [found];
  }
  if (record && picked.some((s) => s.hidden)) {
    throw new UsageError('--record cannot record a hidden scenario');
  }
  if (record && !allowDirty && dirty()) {
    throw new UsageError('--record on a dirty tree: commit first or pass --allow-dirty');
  }
  return {
    scenario,
    scenarios: picked.map((s) => s.name),
    tps: [...tps].sort((a, b) => b - a),
    runs,
    maxMinutes,
    record,
    allowDirty,
    note,
    dryRun: values['dry-run'] === true,
    list: values.list === true,
    restore: values.restore === true,
  };
}

/** What the CLI needs from the world; every part is replaceable in tests. */
export interface CliDeps {
  config?: GolemConfig;
  connectRcon?: (cfg: GolemConfig) => Promise<{ ctl: TestControl; close(): Promise<void> }>;
  createManager?: (
    cfg: GolemConfig,
  ) => ManagerLike & { start(): Promise<Bot>; stop(): Promise<void> };
  cell?: typeof runCell;
  meta?: typeof collectMeta;
  write?: typeof writeResults;
  dirty?: () => boolean;
  installRestore?: (ctl: TestControl) => () => void;
  out?: (line: string) => void;
  err?: (line: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

async function defaultConnect(
  cfg: GolemConfig,
): Promise<{ ctl: TestControl; close(): Promise<void> }> {
  const password = await readRconPassword(cfg);
  const rcon = await RconClient.connect({ host: cfg.rconHost, port: cfg.rconPort, password });
  return { ctl: new TestControl(rcon), close: () => rcon.close() };
}

function defaultManager(
  cfg: GolemConfig,
): ManagerLike & { start(): Promise<Bot>; stop(): Promise<void> } {
  return new ConnectionManager({
    host: cfg.mcHost,
    port: cfg.mcPort,
    username: BENCH_NAME,
    onBot: watchRecipeBook,
    log: () => undefined,
  });
}

/**
 * `GATE: PASS`, `GATE: FAIL (<scenarios>)` or `GATE: INCOMPLETE (truncated)` over the 20 TPS cells.
 * With `requestedRuns`, a 20 TPS cell that played fewer runs (the time limit hit) is truncated: it
 * cannot pass the gate, and a failure among the runs it did play still shows as FAIL.
 */
export function gateLine(
  cells: CellResult[],
  requestedRuns = 0,
  scenarios: string[] = [],
  requested20 = false,
): string {
  const at20 = cells.filter((c) => c.tps === 20);
  if (at20.length === 0 && !requested20) return 'GATE: n/a (no 20 TPS cell ran)';
  const failing = at20.filter((c) => c.runs > 0 && c.passed < c.runs).map((c) => c.scenario);
  if (failing.length > 0) return `GATE: FAIL (${failing.join(', ')})`;
  // A requested scenario whose 20 TPS cell never started cannot pass: the time limit cut it off.
  const missing = requested20 && scenarios.some((s) => !at20.some((c) => c.scenario === s));
  const cutOff = at20.some((c) => c.runs === 0 || c.runs < requestedRuns);
  return missing || cutOff ? 'GATE: INCOMPLETE (truncated)' : 'GATE: PASS';
}

/** One table line per cell, with a warning when the average tick time is over 110% of target. */
export function tableLines(cells: CellResult[], summaryOf: (cell: CellResult) => string): string[] {
  const lines = ['scenario | TPS | passed | p50/p95 ms | mspt'];
  for (const cell of cells) {
    const msptRuns = cell.perRun.filter((r) => r.mspt !== null && r.targetMspt !== null);
    const mean = (pick: (r: CellResult['perRun'][number]) => number | null): number =>
      msptRuns.reduce((sum, r) => sum + (pick(r) ?? 0), 0) / msptRuns.length;
    const avg = msptRuns.length > 0 ? mean((r) => r.mspt) : null;
    const target = msptRuns.length > 0 ? mean((r) => r.targetMspt) : null;
    const warn =
      avg !== null && target !== null && avg > target * 1.1 ? ' WARN over 110% of target' : '';
    const mspt = avg === null ? 'n/a' : `${avg.toFixed(1)}/${(target ?? 0).toFixed(1)}`;
    lines.push(`${cell.scenario} | ${cell.tps} | ${summaryOf(cell)} | ${mspt}${warn}`);
  }
  return lines;
}

/** Waits for the player list to show nobody, up to `maxMs`. */
async function waitForEmpty(
  ctl: TestControl,
  maxMs: number,
  deps: Required<Pick<CliDeps, 'now' | 'sleep'>>,
): Promise<boolean> {
  const deadline = deps.now() + maxMs;
  for (;;) {
    const match = LIST_PATTERN.exec(await ctl.command('list'));
    if (match && Number(match[1]) === 0) return true;
    if (deps.now() >= deadline) return false;
    await deps.sleep(500);
  }
}

/** Names after the colon of a `list` reply. */
function playerNames(reply: string): string[] {
  const colon = reply.indexOf(':');
  return reply
    .slice(colon + 1)
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n !== '');
}

/** Runs the CLI and returns the exit code: 0, 1 for a harness error, 2 for bad usage. */
export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  const out = deps.out ?? ((line: string) => console.log(line));
  const err = deps.err ?? ((line: string) => console.error(line));
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let options: Options;
  try {
    options = parseCli(argv, deps.dirty);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    err(error.message);
    err(USAGE);
    return 2;
  }
  if (options.list) {
    for (const scenario of visibleScenarios()) out(scenario.name);
    return 0;
  }
  if (options.dryRun) {
    out(JSON.stringify(options));
    return 0;
  }

  const cfg = deps.config ?? loadConfig();
  let rcon: { ctl: TestControl; close(): Promise<void> };
  try {
    rcon = await (deps.connectRcon ?? defaultConnect)(cfg);
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const { ctl } = rcon;
  let removeRestore: (() => void) | undefined;
  let manager: ReturnType<NonNullable<CliDeps['createManager']>> | undefined;
  try {
    if (options.restore) {
      await restoreWorld(ctl);
      out('world restored, 20 TPS');
      return 0;
    }
    const rate = parseTargetRate(await ctl.tickQuery());
    if (rate !== 20) {
      err(`server was at ${rate ?? 'an unknown number of'} TPS: restoring 20`);
      await ctl.tickRate(20);
    }
    await ctl.whitelistAdd(BENCH_NAME);
    const listing = await ctl.command('list');
    if (!LIST_PATTERN.test(listing)) {
      err(`cannot read the player list: ${listing.trim()}`);
      return 1;
    }
    const names = playerNames(listing);
    // The count decides: a reply that counts players but names none still refuses the run.
    const online = Number(LIST_PATTERN.exec(listing)?.[1]);
    if (online > 0) {
      if (online === 1 && names.length === 1 && names[0] === BENCH_NAME) {
        await ctl.command(`kick ${BENCH_NAME}`);
        if (!(await waitForEmpty(ctl, KICK_WAIT_MS, { now, sleep }))) {
          err(`${BENCH_NAME} did not leave within 15 s`);
          return 1;
        }
      } else {
        err(
          `other players are online: ${names.length > 0 ? names.join(', ') : `${online} (names not listed)`}`,
        );
        return 1;
      }
    }
    removeRestore = (deps.installRestore ?? ((c: TestControl) => installTpsRestore(c)))(ctl);
    manager = (deps.createManager ?? defaultManager)(cfg);
    await manager.start();

    const meta = await (deps.meta ?? collectMeta)(ctl);
    const startedAt = now();
    const deadline =
      options.maxMinutes === null
        ? Number.POSITIVE_INFINITY
        : startedAt + options.maxMinutes * 60_000;
    const shouldStop = (): boolean => now() >= deadline;
    const runCellFn = deps.cell ?? runCell;
    const cells: CellResult[] = [];
    let truncated = false;
    for (const name of options.scenarios) {
      const scenario = findScenario(name) as Scenario;
      for (const tps of options.tps) {
        if (shouldStop()) {
          truncated = true;
          break;
        }
        const cell = await runCellFn(scenario, tps, options.runs, {
          ctl,
          manager,
          registry: createRegistry(),
          botName: BENCH_NAME,
          slot: BENCH_SLOT,
          warmup: gotoSmoke,
          log: out,
          shouldStop,
        });
        cells.push(cell);
        if (cell.runs < options.runs) truncated = true;
      }
    }

    const written = await (deps.write ?? writeResults)(
      { meta, cells, truncated, note: options.note },
      { root: repoRoot(), record: options.record },
    );
    const rows = new Map(written.summary.map((row) => [`${row.scenario}@${row.tps}`, row]));
    const text = (cell: CellResult): string => {
      const row = rows.get(`${cell.scenario}@${cell.tps}`);
      const ms = (v: number | null | undefined): string =>
        v === null || v === undefined ? 'n/a' : String(Math.round(v));
      return `${cell.passed}/${cell.runs} | ${ms(row?.latencyMs.p50)}/${ms(row?.latencyMs.p95)}`;
    };
    for (const line of tableLines(cells, text)) out(line);
    if (truncated) out('truncated: true (stopped before every run started)');
    out(`results: ${written.file}`);
    if (written.recordedFile) out(`recorded: ${written.recordedFile}`);
    out(gateLine(cells, options.runs, options.scenarios, options.tps.includes(20)));
    return 0;
  } catch (error) {
    err(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return 1;
  } finally {
    // 20 TPS and the world rules go back after the bot has left, even on failure.
    try {
      await manager?.stop();
    } catch {
      // Stopping is best effort.
    }
    if (!options.restore) {
      try {
        await restoreWorld(ctl);
      } catch (error) {
        err(`restoreWorld failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    removeRestore?.();
    await rcon.close().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
