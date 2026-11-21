/**
 * The player host's Body telemetry start (decision 0088), shared by the sovereign host (main.ts) and the
 * managed host (managed-main.ts). This module imports only metrics.ts, so it reaches no RCON or
 * whitelist module: the managed host's import graph must stay RCON-free (managed-main.test.ts).
 */
import { type GolemTelemetry, startGolemTelemetry } from '../metrics.ts';

/**
 * The player host's Body metrics (decision 0088). Pushes only when `GELDAR_TELEMETRY_URL` is set; unset,
 * it starts no timer and makes no request, and the Body still records in memory. Labels stay aggregate:
 * no life and no player id reaches a metric.
 */
export function startPlayerTelemetry(
  env: Record<string, string | undefined>,
  log: (line: Record<string, unknown>) => void,
  options: { fetch?: typeof fetch; intervalMs?: number; timeoutMs?: number } = {},
): GolemTelemetry {
  return startGolemTelemetry(env, { service: 'geldar-golem-player', log, ...options });
}
