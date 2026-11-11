/**
 * A minimal OTLP/HTTP (JSON) push of the Kino counters to SigNoz. No SDK, no dependency: one POST of
 * `resourceMetrics` per interval. The only attribute is `reason` on the refusal counter (a fixed set);
 * there is no agent, login or account attribute. Off when the endpoint is unset.
 */
import type { KinoMetrics, KinoMetricsSnapshot } from './metrics.ts';

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<unknown>;

export const OTLP_INTERVAL_MS = 30_000;

/** The OTLP JSON body for one snapshot. `nowNs` is the data point time in nanoseconds. */
export function otlpBody(s: KinoMetricsSnapshot, nowNs: string, startNs: string): object {
  const point = (value: number, attrs: object[] = []) => ({
    asInt: String(Math.trunc(value)),
    timeUnixNano: nowNs,
    startTimeUnixNano: startNs,
    attributes: attrs,
  });
  return {
    resourceMetrics: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'geldar-glass' } }] },
        scopeMetrics: [
          {
            scope: { name: 'geldar.kino' },
            metrics: [
              { name: 'kino.panes_open', gauge: { dataPoints: [point(s.panes_open)] } },
              {
                name: 'kino.bytes_sent',
                sum: {
                  aggregationTemporality: 2,
                  isMonotonic: true,
                  dataPoints: [point(s.bytes_sent)],
                },
              },
              {
                name: 'kino.refusals',
                sum: {
                  aggregationTemporality: 2,
                  isMonotonic: true,
                  dataPoints: Object.entries(s.refusals).map(([reason, n]) =>
                    point(n ?? 0, [{ key: 'reason', value: { stringValue: reason } }]),
                  ),
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

export interface OtlpOptions {
  /** OTLP/HTTP base URL (GELDAR_KINO_OTLP_ENDPOINT). Unset or empty: nothing is exported. */
  endpoint: string | undefined;
  fetch?: Fetch;
  intervalMs?: number;
  now?: () => number;
}

/** Starts the push loop. Returns a stop function, or null when the endpoint is unset (exporter off). */
export function startOtlpExporter(metrics: KinoMetrics, o: OtlpOptions): (() => void) | null {
  if (!o.endpoint) return null;
  const url = `${o.endpoint.replace(/\/+$/, '')}/v1/metrics`;
  const doFetch: Fetch =
    o.fetch ?? ((u, init) => fetch(u, { ...init, signal: AbortSignal.timeout(5_000) }));
  const now = o.now ?? Date.now;
  const startNs = `${now()}000000`;
  const push = (): void => {
    const body = JSON.stringify(otlpBody(metrics.snapshot(), `${now()}000000`, startNs));
    // A failed push is dropped: metrics must never affect a pane, and the next interval resends totals.
    void Promise.resolve(
      doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body }),
    ).catch(() => {});
  };
  const timer = setInterval(push, o.intervalMs ?? OTLP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
