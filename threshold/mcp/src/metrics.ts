/**
 * Metrics for the MCP (decision 0088): counters, gauges and histograms with fixed label names. They are
 * pushed as OTLP/HTTP JSON to the telemetry endpoint, which is set only when GELDAR_TELEMETRY_URL is set.
 * Nothing is served over HTTP: there is no /metrics route on any listener. `render` gives the Prometheus
 * text for a local dump only. A label named after a player, a life or a token is refused when the metric
 * is declared, so no series can carry one. Values are numbers only: no thought text, persona text,
 * prompts, tokens or player names are ever recorded here.
 */

import { MCP_TOOL_NAMES } from '@geldar/contract';
import { TOOL_OUTCOMES } from './http/log.ts';

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

/** The MCP's metric registry. Every metric is declared once, with its label names, before use. */
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

  /** Records one histogram observation. */
  observe(name: string, labels: Labels, value: number): void {
    const point = this.point(name, 'histogram', labels);
    const family = this.families.get(name);
    const index = family?.bounds.findIndex((bound) => value <= bound) ?? -1;
    const bucket = index === -1 ? point.bucketCounts.length - 1 : index;
    point.bucketCounts[bucket] = (point.bucketCounts[bucket] ?? 0) + 1;
    point.count += 1;
    point.sum += value;
  }

  /** The Prometheus text exposition format, one family after another. */
  render(): string {
    const lines: string[] = [];
    for (const [name, family] of this.families) {
      lines.push(`# HELP ${name} ${family.help}`, `# TYPE ${name} ${family.kind}`);
      for (const point of family.points.values()) {
        const labels = formatLabels(point.labels);
        if (family.kind !== 'histogram') {
          lines.push(`${name}${labels} ${point.value}`);
          continue;
        }
        let cumulative = 0;
        family.bounds.forEach((bound, i) => {
          cumulative += point.bucketCounts[i] ?? 0;
          lines.push(
            `${name}_bucket${formatLabels({ ...point.labels, le: String(bound) })} ${cumulative}`,
          );
        });
        lines.push(`${name}_bucket${formatLabels({ ...point.labels, le: '+Inf' })} ${point.count}`);
        lines.push(`${name}_sum${labels} ${point.sum}`, `${name}_count${labels} ${point.count}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  /** The metrics as OTLP/HTTP JSON `resourceMetrics` entries, stamped at `timeUnixNano`. */
  otlp(timeUnixNano: string): object[] {
    const metrics: object[] = [];
    for (const [name, family] of this.families) {
      const dataPoints = [...family.points.values()].map((point) => {
        const base = { attributes: toAttributes(point.labels), timeUnixNano };
        if (family.kind !== 'histogram') return { ...base, asDouble: point.value };
        return {
          ...base,
          count: String(point.count),
          sum: point.sum,
          bucketCounts: family.bounds
            .map((_, i) => String(point.bucketCounts[i] ?? 0))
            .concat(String(point.bucketCounts[family.bounds.length] ?? 0)),
          explicitBounds: family.bounds,
        };
      });
      const body = { dataPoints };
      const data =
        family.kind === 'counter'
          ? { sum: { ...body, aggregationTemporality: 2, isMonotonic: true } }
          : family.kind === 'gauge'
            ? { gauge: body }
            : { histogram: { ...body, aggregationTemporality: 2 } };
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
      point = {
        labels: { ...labels },
        value: 0,
        bucketCounts: new Array(family.bounds.length + 1).fill(0),
        count: 0,
        sum: 0,
      };
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

export interface PushOptions {
  /** The telemetry endpoint's base URL (the OTLP/HTTP port). Only `startTelemetry` pushes without one, never. */
  url: string;
  service: string;
  log: (line: Record<string, string | number>) => void;
  fetch?: typeof fetch | undefined;
  now?: (() => number) | undefined;
}

/**
 * Sends the registry once as OTLP/HTTP JSON to `<url>/v1/metrics`. A failed push is logged with its
 * status code (0 for a network failure) and does not throw: the component keeps running.
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
    });
    if (!response.ok) options.log({ event: 'telemetry_push_failed', status: response.status });
  } catch {
    options.log({ event: 'telemetry_push_failed', status: 0 });
  }
}

/**
 * Pushes on a timer. With no endpoint it does nothing at all: no timer, no request. The first push
 * happens at once, then every `intervalMs`; the timer does not keep the process alive.
 */
export function startTelemetry(
  registry: MetricRegistry,
  options: Omit<PushOptions, 'url'> & { url: string | undefined; intervalMs: number },
): { stop(): void } {
  const { url, intervalMs, ...rest } = options;
  if (!url) return { stop: () => {} };
  const pushOptions: PushOptions = { ...rest, url };
  const timer = setInterval(() => void pushMetrics(registry, pushOptions), intervalMs);
  timer.unref();
  void pushMetrics(registry, pushOptions);
  return { stop: () => clearInterval(timer) };
}

/** The MCP's metric names (decision 0088). Their labels take closed values only: a tool and an outcome. */
export const MCP_TOOL_CALLS = 'geldar_mcp_tool_calls_total';
export const MCP_TOOL_SECONDS = 'geldar_mcp_tool_call_seconds';
const TOOL_SECONDS_BOUNDS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 240];

/** Declares the MCP's metrics, once, before any call is recorded. */
export function declareMcpMetrics(registry: MetricRegistry): void {
  registry.declare('counter', MCP_TOOL_CALLS, 'MCP tool calls by tool and outcome code', [
    'tool',
    'outcome',
  ]);
  registry.declare(
    'histogram',
    MCP_TOOL_SECONDS,
    'MCP tool call latency in seconds',
    ['tool'],
    TOOL_SECONDS_BOUNDS,
  );
}

/**
 * Counts one tool call and times it. A tool name outside the contract's list is recorded as `other`, and
 * an outcome outside the closed `TOOL_OUTCOMES` as `internal`, so no label carries free text.
 */
export function recordToolCall(
  registry: MetricRegistry,
  tool: string,
  outcome: string,
  durationMs: number,
): void {
  const toolLabel = (MCP_TOOL_NAMES as readonly string[]).includes(tool) ? tool : 'other';
  const outcomeLabel = (TOOL_OUTCOMES as readonly string[]).includes(outcome)
    ? outcome
    : 'internal';
  registry.add(MCP_TOOL_CALLS, { tool: toolLabel, outcome: outcomeLabel });
  registry.observe(MCP_TOOL_SECONDS, { tool: toolLabel }, durationMs / 1000);
}
