/**
 * Metrics for the golem Body (decision 0088): counters and gauges with fixed label names, pushed as
 * OTLP/HTTP JSON to the telemetry endpoint. Push only: no route, no listener, nothing served. The URL is
 * `GELDAR_TELEMETRY_URL`; when it is unset nothing is started, no timer and no request. Labels take
 * closed values only (a wake reason, an action status, an action fail reason). A label named after a
 * player, a life or a token is refused when declared, and no agent name, thought, persona, prompt or
 * token is ever recorded here. The MCP keeps its own copy of the registry and push code (no shared
 * package yet; see the worknote for the follow-up).
 */

import type { RecordSink } from './body/records.ts';

export type MetricKind = 'counter' | 'gauge' | 'histogram';
export type Labels = Record<string, string>;

const NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
/** A label whose name mentions a player, a life or a token is refused (privacy rule, 0088). */
const FORBIDDEN_LABEL = /player|life|token/i;

interface Point {
  labels: Labels;
  value: number;
  /** Histograms only: one count per bound plus the overflow bucket, not cumulative. */
  bucketCounts: number[];
  count: number;
  sum: number;
}

interface Family {
  kind: MetricKind;
  help: string;
  labelNames: string[];
  bounds: number[];
  points: Map<string, Point>;
}

/** The registry. Every metric is declared once, with its label names, before use. */
export class MetricRegistry {
  private readonly families = new Map<string, Family>();

  declare(
    kind: MetricKind,
    name: string,
    help: string,
    labelNames: readonly string[] = [],
    bounds: readonly number[] = [],
  ): void {
    if (!NAME.test(name)) throw new Error(`metric name ${name} is not valid`);
    if (this.families.has(name)) throw new Error(`metric ${name} is declared twice`);
    for (const label of labelNames) {
      if (!NAME.test(label) || FORBIDDEN_LABEL.test(label)) {
        throw new Error(`label ${label} on ${name} is not allowed`);
      }
    }
    this.families.set(name, {
      kind,
      help,
      labelNames: [...labelNames],
      bounds: [...bounds].sort((a, b) => a - b),
      points: new Map(),
    });
  }

  /** Adds `amount` to a counter. */
  add(name: string, labels: Labels = {}, amount = 1): void {
    this.point(name, 'counter', labels).value += amount;
  }

  /** Sets a gauge. */
  set(name: string, labels: Labels, value: number): void {
    this.point(name, 'gauge', labels).value = value;
  }

  /** The Prometheus text exposition format, one family after another. */
  render(): string {
    const lines: string[] = [];
    for (const [name, family] of this.families) {
      lines.push(`# HELP ${name} ${family.help}`, `# TYPE ${name} ${family.kind}`);
      for (const point of family.points.values()) {
        lines.push(`${name}${formatLabels(point.labels)} ${point.value}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  /** The metrics as OTLP/HTTP JSON `metrics` entries, stamped at `timeUnixNano`. */
  otlp(timeUnixNano: string): object[] {
    const metrics: object[] = [];
    for (const [name, family] of this.families) {
      const dataPoints = [...family.points.values()].map((point) => ({
        attributes: toAttributes(point.labels),
        timeUnixNano,
        asDouble: point.value,
      }));
      const body = { dataPoints };
      const data =
        family.kind === 'counter'
          ? { sum: { ...body, aggregationTemporality: 2, isMonotonic: true } }
          : { gauge: body };
      metrics.push({ name, description: family.help, ...data });
    }
    return metrics;
  }

  private point(name: string, kind: MetricKind, labels: Labels): Point {
    const family = this.families.get(name);
    if (!family) throw new Error(`metric ${name} is not declared`);
    if (family.kind !== kind) throw new Error(`metric ${name} is a ${family.kind}, not a ${kind}`);
    const keys = Object.keys(labels);
    if (
      keys.length !== family.labelNames.length ||
      keys.some((k) => !family.labelNames.includes(k))
    ) {
      throw new Error(`metric ${name} takes labels ${family.labelNames.join(', ') || 'none'}`);
    }
    const key = family.labelNames.map((k) => `${k}=${labels[k]}`).join(',');
    let point = family.points.get(key);
    if (!point) {
      point = { labels: { ...labels }, value: 0, bucketCounts: [], count: 0, sum: 0 };
      family.points.set(key, point);
    }
    return point;
  }
}

function formatLabels(labels: Labels): string {
  const pairs = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return pairs.length === 0 ? '' : `{${pairs.join(',')}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function toAttributes(labels: Labels): object[] {
  return Object.entries(labels).map(([key, value]) => ({ key, value: { stringValue: value } }));
}

/** A push with no answer after this long is abandoned, so a hung receiver cannot hold the Body's stop. */
const PUSH_TIMEOUT_MS = 5000;

export interface PushOptions {
  /** The telemetry endpoint's base URL (the OTLP/HTTP port). Only `startTelemetry` pushes, and only with one. */
  url: string;
  service: string;
  log: (line: Record<string, string | number>) => void;
  fetch?: typeof fetch | undefined;
  now?: (() => number) | undefined;
  /** How long one push may wait for its answer. Defaults to 5 seconds; tests shorten it. */
  timeoutMs?: number | undefined;
}

/**
 * Sends the registry once as OTLP/HTTP JSON to `<url>/v1/metrics`. A failed or timed-out push is logged
 * with its status code (0 for a network failure or a timeout) and does not throw: the Body keeps running.
 */
export async function pushMetrics(registry: MetricRegistry, options: PushOptions): Promise<void> {
  const fetchFn = options.fetch ?? fetch;
  const nowMs = options.now ? options.now() : Date.now();
  const timeUnixNano = String(BigInt(nowMs) * BigInt(1_000_000));
  const payload = {
    resourceMetrics: [
      {
        resource: { attributes: toAttributes({ 'service.name': options.service }) },
        scopeMetrics: [{ scope: { name: 'geldar' }, metrics: registry.otlp(timeUnixNano) }],
      },
    ],
  };
  const endpoint = `${String(options.url).replace(/\/+$/, '')}/v1/metrics`;
  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs ?? PUSH_TIMEOUT_MS),
    });
    if (!response.ok) options.log({ event: 'telemetry_push_failed', status: response.status });
  } catch {
    options.log({ event: 'telemetry_push_failed', status: 0 });
  }
}

/**
 * Pushes on a timer. With no endpoint it does nothing at all: no timer, no request. The first push
 * happens at once, then every `intervalMs`; a tick while a push is still in flight starts none, so
 * pushes never pile up. The timer does not keep the process alive. `stop` starts no further push and
 * resolves once every push already in flight has settled.
 */
export function startTelemetry(
  registry: MetricRegistry,
  options: Omit<PushOptions, 'url'> & { url: string | undefined; intervalMs: number },
): { stop(): Promise<void> } {
  const { url, intervalMs, ...rest } = options;
  if (!url) return { stop: async () => {} };
  const pushOptions: PushOptions = { ...rest, url };
  const inFlight = new Set<Promise<void>>();
  let stopped = false;
  const push = (): void => {
    if (stopped) return;
    const request: Promise<void> = pushMetrics(registry, pushOptions).finally(() => {
      inFlight.delete(request);
    });
    inFlight.add(request);
  };
  const tick = (): void => {
    if (inFlight.size === 0) push();
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  push();
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await Promise.allSettled([...inFlight]);
    },
  };
}

/** Closed label values. Anything outside them is recorded as `other` (or `none` for a missing reason). */
export const WAKE_REASON_LABELS = [
  'directly_addressed',
  'precondition_failed',
  'unexpected_damage',
  'goal_completed',
  'new_agent_within',
  'reflex_danger',
  'action_failed',
  'limit_reached',
  'no_plan',
  'other',
] as const;
export const OUTCOME_STATUS_LABELS = ['completed', 'failed', 'cancelled', 'other'] as const;
export const OUTCOME_REASON_LABELS = [
  'none',
  'invalid_args',
  'timeout',
  'blocked',
  'not_found',
  'out_of_reach',
  'missing_materials',
  'missing_station',
  'not_possible',
  'interrupted',
  'unsupported',
  'busy',
  'internal',
  'other',
] as const;

export const BODY_CONNECTED = 'geldar_body_connected';
export const BODY_TPS = 'geldar_tps';
export const BODY_TICK_LAG_MS = 'geldar_tick_lag_ms';
export const BODY_WAKEUPS = 'geldar_wakeups_total';
export const BODY_ACTION_OUTCOMES = 'geldar_action_outcomes_total';

/** A window this long is averaged into one TPS and tick-lag sample. */
const TPS_WINDOW_MS = 10_000;
/** Minecraft's tick length in milliseconds, and its nominal rate. */
const TICK_MS = 50;
const NOMINAL_TPS = 20;

/** The wake label for a reason: `new_agent_within_<n>` folds into one label; unknown reasons are `other`. */
export function wakeLabel(reason: string): (typeof WAKE_REASON_LABELS)[number] {
  if (reason.startsWith('new_agent_within_')) return 'new_agent_within';
  const known = WAKE_REASON_LABELS as readonly string[];
  return known.includes(reason) ? (reason as (typeof WAKE_REASON_LABELS)[number]) : 'other';
}

/** The Body's metrics: one registry, declared once, fed from the Body's own records and world clock. */
export class GolemMetrics {
  private windowStart: { age: number; ms: number } | null = null;
  private lastAge = Number.NEGATIVE_INFINITY;

  readonly registry: MetricRegistry;

  constructor(registry: MetricRegistry) {
    this.registry = registry;
    registry.declare('gauge', BODY_CONNECTED, 'Body connected to the server (1) or not (0)');
    registry.declare('gauge', BODY_TPS, 'Server ticks per second over the last window');
    registry.declare('gauge', BODY_TICK_LAG_MS, 'Extra milliseconds per server tick over 50 ms');
    registry.declare('counter', BODY_WAKEUPS, 'Wake-ups of the Mind by closed reason', ['reason']);
    registry.declare('counter', BODY_ACTION_OUTCOMES, 'Action outcomes by status and fail reason', [
      'status',
      'reason',
    ]);
  }

  /** The Body's link is up (1) or gone (0). */
  bodyConnected(up: boolean): void {
    this.registry.set(BODY_CONNECTED, {}, up ? 1 : 0);
  }

  /**
   * One server world age, from a time packet, at wall time `nowMs`. Over each window of about ten
   * seconds it sets the TPS gauge (capped at 20) and the tick-lag gauge. A backwards age (a new world)
   * starts a new window.
   */
  worldAge(age: number, nowMs: number): void {
    if (!Number.isFinite(age)) return;
    if (this.windowStart === null || age < this.lastAge) {
      this.windowStart = { age, ms: nowMs };
      this.lastAge = age;
      return;
    }
    this.lastAge = age;
    const ticks = age - this.windowStart.age;
    const elapsed = nowMs - this.windowStart.ms;
    if (elapsed < TPS_WINDOW_MS || ticks <= 0) return;
    const tps = Math.min(NOMINAL_TPS, (ticks * 1000) / elapsed);
    const lag = Math.max(0, elapsed / ticks - TICK_MS);
    this.registry.set(BODY_TPS, {}, Number(tps.toFixed(2)));
    this.registry.set(BODY_TICK_LAG_MS, {}, Number(lag.toFixed(2)));
    this.windowStart = { age, ms: nowMs };
  }

  /** One wake the Body decided on. */
  wake(reason: string): void {
    this.registry.add(BODY_WAKEUPS, { reason: wakeLabel(reason) });
  }

  /** One action that reached a terminal result. */
  actionOutcome(status: string, reason: string | undefined): void {
    const statusLabel = (OUTCOME_STATUS_LABELS as readonly string[]).includes(status)
      ? status
      : 'other';
    const known = OUTCOME_REASON_LABELS as readonly string[];
    const reasonLabel = reason === undefined ? 'none' : known.includes(reason) ? reason : 'other';
    this.registry.add(BODY_ACTION_OUTCOMES, { status: statusLabel, reason: reasonLabel });
  }
}

/** Passes every record on to `inner` and counts the wakes and the terminal action results. */
export function countingSink(inner: RecordSink, metrics: GolemMetrics): RecordSink {
  return {
    intentChanged: (change) => inner.intentChanged(change),
    actionChanged: (record) => {
      const result = record.result;
      if (result) {
        const reason = typeof result.reason === 'string' ? result.reason : undefined;
        metrics.actionOutcome(String(result.status), reason);
      }
      inner.actionChanged(record);
    },
    receipt: (receipt) => inner.receipt(receipt),
    reflexFired: (record) => inner.reflexFired(record),
    wake: (request) => {
      metrics.wake(request.reason);
      inner.wake(request);
    },
    actionOutcome: (payload, tick) => inner.actionOutcome?.(payload, tick),
  };
}

export interface GolemTelemetry {
  /** Where the Body reports. Works with or without a URL; only a URL makes it push. */
  metrics: GolemMetrics;
  /** Stops the timer and resolves once any push in flight has settled. */
  stop(): Promise<void>;
}

/**
 * Starts the Body's telemetry from the environment. Without `GELDAR_TELEMETRY_URL` there is no
 * timer and no request; `metrics` still records in memory, which costs nothing outside the process.
 */
export function startGolemTelemetry(
  env: Record<string, string | undefined>,
  options: {
    service: string;
    log: (line: Record<string, string | number>) => void;
    intervalMs?: number;
    fetch?: typeof fetch;
    timeoutMs?: number;
  },
): GolemTelemetry {
  const metrics = new GolemMetrics(new MetricRegistry());
  const url = env.GELDAR_TELEMETRY_URL?.trim() || undefined;
  const handle = startTelemetry(metrics.registry, {
    url,
    service: options.service,
    log: options.log,
    intervalMs: options.intervalMs ?? 15_000,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
  });
  return { metrics, stop: handle.stop };
}
