/**
 * Loopback-only rule (docs/threat-model.md section 1): every service in
 * compose/*.yml publishes its ports on 127.0.0.1 and nowhere else. The file is
 * parsed as YAML, so anchors, aliases, merge keys, quoting and flow or block
 * lists are read the way compose reads them. Anything that cannot be read
 * exactly, or that has an unexpected shape, fails closed.
 */
import { parseAllDocuments } from 'yaml';

export const LOOPBACK_PREFIX = '127.0.0.1:';
const LOOPBACK_HOST = '127.0.0.1';

/** True for the compose files the rule applies to, by repo-relative, forward-slash path. */
export function isComposeFile(path: string): boolean {
  return /^compose\/[^/]+\.ya?ml$/.test(path);
}

export interface PortFinding {
  path: string;
  service: string;
  reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Why one `ports:` entry is not loopback-only, or null when it is.
 * Short syntax must start with `127.0.0.1:`; long syntax needs `host_ip: 127.0.0.1`.
 * Any `$` (compose interpolation, `${VAR}`) is rejected, because the value that
 * compose would bind is not known here.
 */
function portProblem(entry: unknown): string | null {
  const shown = JSON.stringify(entry);
  if (shown.includes('$')) return `port ${shown} uses interpolation, which is rejected`;
  if (typeof entry === 'string') {
    return entry.startsWith(LOOPBACK_PREFIX)
      ? null
      : `port ${shown} must start with ${LOOPBACK_PREFIX}`;
  }
  if (isRecord(entry)) {
    return entry.host_ip === LOOPBACK_HOST
      ? null
      : `long-form mapping ${shown} must set host_ip: ${LOOPBACK_HOST}`;
  }
  return `port ${shown} is not a string or a long-form mapping`;
}

/** The `ports:` entries and host networking of one compose file that break the loopback rule. */
export function findPublicPorts(path: string, text: string): PortFinding[] {
  const finding = (service: string, reason: string): PortFinding => ({ path, service, reason });

  const documents = parseAllDocuments(text, { merge: true });
  const [document] = documents;
  if (
    documents.length !== 1 ||
    document === undefined ||
    document.errors.length > 0 ||
    document.warnings.length > 0
  ) {
    return [finding('(file)', 'is not a single YAML document this check can read')];
  }

  let root: unknown;
  try {
    root = document.toJS();
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return [finding('(file)', `cannot be resolved as YAML (${why})`)];
  }
  if (!isRecord(root)) return [finding('(file)', 'is not a YAML mapping')];

  const services = root.services ?? {};
  if (!isRecord(services)) return [finding('(file)', 'services is not a mapping')];

  const findings: PortFinding[] = [];
  for (const [service, definition] of Object.entries(services)) {
    if (!isRecord(definition)) {
      findings.push(finding(service, 'service is not a mapping'));
      continue;
    }
    if (definition.network_mode === 'host') {
      findings.push(finding(service, 'network_mode: host shares the host network and is rejected'));
    }
    if (!('ports' in definition)) continue;
    if (!Array.isArray(definition.ports)) {
      findings.push(finding(service, 'ports must be a list'));
      continue;
    }
    for (const entry of definition.ports) {
      const problem = portProblem(entry);
      if (problem !== null) findings.push(finding(service, problem));
    }
  }
  return findings;
}
