import { statfsSync } from 'node:fs';
import { readOnly, type SqlClient } from './glass-client.ts';
import type { Clock, Observation, Probe, Processes, Runner, Sampler, Service } from './ports.ts';
import { serviceAlive } from './safe-stop.ts';
import { COMPOSE_FILE, COMPOSE_PROJECT, OLLAMA } from './stack-endpoints.ts';
import { TICK_WINDOW_MS, type TickPoint, tickRate } from './tick-rate.ts';

export interface SamplerDeps {
  runner: Runner;
  sql: SqlClient;
  processes: Processes;
  clock: Clock;
  lifeId: () => string;
  repoRoot: string;
}

/** A Body event within this long before a sample counts the Body as connected at that sample. */
export const BODY_EVENT_GRACE_MS = 60_000;

/** One status sample. TPS is null when the server_tps events of the last 5 minutes do not give a rate (see tick-rate.ts). */
export function createSampler(deps: SamplerDeps): Sampler {
  const composePs = async (): Promise<Record<string, string>> => {
    const res = await deps.runner.exec('docker', [
      'compose',
      '-f',
      COMPOSE_FILE,
      '-p',
      COMPOSE_PROJECT,
      'ps',
      '--format',
      'json',
    ]);
    if (res.code !== 0) throw new Error(`docker compose ps exited ${res.code}`);
    const text = res.stdout.trim();
    const rows: Record<string, unknown>[] =
      text === ''
        ? []
        : text.startsWith('[')
          ? JSON.parse(text)
          : text.split('\n').map((l) => JSON.parse(l));
    return Object.fromEntries(rows.map((r) => [String(r.Service), String(r.State)]));
  };
  const ollamaUp = async (): Promise<boolean> => {
    try {
      const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  };
  return {
    async observe(runStartMs: number): Promise<Observation> {
      const atMs = deps.clock.nowMs();
      const lifeId = deps.lifeId();
      const procs = deps.processes.list();
      const running = (service: Service): boolean => serviceAlive(service, procs);
      const states = await composePs();
      const stackUp = (name: string): boolean => states[name] === 'running';
      const gpu = await deps.runner.exec('nvidia-smi', [
        '--query-gpu=name',
        '--format=csv,noheader',
      ]);
      const disk = statfsSync(deps.repoRoot);
      const sql = await readOnly(deps.sql, async (q) => {
        // Every row is bounded by the run start: a life keeps its rows after a run ends, so a rerun must not read them.
        const since = new Date(runStartMs);
        const t = await q.query(
          'SELECT count(*)::int AS n, max(at) AS last FROM thoughts WHERE life_id = $1 AND at >= $2',
          [lifeId, since],
        );
        const p95 = await q.query(
          "SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p FROM thoughts WHERE life_id = $1 AND at >= $2 AND at > now() - interval '30 minutes'",
          [lifeId, since],
        );
        // Death events, not agents.died_at: nothing in the repo writes died_at, so it would always read 0.
        const d = await q.query(
          "SELECT count(*)::int AS n FROM events WHERE agent_id = $1 AND type = 'death' AND at >= $2",
          [lifeId, new Date(runStartMs)],
        );
        // Intents carry no time: the run's intents are those a thought of this run made.
        const i = await q.query(
          "SELECT intent_id FROM intents WHERE life_id = $1 AND state IN ('accepted','running') AND thought_id IN (SELECT thought_id FROM thoughts WHERE life_id = $1 AND at >= $2) ORDER BY started_tick DESC NULLS LAST LIMIT 1",
          [lifeId, since],
        );
        // The shard's tick counter from its server_tps events (no agent on those rows), read from the run start.
        const tk = await q.query(
          "SELECT at, world_tick FROM events WHERE type = 'server_tps' AND at >= $1 ORDER BY at",
          [new Date(Math.max(runStartMs, atMs - TICK_WINDOW_MS))],
        );
        // The Body's own events for the life. A Body that is alive but hung writes none; the process probe cannot tell.
        const b = await q.query(
          "SELECT max(at) AS last FROM events WHERE agent_id = $1 AND type IN ('intent', 'action', 'receipt', 'reflex_fired', 'wake', 'speech') AND at >= $2",
          [lifeId, since],
        );
        return {
          t: t.rows[0],
          p95: p95.rows[0],
          d: d.rows[0],
          i: i.rows[0],
          tk: tk.rows,
          b: b.rows[0],
        };
      });
      const bodyLast = sql.b?.last;
      const tickPoints = (sql.tk ?? []).flatMap((r): TickPoint[] =>
        r.at instanceof Date ? [{ atMs: r.at.getTime(), tick: Number(r.world_tick) }] : [],
      );
      const lastAt = sql.t?.last;
      const p95 = sql.p95?.p;
      const alive: Record<Probe, boolean> = {
        animus: running('animus'),
        body: running('body'),
        'lantern-local': running('lantern-local'),
        ollama: await ollamaUp(),
        postgres: stackUp('postgres'),
        nats: stackUp('nats'),
        paper: stackUp('paper'),
      };
      return {
        atMs,
        lifeId,
        alive,
        thoughts: Number(sql.t?.n ?? 0),
        lastThoughtAtMs: lastAt instanceof Date ? lastAt.getTime() : null,
        tps: tickRate(tickPoints, atMs),
        latencyP95Ms: p95 === null || p95 === undefined ? null : Number(p95),
        activeIntentId: sql.i?.intent_id === undefined ? null : String(sql.i.intent_id),
        deaths: Number(sql.d?.n ?? 0),
        gpuPresent: gpu.code === 0 && gpu.stdout.trim() !== '',
        diskFreeGb: (Number(disk.bavail) * Number(disk.bsize)) / 1e9,
        // The Body's events, not its process: the process stays in alive.body. Connected means an event in the last grace.
        bodyConnected: bodyLast instanceof Date && atMs - bodyLast.getTime() <= BODY_EVENT_GRACE_MS,
        errorsSinceLast: 0,
      };
    },
    async close(): Promise<void> {
      await deps.sql.close?.();
    },
  };
}
