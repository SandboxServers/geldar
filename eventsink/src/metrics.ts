/**
 * Metrics for the eventsink (decision 0088): counters and a gauge with fixed label names, pushed as
 * OTLP/HTTP JSON to the telemetry endpoint. Push only: no route, no listener, nothing served. With no
 * `GELDAR_TELEMETRY_URL`, `eventsinkTelemetry` returns undefined: no metrics, no timer, no request.
 * Labels take closed values only: an event type from the contract's list (`other` for anything else),
 * or a failure reason (`parse`, `validate` or `db`). No payload, subject text, event id or life id is
 * ever recorded. The MCP and the golem keep their own copies of this registry and push code (no shared
 * package yet; the follow-up is one shared helper).
 */

export type Labels = Record<string, string>;

const NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
/** A label whose name mentions a player, a life or a token is refused (privacy rule, 0088). */
const FORBIDDEN_LABEL = /player|life|token/i;

interface Point {
  labels: Labels;
  value: number;
}

interface Family {
  kind: 'counter' | 'gauge';
  help: string;
  labelNames: string[];
  points: Map<string, Point>;
}

/** The registry. Every metric is declared once, with its label names, before use. */
export class MetricRegistry {
  private readonly families = new Map<string, Family>();

  declare(
    kind: Family['kind'],
    name: string,
    help: string,
    labelNames: readonly string[] = [],
  ): void {
    if (!NAME.test(name)) throw new Error(`metric name ${name} is not valid`);
    if (this.families.has(name)) throw new Error(`metric ${name} is declared twice`);
    for (const label of labelNames) {
      if (!NAME.test(label) || FORBIDDEN_LABEL.test(label)) {
        throw new Error(`label ${label} on ${name} is not allowed`);
      }
    }
    this.families.set(name, { kind, help, labelNames: [...labelNames], points: new Map() });
  }

  /** Adds `amount` to a counter. */
  add(name: string, labels: Labels = {}, amount = 1): void {
    this.point(name, 'counter', labels).value += amount;
  }

  /** Sets a gauge. */
  set(name: string, labels: Labels, value: number): void {
    this.point(name, 'gauge', labels).value = value;
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

  private point(name: string, kind: Family['kind'], labels: Labels): Point {
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
      point = { labels: { ...labels }, value: 0 };
      family.points.set(key, point);
    }
    return point;
  }
}

function toAttributes(labels: Labels): object[] {
  return Object.entries(labels).map(([key, value]) => ({ key, value: { stringValue: value } }));
}

export interface PushOptions {
  /** The telemetry endpoint's base URL (the OTLP/HTTP port). */
  url: string;
  service: string;
  log: (line: Record<string, string | number>) => void;
  fetch?: typeof fetch | undefined;
  now?: (() => number) | undefined;
}

/**
 * Sends the registry once as OTLP/HTTP JSON to `<url>/v1/metrics`. A failed push is logged with its
 * status code (0 for a network failure) and does not throw: the eventsink keeps running.
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
  const endpoint = `${options.url.replace(/\/+$/, '')}/v1/metrics`;
  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) options.log({ event: 'telemetry_push_failed', status: response.status });
  } catch {
    options.log({ event: 'telemetry_push_failed', status: 0 });
  }
}

/** Closed event types: the list in the contract's event schema, plus `dlq`. Anything else is `other`. */
export const EVENT_TYPE_LABELS = [
  'thought',
  'speech',
  'action',
  'damage',
  'death',
  'birth',
  'trade',
  'book_written',
  'book_read',
  'skill_defined',
  'offering',
  'proposal',
  'vote',
  'law',
  'sleep',
  'reflection',
  'server_tps',
  'intent',
  'receipt',
  'reflex_fired',
  'wake',
  'dlq',
  'other',
] as const;

/** Closed failure reasons: a body that is not JSON or not UTF-8, a body that fails validation, a rejected row. */
export const FAIL_REASON_LABELS = ['parse', 'validate', 'db'] as const;
export type FailReason = (typeof FAIL_REASON_LABELS)[number];

export const CONSUMED = 'geldar_eventsink_consumed_total';
export const WRITTEN = 'geldar_eventsink_written_total';
export const FAILED = 'geldar_eventsink_failed_total';
export const DLQ_WRITTEN = 'geldar_eventsink_dlq_written_total';
export const PENDING = 'geldar_eventsink_consumer_pending';

/** The eventsink's metrics: one registry, declared once, fed from the consumer's decisions. */
export class EventsinkMetrics {
  readonly registry = new MetricRegistry();

  constructor() {
    this.registry.declare('counter', CONSUMED, 'Messages handed to the sink by event type', [
      'type',
    ]);
    this.registry.declare('counter', WRITTEN, 'Events committed to Postgres');
    this.registry.declare('counter', FAILED, 'Events dead-lettered by failure reason', ['reason']);
    this.registry.declare('counter', DLQ_WRITTEN, 'Dead letters published to the DLQ subject');
    this.registry.declare('gauge', PENDING, 'Messages pending for the durable consumer');
  }

  /** One message handed to the sink. Its type is the subject's last segment, or `other`. */
  consumed(subject: string): void {
    const type = subject.split('.')[2] ?? '';
    const known = EVENT_TYPE_LABELS as readonly string[];
    this.registry.add(CONSUMED, { type: known.includes(type) ? type : 'other' });
  }

  /** `count` events committed in one transaction. */
  written(count: number): void {
    this.registry.add(WRITTEN, {}, count);
  }

  /** One event that ended in a dead letter, by reason. */
  failed(reason: FailReason): void {
    this.registry.add(FAILED, { reason });
  }

  /** One dead letter stored by JetStream. */
  dlqWritten(): void {
    this.registry.add(DLQ_WRITTEN);
  }

  /** The consumer's pending count, as the server reports it. */
  pending(count: number): void {
    this.registry.set(PENDING, {}, count);
  }
}

/**
 * Reads the consumer's pending count into the gauge. A failed read keeps the last value: the sink
 * must not stop because a metric could not be read.
 */
export async function samplePending(
  metrics: EventsinkMetrics,
  consumer: { info(): Promise<{ num_pending: number }> },
): Promise<void> {
  try {
    metrics.pending((await consumer.info()).num_pending);
  } catch {
    // Keep the last value; the next sample tries again.
  }
}

export interface EventsinkTelemetry {
  metrics: EventsinkMetrics;
  stop(): void;
}

/**
 * Starts the sink's push from the environment. With no `GELDAR_TELEMETRY_URL` it returns undefined:
 * no metrics object, no timer and no request. Otherwise it pushes at once, then every `intervalMs`,
 * with a timer that does not keep the process alive.
 */
export function eventsinkTelemetry(
  env: Record<string, string | undefined>,
  options: {
    service: string;
    log: (line: Record<string, string | number>) => void;
    intervalMs?: number;
    fetch?: typeof fetch;
  },
): EventsinkTelemetry | undefined {
  const url = env.GELDAR_TELEMETRY_URL?.trim() || undefined;
  if (!url) return undefined;
  const metrics = new EventsinkMetrics();
  const pushOptions: PushOptions = {
    url,
    service: options.service,
    log: options.log,
    fetch: options.fetch,
  };
  const timer = setInterval(
    () => void pushMetrics(metrics.registry, pushOptions),
    options.intervalMs ?? 15_000,
  );
  timer.unref();
  void pushMetrics(metrics.registry, pushOptions);
  return { metrics, stop: () => clearInterval(timer) };
}
