/**
 * The P0 probe's isolation check. It runs before any network I/O, and it refuses anything that
 * could reach the autonomous (colo) shard. The probe must run on one of two compose projects, each with the
 * in-network opt-in: a scratch project (`scratch-<suffix>`), whose bare service names are velocity,
 * paper and nats, or exactly `geldar-nf` (the nf stack), whose bare service names are velocity,
 * neoforge and nats. The host allow-list is per project class: `paper` is refused on geldar-nf and
 * `neoforge` on a scratch project. Each host must be loopback or a bare service name of its project.
 * The live default ports are refused on loopback, so a loopback address can never stand in for the
 * live stack. Refusals name the rule, never a value, so no secret or path reaches the output.
 */
import type { GolemConfig } from '../config.ts';

/** The scratch project name: `scratch-` and 1 to 9 lower-case letters or digits. */
export const SCRATCH_PROJECT_PATTERN = /^scratch-[a-z0-9]{1,9}$/;

/** The in-network service names a scratch probe may reach (the colo names it shares with the live stack). */
export const SCRATCH_SERVICE_HOSTS: ReadonlySet<string> = new Set(['velocity', 'paper', 'nats']);

/** The one nf project name the probe may run on. Exact match: no prefix, suffix, case or whitespace variant. */
export const NF_PROJECT = 'geldar-nf';

/** The in-network service names of the geldar-nf project. `paper` is not one of them. */
export const NF_SERVICE_HOSTS: ReadonlySet<string> = new Set(['velocity', 'neoforge', 'nats']);

/** The live default ports (Minecraft, NATS, RCON). Refused on loopback, where they would be the live stack. */
export const LIVE_DEFAULT_PORTS: ReadonlySet<number> = new Set([25565, 4222, 25575]);

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost']);
const DEFAULT_MC_PORT = 25565;
const DEFAULT_NATS_PORT = 4222;
const DEFAULT_RCON_PORT = 25575;

/** A probe refused by the isolation check. The message names the rule only. */
export class IsolationRefusal extends Error {
  constructor(rule: string) {
    super(`p0 probe refused: ${rule}`);
    this.name = 'IsolationRefusal';
  }
}

/** What the probe may connect to, once the isolation check has passed. */
export interface ProbePlan {
  project: string;
  config: GolemConfig & { natsUrl: string };
}

type Env = Readonly<Record<string, string | undefined>>;

function refuse(rule: string): never {
  throw new IsolationRefusal(rule);
}

/**
 * The host allow-list for a project, or undefined when the project is neither a scratch project
 * nor exactly geldar-nf. Each project class has its own list; the lists are never merged.
 */
function hostsFor(
  project: string,
): { hosts: ReadonlySet<string>; serviceClass: string } | undefined {
  if (SCRATCH_PROJECT_PATTERN.test(project)) {
    return { hosts: SCRATCH_SERVICE_HOSTS, serviceClass: 'scratch service name' };
  }
  if (project === NF_PROJECT)
    return { hosts: NF_SERVICE_HOSTS, serviceClass: 'geldar-nf service name' };
  return undefined;
}

/** A bare service name of the project or loopback host; anything with a dot or a colon (an IP literal or a domain) is refused. */
function checkHost(
  name: string,
  host: string,
  port: number,
  allowed: { hosts: ReadonlySet<string>; serviceClass: string },
): void {
  if (LOOPBACK_HOSTS.has(host)) {
    if (LIVE_DEFAULT_PORTS.has(port)) refuse(`${name} uses a live default port on loopback`);
    return;
  }
  if (host.includes('.') || host.includes(':')) {
    refuse(`${name} must be 127.0.0.1, localhost or a bare service name, not a dotted or IP host`);
  }
  if (!allowed.hosts.has(host)) refuse(`${name} is not a ${allowed.serviceClass}`);
}

/** A TCP port from 1 to 65535 with digits only; anything else is refused. */
function parsePort(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const port = Number(raw);
  if (!/^\d{1,5}$/.test(raw) || port < 1 || port > 65535) refuse(`${name} is not a port`);
  return port;
}

/** The NATS URL: `nats://host[:port]` with no credentials and no path. The credentials come from the password file. */
function parseNats(raw: string | undefined): { natsUrl: string; host: string; port: number } {
  if (raw === undefined || raw === '') refuse('GELDAR_NATS_URL is required');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    refuse('GELDAR_NATS_URL is not a URL');
  }
  if (url.protocol !== 'nats:') refuse('GELDAR_NATS_URL must use the nats scheme');
  if (url.username !== '' || url.password !== '') {
    refuse('GELDAR_NATS_URL must not carry credentials (use the password file)');
  }
  if (url.pathname !== '' && url.pathname !== '/') refuse('GELDAR_NATS_URL must have no path');
  const port = url.port === '' ? DEFAULT_NATS_PORT : parsePort('GELDAR_NATS_URL port', url.port, 0);
  return { natsUrl: `nats://${url.hostname}:${port}`, host: url.hostname, port };
}

/**
 * The plan for a probe run, or a throw of IsolationRefusal naming the first rule broken. Nothing
 * here opens a socket or reads a file; the caller runs it before any connection.
 */
/**
 * The plan from the environment with the parsing rules only: each value is present and well
 * formed. It checks no isolation rule. Main reaches it only through `checkIsolation`.
 */
export function planFromEnv(env: Env): ProbePlan {
  const rconHost = env.GELDAR_RCON_HOST ?? '';
  if (rconHost === '') refuse('GELDAR_RCON_HOST is required');
  const rconPasswordFile = env.GELDAR_RCON_PASSWORD_FILE ?? '';
  if (rconPasswordFile === '') refuse('GELDAR_RCON_PASSWORD_FILE is required');
  return {
    project: env.GELDAR_P0_PROJECT ?? '',
    config: {
      mcHost: env.GELDAR_MC_HOST ?? 'velocity',
      mcPort: parsePort('GELDAR_MC_PORT', env.GELDAR_MC_PORT, DEFAULT_MC_PORT),
      rconHost,
      rconPort: parsePort('GELDAR_RCON_PORT', env.GELDAR_RCON_PORT, DEFAULT_RCON_PORT),
      rconPasswordFile,
      natsUrl: parseNats(env.GELDAR_NATS_URL).natsUrl,
    },
  };
}

/**
 * The plan for a probe run, or a throw of IsolationRefusal naming the first rule broken. The
 * scope rules (project, in-network opt-in) come first, then every host is checked. Nothing here
 * opens a socket or reads a file; the caller runs it before any connection.
 */
export function checkIsolation(env: Env): ProbePlan {
  const allowed = hostsFor(env.GELDAR_P0_PROJECT ?? '');
  if (allowed === undefined) {
    refuse(
      'GELDAR_P0_PROJECT must be scratch-<suffix> (1 to 9 lower-case letters or digits) or geldar-nf',
    );
  }
  if (env.GELDAR_IN_NETWORK_HOSTS !== '1') refuse('GELDAR_IN_NETWORK_HOSTS must be exactly 1');
  const plan = planFromEnv(env);
  const { mcHost, mcPort, rconHost, rconPort } = plan.config;
  const nats = parseNats(env.GELDAR_NATS_URL);
  checkHost('GELDAR_MC_HOST', mcHost, mcPort, allowed);
  checkHost('GELDAR_NATS_URL host', nats.host, nats.port, allowed);
  checkHost('GELDAR_RCON_HOST', rconHost, rconPort, allowed);
  return plan;
}
