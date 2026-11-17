/**
 * The P0 scratch probe: one join, one goto and one mine through the Body path, on the scratch
 * compose network only. Run it as `node src/p0/probe.ts` inside the golem image. The isolation
 * check runs first and refuses (exit 2) anything that is not the scratch shape; then the probe
 * admits the username to the Paper whitelist over RCON, registers it in the life registry, joins
 * through Velocity, runs the two actions, and cleans up on every exit. It prints no password, no
 * file contents and no credential: only the username, the UUID the Body was given and the receipts.
 *
 * Operator output (the runbook matches these lines; keep them stable):
 *   stdout, in order:
 *     p0 interrupted by <SIGINT|SIGTERM>                 a signal arrived; the run is aborted
 *     p0 join ok name=ag_nfprobe_01 uuid=<uuid>          the receipt of the join
 *     p0 goto <state> status=<s> [reason=<r>] latency_ms=<ms>   receipt of the goto action
 *     p0 mine <state> status=<s> [reason=<r>] latency_ms=<ms>   receipt of the mine action
 *     p0 cleanup registry=<removed|failed> whitelist=<removed|failed>   the final line
 *   stderr (only when it applies):
 *     p0 probe refused: <rule>                           isolation refusal (exit 2), nothing else runs
 *     p0 rcon password file missing                      the RCON password could not be read (no path)
 *     p0 failed: <reason>                                the step that stopped the run
 *     p0 disconnect failed: <reason>
 *     p0 registry delete failed: <reason>
 *     p0 whitelist remove failed: <reason>
 *     p0 heartbeat failed for <name>: <reason>
 *   exit codes: 0 when the join, goto and mine completed and both entries were removed;
 *   1 for any failure, interruption or failed cleanup step; 2 for an isolation refusal.
 */
import type { Bot } from 'mineflayer';
import { createRegistry } from '../actions/index.ts';
import {
  type ActionRegistry,
  type ActionRun,
  type ActionRunOptions,
  runAction,
} from '../actions/registry.ts';
import { type GolemConfig, readRconPassword } from '../config.ts';
import { ConnectionManager } from '../connection.ts';
import type { AdmissionRcon } from '../players/whitelist.ts';
import { admitLifeOverRcon, removeLifeOverRcon } from '../players/whitelist.ts';
import { RconClient } from '../rcon.ts';
import { type BotRegistry, LifeRegistration, openRegistryBucket } from '../registry.ts';
import { checkIsolation, IsolationRefusal, type ProbePlan } from './isolation.ts';
import { CLEANUP_SETTLE_MS, cleanupProbe } from './probe-cleanup.ts';
import { bounded, gotoAction, mineAction, reasonOf, receiptOf } from './probe-steps.ts';

/** The probe's Body. It is a valid LifeId (`ag_` a letter-led stem, `_01`), so the registry keeps it as is. */
export const PROBE_USERNAME = 'ag_nfprobe_01';
const ADMIT_TIMEOUT_MS = 20_000;
const JOIN_TIMEOUT_MS = 90_000;
const ACTION_TIMEOUT_MS = 120_000;
/** The one message for an RCON password that cannot be read. It never carries the file path. */
const RCON_PASSWORD_MISSING = 'rcon password file missing';

/** A started Body: the promise of its spawned bot, and the way to disconnect it. */
export interface BodyLink {
  bot: Promise<Bot>;
  disconnect(): Promise<void>;
}

/** The side effects of a probe run. Production uses RCON, NATS, Velocity and the bench actions; tests pass fakes. */
export interface ProbeDeps {
  openRcon(cfg: GolemConfig): Promise<AdmissionRcon>;
  registry(cfg: ProbePlan['config']): BotRegistry;
  startBody(cfg: ProbePlan['config'], username: string): BodyLink;
  actions(): ActionRegistry;
  runAction(
    registry: ActionRegistry,
    bot: Bot,
    action: unknown,
    opts: ActionRunOptions,
  ): Promise<ActionRun>;
  onSignal(handler: (name: NodeJS.Signals) => void): () => void;
  out(line: string): void;
  err(line: string): void;
  /** How long cleanup waits for an in-flight write before it reports the step failed. Tests shorten it. */
  cleanupSettleMs?: number;
}

/** The production side effects. */
export const defaultDeps: ProbeDeps = {
  async openRcon(cfg) {
    let password: string;
    try {
      password = await readRconPassword(cfg);
    } catch {
      // readRconPassword's own message names the path; the probe prints only the fixed line.
      throw new Error(RCON_PASSWORD_MISSING);
    }
    return RconClient.connect({ host: cfg.rconHost, port: cfg.rconPort, password });
  },
  registry: (cfg) =>
    new LifeRegistration(
      () => openRegistryBucket(cfg.natsUrl),
      undefined,
      (username, error) => console.error(`p0 heartbeat failed for ${username}: ${reasonOf(error)}`),
    ),
  startBody(cfg, username) {
    // No registry option: the probe registers once and deletes in its own cleanup, so the result is explicit.
    const manager = new ConnectionManager({
      host: cfg.mcHost,
      port: cfg.mcPort,
      username,
      log: () => undefined,
    });
    return { bot: manager.start(), disconnect: () => manager.stop() };
  },
  actions: createRegistry,
  runAction,
  onSignal(handler) {
    const onInt = (): void => handler('SIGINT');
    const onTerm = (): void => handler('SIGTERM');
    process.once('SIGINT', onInt);
    process.once('SIGTERM', onTerm);
    return () => {
      process.removeListener('SIGINT', onInt);
      process.removeListener('SIGTERM', onTerm);
    };
  },
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

/**
 * Runs the probe for an admitted plan and returns the exit code: 0 only when the join, the goto
 * and the mine all completed and the cleanup removed both entries; 1 otherwise. The steps stop at
 * the first failure, and the cleanup runs on every exit, including a signal.
 */
export async function runProbe(plan: ProbePlan, deps: ProbeDeps): Promise<number> {
  const cfg = plan.config;
  const controller = new AbortController();
  const stopSignals = deps.onSignal((name) => {
    if (controller.signal.aborted) return;
    deps.out(`p0 interrupted by ${name}`);
    controller.abort(new Error(`interrupted by ${name}`));
  });
  const { signal } = controller;
  const registry = deps.registry(cfg);
  const actions = deps.actions();
  let link: ReturnType<ProbeDeps['startBody']> | null = null;
  let failure: string | null = null;
  // The raw writes, kept so cleanup can wait for them: `bounded` gives up early, the write does not.
  let admitWrite: Promise<void> | undefined;
  let registryWrite: Promise<void> | undefined;
  try {
    admitWrite = admitLifeOverRcon(() => deps.openRcon(cfg), PROBE_USERNAME);
    await bounded(admitWrite, ADMIT_TIMEOUT_MS, 'whitelist admission timed out', signal);
    registryWrite = registry.register(PROBE_USERNAME);
    await bounded(registryWrite, ADMIT_TIMEOUT_MS, 'registry put timed out', signal);
    link = deps.startBody(cfg, PROBE_USERNAME);
    const bot = await bounded(link.bot, JOIN_TIMEOUT_MS, 'join timed out', signal);
    const uuid = bot.player?.uuid;
    if (uuid === undefined || uuid === '') throw new Error('the Body joined without a UUID');
    deps.out(`p0 join ok name=${PROBE_USERNAME} uuid=${uuid}`);
    const goto = await bounded(
      deps.runAction(actions, bot, gotoAction(bot), { timeScale: 1, signal }),
      ACTION_TIMEOUT_MS,
      'goto timed out',
      signal,
    );
    deps.out(`p0 goto ${receiptOf(goto)}`);
    if (goto.state !== 'completed') throw new Error(`goto ${receiptOf(goto)}`);
    const mine = await bounded(
      deps.runAction(actions, bot, mineAction(), { timeScale: 1, signal }),
      ACTION_TIMEOUT_MS,
      'mine timed out',
      signal,
    );
    deps.out(`p0 mine ${receiptOf(mine)}`);
    if (mine.state !== 'completed') throw new Error(`mine ${receiptOf(mine)}`);
  } catch (error) {
    failure = reasonOf(error);
  }
  const cleanup = await cleanupProbe(
    {
      disconnect: async () => {
        await link?.disconnect();
      },
      registryWrite,
      unregister: () => registry.unregister(PROBE_USERNAME),
      admitWrite,
      unwhitelist: () => removeLifeOverRcon(() => deps.openRcon(cfg), PROBE_USERNAME),
    },
    deps.out,
    deps.err,
    deps.cleanupSettleMs ?? CLEANUP_SETTLE_MS,
  );
  stopSignals();
  if (failure !== null) deps.err(`p0 failed: ${failure}`);
  const clean =
    cleanup.registry === 'removed' &&
    cleanup.whitelist === 'removed' &&
    cleanup.disconnect === 'ok';
  return failure === null && clean ? 0 : 1;
}

/**
 * The probe's entry: the isolation check first (exit 2 on refusal, with nothing opened), then the
 * probe itself. Returns the exit code.
 */
export async function main(
  env: Readonly<Record<string, string | undefined>>,
  deps: ProbeDeps = defaultDeps,
): Promise<number> {
  let plan: ProbePlan;
  try {
    plan = checkIsolation(env);
  } catch (error) {
    deps.err(
      error instanceof IsolationRefusal
        ? error.message
        : 'p0 probe refused: isolation check failed',
    );
    return 2;
  }
  return runProbe(plan, deps);
}

/**
 * What the script runs: `main` with the given env and deps, and a throw that escapes it becomes
 * `p0 failed:` on stderr with exit 1. The script guard below only passes process.env and exits
 * with the returned code, so the test drives this function and not the guard.
 */
export async function runEntry(
  env: Readonly<Record<string, string | undefined>>,
  deps: ProbeDeps = defaultDeps,
): Promise<number> {
  try {
    return await main(env, deps);
  } catch (error) {
    deps.err(`p0 failed: ${reasonOf(error)}`);
    return 1;
  }
}

if (process.argv[1]?.endsWith('probe.ts')) {
  void runEntry(process.env).then((code) => process.exit(code));
}
