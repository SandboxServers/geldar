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

/** The colo compose file: no reserved host port, and a resource limit on every service (decision 0082). */
export const COLO_PATH = 'compose/colo.yml';
/** Host ports the colo stack never publishes: 25565 is the game server, 25566 is reserved. */
const RESERVED_HOST_PORTS = [25565, 25566];

/**
 * The one public publish the repo allows (decision 0096, ruling R19): in the public overlay, the velocity service may
 * publish the Minecraft port with the bind address and port taken from env. Nothing else is an exception.
 */
export const PUBLIC_OVERLAY_PATH = 'compose/colo-public.yml';
export const PUBLIC_OVERLAY_SERVICE = 'velocity';
export const PUBLIC_OVERLAY_PORT = '${GELDAR_MC_BIND:?}:${GELDAR_MC_PORT:?}:25565';

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
 * Why one `network_mode:` value is rejected, or null when it is accepted.
 * Only a plain string that is not `host` passes. Anything else (a list, a number,
 * null, or a `$` interpolation that could resolve to `host`) fails closed.
 */
function networkModeProblem(mode: unknown): string | null {
  const shown = JSON.stringify(mode);
  if (typeof mode !== 'string') return `network_mode ${shown} must be a string`;
  if (mode.includes('$')) return `network_mode ${shown} uses interpolation, which is rejected`;
  if (mode === 'host') return 'network_mode: host shares the host network and is rejected';
  return null;
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

/**
 * Why a published host port is refused in the colo file, or null when it is not. A range is refused when it covers
 * a reserved port. A value that is not a number or a range fails closed.
 */
function reservedHostPortProblem(published: unknown): string | null {
  const text = String(published);
  const match = /^(\d+)(?:-(\d+))?$/.exec(text);
  if (match === null)
    return `host port ${JSON.stringify(text)} cannot be read as a number or a range`;
  const low = Number(match[1]);
  const high = match[2] === undefined ? low : Number(match[2]);
  const hit = RESERVED_HOST_PORTS.find((port) => port >= low && port <= high);
  return hit === undefined
    ? null
    : `publishes host port ${hit}, which the colo stack never publishes`;
}

/** The `deploy.resources.limits` mapping of one service, or undefined when it has none. */
function resourceLimits(definition: Record<string, unknown>): unknown {
  const deploy = definition.deploy;
  if (!isRecord(deploy) || !isRecord(deploy.resources)) return undefined;
  return deploy.resources.limits;
}

/**
 * Which colo rules apply to a file: `overlay` for the public Minecraft overlay (it adds one publish to velocity, so\n * the limits and logging live in colo.yml), `base` for colo.yml and any colo*.yml (every service needs its limits and logging),
 * `overlay` for the NATS auth overlay that is merged on colo (its services are the base's, so only the value and
 * security rules apply), or null for every other file.
 */
export function coloRole(path: string): 'base' | 'overlay' | null {
  if (path === PUBLIC_OVERLAY_PATH) return 'overlay';
  // The notice overlay (CD-1d) adds only the deploy secret to admin, so it is an overlay, not a base file (it has no limits).
  if (path === 'compose/colo-notice.yml') return 'overlay';
  if (/^compose\/colo[^/]*\.ya?ml$/.test(path)) return 'base';
  return path === 'compose/nats-auth.yml' ? 'overlay' : null;
}

/** Keys no colo service may set: each one grants the container host-level power (privilege, capabilities, namespaces, devices, sysctls). */
const DENIED_COLO_KEYS = ['privileged', 'pid', 'ipc', 'userns_mode', 'devices', 'sysctls'];
/** Relative bind sources a colo service may mount: the repo paths the stack needs. Named volumes are allowed too. */
const COLO_SOURCE_ALLOWLIST = [
  '../sql',
  '../shards',
  '../plugin',
  '../plugins',
  '../deploy',
  './paper',
  './velocity',
  './bluemap-web',
  './secrets',
];
const BLUEMAP_JAR_SOURCE = '${GELDAR_STATE_DIR:-/var/lib/geldar-colo}/bluemap/bluemap.jar';
const CHUNKY_JAR_SOURCE = '${GELDAR_STATE_DIR:-/var/lib/geldar-colo}/chunky/chunky.jar';
/** Glass's private display-alias directory (docs/runbooks/glass-aliases.md): a directory, so the stack starts without the file. */
const ALIASES_SOURCE = '${GELDAR_STATE_DIR:-/var/lib/geldar-colo}/aliases';
const NAMED_VOLUME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const DEFAULTED = /^\$\{[A-Za-z_][A-Za-z0-9_]*:-([^}]*)\}$/;

/** True when a cpus or memory value is a positive number, or a positive size such as 512m. */
function isPositiveLimit(text: string, kind: 'cpus' | 'memory'): boolean {
  if (kind === 'cpus') return /^\d+(\.\d+)?$/.test(text) && Number(text) > 0;
  const size = /^(\d+(?:\.\d+)?)(b|k|kb|m|mb|g|gb)?$/i.exec(text.trim());
  return size !== null && Number(size[1]) > 0;
}

/** Why one limit is rejected, or null. A literal must be positive; `${VAR:-default}` needs a positive default. */
function limitProblem(name: 'cpus' | 'memory', value: unknown): string | null {
  const shown = JSON.stringify(value);
  const kind = name === 'cpus' ? 'a positive number' : 'a positive size such as 512m';
  if (typeof value === 'number') {
    return isPositiveLimit(String(value), name) ? null : `${name} ${shown} must be ${kind}`;
  }
  if (typeof value !== 'string') return `${name} ${shown} must be ${kind}`;
  if (!value.includes('$')) {
    return isPositiveLimit(value, name) ? null : `${name} ${shown} must be ${kind}`;
  }
  const defaulted = DEFAULTED.exec(value);
  if (defaulted === null) {
    return `${name} ${shown} must be ${kind}, or \${VAR:-default} with a positive default`;
  }
  return isPositiveLimit(defaulted[1] ?? '', name)
    ? null
    : `${name} ${shown} has a default that is not ${kind}`;
}

/** Why one volume source is rejected, or null. Named volumes and the allowlisted relative paths pass. */
function sourceProblem(source: string): string | null {
  const shown = JSON.stringify(source);
  if (/docker\.sock/i.test(source)) return `volume ${shown} mounts docker.sock, which is rejected`;
  // The one interpolated host source: the deploy's verified BlueMap jar (C2-07o). Long form only; any other `$` is rejected.
  if (source === BLUEMAP_JAR_SOURCE || source === CHUNKY_JAR_SOURCE || source === ALIASES_SOURCE)
    return null;
  if (source.includes('$')) return `volume ${shown} uses interpolation, which is rejected`;
  if (/^(\/|~|[A-Za-z]:)/.test(source) || source.includes('\\')) {
    return `volume ${shown} is an absolute host path, which is rejected`;
  }
  if (NAMED_VOLUME.test(source)) return null;
  const prefix = COLO_SOURCE_ALLOWLIST.find((p) => source === p || source.startsWith(`${p}/`));
  if (prefix === undefined) return `volume ${shown} is not in the colo allowlist`;
  // An allowed prefix may start with `../`, so `..` is refused only in the part after it.
  const rest = source.slice(prefix.length).split('/');
  return rest.includes('..')
    ? `volume ${shown} climbs out of its directory, which is rejected`
    : null;
}

/** Why one `volumes:` entry is rejected, or null. Short form (src:dst[:mode]) and long form (source:) both pass through sourceProblem. */
function volumeProblem(entry: unknown): string | null {
  const shown = JSON.stringify(entry);
  if (typeof entry === 'string') {
    // A Windows drive path (C:\...) has a colon of its own, so it is refused before the split.
    if (/^[A-Za-z]:[\\/]/.test(entry))
      return `volume ${shown} is an absolute host path, which is rejected`;
    // No colon: an anonymous volume at a container path, which mounts nothing from the host.
    if (!entry.includes(':'))
      return entry.includes('$') ? `volume ${shown} uses interpolation` : null;
    return sourceProblem(entry.slice(0, entry.indexOf(':')));
  }
  if (isRecord(entry) && typeof entry.source === 'string') return sourceProblem(entry.source);
  if (isRecord(entry) && entry.source !== undefined)
    return `volume ${shown} has a source that is not a string`;
  return null;
}

/** The Watchtower opt-out label (FX-WATCHTOWER): the node's auto-updater must leave every colo service alone. */
export const WATCHTOWER_LABEL = 'com.centurylinklabs.watchtower.enable';

/** The `[key, value]` pairs of a `labels:` value in the map or the list (KEY=VALUE) form, or null for any other shape. */
function labelPairs(labels: unknown): [string, unknown][] | null {
  if (labels === undefined) return [];
  if (isRecord(labels)) return Object.entries(labels);
  if (!Array.isArray(labels) || !labels.every((item) => typeof item === 'string')) return null;
  return labels.map((item): [string, string] => {
    const cut = item.indexOf('=');
    return cut < 0 ? [item, ''] : [item.slice(0, cut), item.slice(cut + 1)];
  });
}

/**
 * Why the Watchtower opt-out label is wrong on one service, or null. Every base service must set it to "false" (a
 * YAML false is the same value to compose). The overlay may add services' labels, so it is checked only where it sets
 * the label: an overlay that sets it to anything but "false" fails. A misspelled key fails as a missing label.
 */
function watchtowerProblem(
  role: 'base' | 'overlay',
  definition: Record<string, unknown>,
): string | null {
  const pairs = labelPairs(definition.labels);
  if (pairs === null) return 'labels must be a mapping or a list of KEY=VALUE strings';
  const own = pairs.filter(([key]) => key === WATCHTOWER_LABEL);
  if (own.length === 0) {
    if (role === 'overlay') return null;
    const near = pairs.find(([key]) => /watchtower/i.test(key));
    return near === undefined
      ? `has no ${WATCHTOWER_LABEL} label; every colo service needs it set to "false"`
      : `has no ${WATCHTOWER_LABEL} label; it has ${JSON.stringify(near[0])}, which is not that key`;
  }
  const bad = own.find(([, value]) => value !== 'false' && value !== false);
  return bad === undefined
    ? null
    : `${WATCHTOWER_LABEL} must be "false", not ${JSON.stringify(bad[1])}`;
}

/**
 * The colo rules for one service: denied keys, the NATS network_mode, the cpus and memory values, the volume allowlist,
 * the Watchtower opt-out label, and (base files only) the required pids_limit, memswap_limit and logging. Each returns a
 * reason, never a value.
 */
function coloServiceProblems(
  role: 'base' | 'overlay',
  definition: Record<string, unknown>,
): string[] {
  const problems: string[] = [];
  for (const key of DENIED_COLO_KEYS) {
    if (key in definition) problems.push(`${key} is not allowed in colo`);
  }
  // The one capability a colo service may add back: Caddy's binary has the file capability cap_net_bind_service,
  // and exec fails without it under cap_drop ALL + no-new-privileges (C2-07i). Anything else stays denied.
  if ('cap_add' in definition) {
    const caps = definition.cap_add;
    const ok = Array.isArray(caps) && caps.length === 1 && caps[0] === 'NET_BIND_SERVICE';
    if (!ok) problems.push('cap_add is not allowed in colo');
  }
  const watchtower = watchtowerProblem(role, definition);
  if (watchtower !== null) problems.push(watchtower);
  if ('network_mode' in definition && networkModeProblem(definition.network_mode) === null) {
    problems.push('network_mode is not allowed in colo; a service joins the colo network');
  }
  if (role === 'base') {
    for (const key of ['pids_limit', 'memswap_limit', 'logging']) {
      if (!(key in definition)) problems.push(`has no ${key}; every colo service needs one`);
    }
  }
  const limits = resourceLimits(definition);
  if (role === 'base' && (!isRecord(limits) || !('cpus' in limits) || !('memory' in limits))) {
    problems.push(
      'has no deploy.resources.limits with cpus and memory; every colo service needs one',
    );
  }
  if (isRecord(limits)) {
    for (const name of ['cpus', 'memory'] as const) {
      if (name in limits) {
        const problem = limitProblem(name, limits[name]);
        if (problem !== null) problems.push(problem);
      }
    }
  }
  if ('volumes' in definition) {
    if (!Array.isArray(definition.volumes)) {
      problems.push('volumes must be a list');
    } else {
      for (const entry of definition.volumes) {
        const problem = volumeProblem(entry);
        if (problem !== null) problems.push(problem);
      }
    }
  }
  return problems;
}

/** The `ports:` entries and host networking of one compose file that break the loopback rule. */
export function findPublicPorts(path: string, text: string): PortFinding[] {
  const role = coloRole(path);
  const isColo = role !== null;
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

  // `include:` pulls in another file that this check does not read, so it is rejected outright.
  const findings: PortFinding[] = [];
  if ('include' in root)
    findings.push(finding('(file)', 'include is not followed, so it is rejected'));

  const services = root.services ?? {};
  if (!isRecord(services)) return [finding('(file)', 'services is not a mapping')];

  for (const [service, definition] of Object.entries(services)) {
    if (!isRecord(definition)) {
      findings.push(finding(service, 'service is not a mapping'));
      continue;
    }
    // `extends:` pulls in another service definition that this check does not read.
    if ('extends' in definition) {
      findings.push(finding(service, 'extends is not followed, so it is rejected'));
    }
    if ('network_mode' in definition) {
      const mode = networkModeProblem(definition.network_mode);
      if (mode !== null) findings.push(finding(service, mode));
    }
    if (role !== null) {
      for (const problem of coloServiceProblems(role, definition)) {
        findings.push(finding(service, problem));
      }
    }
    if (!('ports' in definition)) continue;
    if (!Array.isArray(definition.ports)) {
      findings.push(finding(service, 'ports must be a list'));
      continue;
    }
    for (const entry of definition.ports) {
      // The single allowed exception: the exact env-interpolated Minecraft publish on velocity in the public overlay.
      if (
        path === PUBLIC_OVERLAY_PATH &&
        service === PUBLIC_OVERLAY_SERVICE &&
        entry === PUBLIC_OVERLAY_PORT
      ) {
        continue;
      }
      const problem = portProblem(entry);
      if (problem !== null) findings.push(finding(service, problem));
      if (!isColo) continue;
      // Short form is ip:published:target; long form has a published key. No published value means an ephemeral port.
      const published =
        typeof entry === 'string'
          ? entry.split(':')[1]
          : isRecord(entry)
            ? entry.published
            : undefined;
      if (published === undefined || published === '') continue;
      const reserved = reservedHostPortProblem(published);
      if (reserved !== null) findings.push(finding(service, reserved));
    }
  }
  return findings;
}
