// The managed Body and the admit one-shot templates (BH-3). Both are fixed: the helper builds them from its root-only
// config and from one validated life id, and no caller value reaches them. The managed Body keeps the Body label (the
// global cap counts it), takes no RCON secret and no Docker socket. The admit one-shot takes only the RCON password file,
// carries the admit label (the cap does not count it) and is force-removed by the engine's runOneShot after it exits.
import { LIFE_ID_PATTERN } from './roster.ts';
import {
  BODY_LABEL,
  BODY_NATS_PASSWORD_FILE,
  BODY_SHARD_DIR,
  type BodyTemplateInput,
} from './template.ts';

/** The managed player host entry (golem/src/players/managed-main.ts, BH-2), relative to the image's golem directory. */
export const MANAGED_ENTRYPOINT = ['node', 'src/players/managed-main.ts'];
/** The admit one-shot entry (golem/src/admit-life.ts), relative to the image's golem directory. */
export const ADMIT_ENTRYPOINT = ['node', 'src/admit-life.ts'];
/** Where the admit one-shot reads the RCON password inside its container (the admin one-shot's path, compose/colo.yml). */
export const RCON_PASSWORD_FILE = '/run/secrets/rcon';
/** Where a managed Body reads its database password inside its container. */
export const MANAGED_DB_PASSWORD_FILE = '/run/secrets/db-password.txt';
/** The label of an admit one-shot. Its value names the mode (add or remove). It is not BODY_LABEL, so the cap never counts it. */
export const ADMIT_LABEL = 'geldar.admit';
/** The fixed prefix of an add one-shot's container name; the validated life id follows it. */
export const ADMIT_NAME_PREFIX = 'geldar-admit-';
/** The fixed prefix of a remove one-shot's container name (BH-5a). It cannot start with ADMIT_NAME_PREFIX, so the two never collide. */
export const UNADMIT_NAME_PREFIX = 'geldar-unadmit-';
/** The label of a managed Body that carries its validated life id, so a later stop can find the id without the roster (BH-5a). */
export const LIFE_LABEL = 'geldar.life';
/** The label of a managed Body (BH-6). The sweep removes only a Body that carries it, so a legacy or house Body never qualifies. */
export const MANAGED_LABEL = 'geldar.managed';
/** The two one-shot modes: add (admit before start) and remove (un-admit on stop). */
export type AdmitMode = 'add' | 'remove';
/** Paper's RCON host and port on the colo network (the same names the admin one-shot uses). */
const RCON_HOST = 'paper';
const RCON_PORT = '25575';
const IN_NETWORK_HOSTS = '1';
const TMPFS_TMP = 'rw,noexec,nosuid,size=64m';
/** The admit one-shot runs a TypeScript file under Node 22, which needs more than 64 MiB: a fixed 128 MiB (no swap) and 32 pids, so a runaway cannot take the node. */
const ADMIT_MEMORY_BYTES = 128 * 1024 * 1024;
const ADMIT_PIDS_LIMIT = 32;

/** The database wiring of a managed Body: a host, a port, the narrow role name and a root-only password file on the host. */
export interface ManagedDbWiring {
  host: string;
  port: string;
  role: string;
  /** A Docker host path. Checked here as well as in the helper config. */
  secretHostPath: string;
}

export interface ManagedBodyInput extends BodyTemplateInput {
  /** The managed life id, validated again here before it reaches the container. */
  lifeId: string;
  db: ManagedDbWiring;
  /** AN-50d: the GELDAR_OBSERVATIONS value to forward ('1' or 'on'). Absent or undefined adds no Env key at all. */
  observations?: string | undefined;
}

export interface AdmitInput {
  image: string;
  uid: string;
  network: string;
  stack: string;
  lifeId: string;
  /** add before a Body starts, remove when it stops. Sets GELDAR_ADMIT_MODE, which admit-life.ts requires. */
  mode: AdmitMode;
  /** A Docker host path to the root-only RCON password file. Checked here as well as in the helper config. */
  rconSecretHostPath: string;
}

function checkLifeId(lifeId: string): void {
  if (!LIFE_ID_PATTERN.test(lifeId)) throw new Error('not a managed life id');
}

/** The mode is one of two fixed strings; anything else never reaches a name, a label or an env line. */
function checkMode(mode: string): AdmitMode {
  if (mode !== 'add' && mode !== 'remove') throw new Error('admit mode is add or remove');
  return mode;
}

/** A bind source must be an absolute path with no comma, colon or line break (each would split the bind string). */
function checkBindSource(path: string): string {
  if (!/^\/[^,:\r\n]*$/.test(path)) throw new Error('bind source is not an absolute path');
  return path;
}

/** The admit container's name: a fixed prefix for the mode and the validated id. No caller value is in it. */
export function admitName(lifeId: string, mode: AdmitMode = 'add'): string {
  checkLifeId(lifeId);
  const prefix = checkMode(mode) === 'add' ? ADMIT_NAME_PREFIX : UNADMIT_NAME_PREFIX;
  return `${prefix}${lifeId}`;
}

/** GELDAR_OBSERVATIONS is forwarded only as '1' or 'on', the two values the golem parse turns on (AN-50d). */
function observationsEnv(value: string | undefined): string[] {
  if (value === undefined) return [];
  if (value !== '1' && value !== 'on') throw new Error('observations is 1 or on');
  return [`GELDAR_OBSERVATIONS=${value}`];
}

export function managedBodyConfig(input: ManagedBodyInput): Record<string, unknown> {
  const { wiring, limits, db } = input;
  checkLifeId(input.lifeId);
  const observations = observationsEnv(input.observations);
  return {
    Image: input.image,
    User: `${wiring.uid}:${wiring.uid}`,
    Entrypoint: MANAGED_ENTRYPOINT,
    Env: [
      `GELDAR_LOGIN_NAME=${input.loginName}`,
      `GELDAR_LIFE_ID=${input.lifeId}`,
      `GELDAR_SHARD=${wiring.shard}`,
      `GELDAR_MC_HOST=${wiring.mcHost}`,
      `GELDAR_MC_PORT=${wiring.mcPort}`,
      `GELDAR_NATS_URL=${wiring.natsUrl}`,
      `GELDAR_NATS_USER=${wiring.natsUser}`,
      `GELDAR_NATS_PASSWORD_FILE=${BODY_NATS_PASSWORD_FILE}`,
      `GELDAR_IN_NETWORK_HOSTS=${IN_NETWORK_HOSTS}`,
      `GELDAR_PG_HOST=${db.host}`,
      `GELDAR_PG_PORT=${db.port}`,
      `GELDAR_PG_USER=${db.role}`,
      `GELDAR_PG_PASSWORD_FILE=${MANAGED_DB_PASSWORD_FILE}`,
      ...observations,
    ],
    Labels: {
      'com.centurylinklabs.watchtower.enable': 'false',
      'com.geldar.stack': wiring.stack ?? 'colo',
      'geldar.owner': input.owner,
      [LIFE_LABEL]: input.lifeId,
      [MANAGED_LABEL]: '1',
      [BODY_LABEL]: input.name,
    },
    HostConfig: {
      NanoCpus: limits.nanoCpus,
      Memory: limits.memory,
      MemorySwap: limits.memory,
      PidsLimit: limits.pidsLimit,
      NetworkMode: wiring.network ?? 'geldar-colo',
      Binds: [
        `${checkBindSource(wiring.natsSecretHostPath)}:${BODY_NATS_PASSWORD_FILE}:ro`,
        `${checkBindSource(wiring.shardHostPath)}:${BODY_SHARD_DIR}/${wiring.shard}.yaml:ro`,
        `${checkBindSource(db.secretHostPath)}:${MANAGED_DB_PASSWORD_FILE}:ro`,
      ],
      Tmpfs: { '/tmp': TMPFS_TMP },
      ReadonlyRootfs: true,
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      RestartPolicy: { Name: 'unless-stopped' },
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
    },
  };
}

/** The remove one-shot's container name (BH-5b): the unadmit prefix and the validated life id. */
export function removeName(lifeId: string): string {
  return admitName(lifeId, 'remove');
}

/** The remove one-shot's config (BH-5b): the add one-shot's fixed template with mode remove. */
export function removeConfig(input: Omit<AdmitInput, 'mode'>): Record<string, unknown> {
  return admitConfig({ ...input, mode: 'remove' });
}

export function admitConfig(input: AdmitInput): Record<string, unknown> {
  checkLifeId(input.lifeId);
  const mode = checkMode(input.mode);
  return {
    Image: input.image,
    User: `${input.uid}:${input.uid}`,
    Entrypoint: ADMIT_ENTRYPOINT,
    Env: [
      `GELDAR_ADMIT_LIFE_ID=${input.lifeId}`,
      `GELDAR_ADMIT_MODE=${mode}`,
      `GELDAR_RCON_HOST=${RCON_HOST}`,
      `GELDAR_RCON_PORT=${RCON_PORT}`,
      `GELDAR_RCON_PASSWORD_FILE=${RCON_PASSWORD_FILE}`,
      `GELDAR_IN_NETWORK_HOSTS=${IN_NETWORK_HOSTS}`,
    ],
    Labels: {
      'com.centurylinklabs.watchtower.enable': 'false',
      'com.geldar.stack': input.stack,
      [ADMIT_LABEL]: mode,
    },
    HostConfig: {
      NetworkMode: input.network,
      Memory: ADMIT_MEMORY_BYTES,
      MemorySwap: ADMIT_MEMORY_BYTES,
      PidsLimit: ADMIT_PIDS_LIMIT,
      Binds: [`${checkBindSource(input.rconSecretHostPath)}:${RCON_PASSWORD_FILE}:ro`],
      Tmpfs: { '/tmp': TMPFS_TMP },
      ReadonlyRootfs: true,
      LogConfig: { Type: 'json-file', Config: { 'max-size': '1m', 'max-file': '1' } },
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
    },
  };
}
