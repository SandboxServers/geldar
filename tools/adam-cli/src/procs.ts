/**
 * The host processes of an Adam run: what they are, their PID files and the status report.
 * The parsing and formatting here are pure; the process calls live in `run.ts`.
 */

/** One host process of the run. */
export interface Service {
  /** The name `adam logs <service>` and the PID and log file names use. */
  name: 'body' | 'animus' | 'lantern-local';
  /** The package directory it runs from, relative to the repository root. */
  dir: string;
  /** The TypeScript entry point, relative to `dir`. */
  entry: string;
}

/** The Body: its entry point is the command-line marker `restart-body` checks before it signals it. */
export const BODY: Service = { name: 'body', dir: 'golem', entry: 'src/adam/main.ts' };

/**
 * In start order. The Body comes first so it can answer the Mind's first plan; `down` stops in
 * the reverse order, so the Body is last and writes its checkpoint after the Mind has stopped
 * sending it plans.
 */
export const SERVICES: readonly Service[] = [
  BODY,
  { name: 'animus', dir: 'animus', entry: 'src/main.ts' },
  { name: 'lantern-local', dir: 'lantern-local', entry: 'src/main.ts' },
];

/** The services in stop order: the reverse of the start order, so the Body is last. */
export function stopOrder(): Service[] {
  return [...SERVICES].reverse();
}

/** The PID in a PID file, or null when the text is not a positive integer. */
export function parsePid(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[0-9]{1,10}$/.test(trimmed)) return null;
  const pid = Number(trimmed);
  return pid > 0 ? pid : null;
}

export type ProcState = 'running' | 'stopped' | 'stale';

/** One service's state for `adam status`. */
export interface ProcRow {
  name: string;
  state: ProcState;
  pid: number | null;
}

/** running: a live PID. stale: a PID file whose process is gone or unreadable. stopped: no file. */
export function procState(
  pidText: string | null,
  alive: (pid: number) => boolean,
): ProcRow['state'] {
  if (pidText === null) return 'stopped';
  const pid = parsePid(pidText);
  return pid !== null && alive(pid) ? 'running' : 'stale';
}

/** The lines `adam status` prints: just `down` when nothing runs, else one line per service. */
export function formatStatus(rows: ProcRow[], life: string, latencyMs: number | null): string[] {
  if (rows.every((r) => r.state !== 'running')) {
    const stale = rows.filter((r) => r.state === 'stale').map((r) => r.name);
    return stale.length === 0
      ? ['down']
      : [
          'down',
          `stale PID files (the process is gone): ${stale.join(', ')}; run ./geldar.ps1 adam down`,
        ];
  }
  const out = rows.map((r) =>
    r.state === 'running' ? `${r.name}: running (pid ${r.pid})` : `${r.name}: ${r.state}`,
  );
  out.push(`life: ${life}`);
  out.push(
    latencyMs === null ? 'last thought latency: unknown' : `last thought latency: ${latencyMs} ms`,
  );
  return out;
}

/** The latency in the single line `psql -tA` prints for the last thought; null when absent. */
export function parseLatency(output: string): number | null {
  const line = output.trim().split(/\r?\n/)[0] ?? '';
  return /^[0-9]{1,9}$/.test(line) ? Number(line) : null;
}

/** Accepts a life id like `ag_adam_01` only: it goes into a SQL text. */
export function isLifeId(value: string): boolean {
  return /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/.test(value);
}

/** The SQL that reads the last thought's latency; the life id must pass {@link isLifeId}. */
export function latencySql(life: string): string {
  if (!isLifeId(life)) throw new Error(`'${life}' is not a life id`);
  return `SELECT latency_ms FROM thoughts WHERE life_id = '${life}' AND latency_ms IS NOT NULL ORDER BY at DESC LIMIT 1`;
}
