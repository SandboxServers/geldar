/**
 * Resolves the parameterised colo host ports to their defaults for tests that compare a published port with a literal.
 * `127.0.0.1:${GELDAR_PORT_<NAME>:-<default>}:<container>` becomes `127.0.0.1:<default>:<container>`, so a changed
 * default still fails the comparison. Any other interpolation, a NAME off the loopback-ports allowlist, or a missing
 * default throws.
 */
import { PARAM_PORT, PARAM_PORT_DEFAULTS } from './loopback-ports.ts';

function resolveEntry(entry: string): string {
  if (!entry.includes('$')) return entry;
  const match = PARAM_PORT.exec(entry);
  if (match === null) {
    throw new Error(
      `port ${JSON.stringify(entry)} is not 127.0.0.1:\${GELDAR_PORT_<NAME>:-<default>}:<container>`,
    );
  }
  const name = match[1] ?? '';
  if (!PARAM_PORT_DEFAULTS.has(name)) {
    throw new Error(
      `port ${JSON.stringify(entry)} uses GELDAR_PORT_${name}, which is not allowlisted`,
    );
  }
  return entry.replace(`\${GELDAR_PORT_${name}:-${match[2] ?? ''}}`, match[2] ?? '');
}

/** The `ports:` list of one service with each parameterised entry replaced by its default. Throws on any other shape. */
export function resolveComposePorts(ports: unknown): string[] {
  if (!Array.isArray(ports) || !ports.every((entry) => typeof entry === 'string')) {
    throw new Error(`ports ${JSON.stringify(ports)} is not a list of strings`);
  }
  return ports.map(resolveEntry);
}
