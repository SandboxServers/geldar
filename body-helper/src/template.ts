// The fixed Body container template (C7-03b4 spec, moved from supervisor/src/docker.ts by C7-03c1).
// Only the container name, the owner, the login name and the wiring from the helper's own config reach
// it. A caller never does (requests.ts refuses every other field).

/** The Body's entry point in the image (the house Adam entry; BODY-HOST changes it for sign-up agents). */
const BODY_ENTRYPOINT = ['node', 'src/adam/main.ts'];
/** Where the Body reads its NATS password inside the container. */
export const BODY_NATS_PASSWORD_FILE = '/run/secrets/nats-body.txt';
/** The directory the Body reads its shard file from: `<dir>/<shard>.yaml`. */
export const BODY_SHARD_DIR = '/opt/geldar/shards';
/** The network a Body joins when the wiring names none (the helper's GELDAR_NETWORK default). */
export const DEFAULT_NETWORK = 'geldar-colo';
/** The com.geldar.stack label when the wiring names none (the helper's GELDAR_STACK default). */
export const DEFAULT_STACK = 'colo';
/** The label every Body carries; the helper counts and lists Bodies by it (engine.ts, sweep.ts). */
export const BODY_LABEL = 'geldar.player';
const BODY_IN_NETWORK_HOSTS = '1';
const TMPFS_TMP = 'rw,noexec,nosuid,size=64m';

/** Values from the helper's root-only config file. Digits only for uid; the paths are Docker host paths. */
export interface BodyWiring {
  shard: string;
  uid: string;
  mcHost: string;
  mcPort: string;
  natsUrl: string;
  natsUser: string;
  natsSecretHostPath: string;
  shardHostPath: string;
  /** The Docker network every Body joins; defaults to DEFAULT_NETWORK. */
  network?: string;
  /** The com.geldar.stack label value; defaults to DEFAULT_STACK. */
  stack?: string;
}

export interface BodyLimits {
  nanoCpus: number;
  memory: number;
  pidsLimit: number;
}

export interface BodyTemplateInput {
  /** The lower-cased container name. */
  name: string;
  owner: string;
  /** The exact-case login name from the roster (0033). */
  loginName: string;
  image: string;
  wiring: BodyWiring;
  limits: BodyLimits;
}

export function bodyContainerConfig(input: BodyTemplateInput): Record<string, unknown> {
  const { wiring, limits } = input;
  return {
    Image: input.image,
    User: `${wiring.uid}:${wiring.uid}`,
    Entrypoint: BODY_ENTRYPOINT,
    Env: [
      `GELDAR_LOGIN_NAME=${input.loginName}`,
      `GELDAR_SHARD=${wiring.shard}`,
      `GELDAR_IN_NETWORK_HOSTS=${BODY_IN_NETWORK_HOSTS}`,
      `GELDAR_MC_HOST=${wiring.mcHost}`,
      `GELDAR_MC_PORT=${wiring.mcPort}`,
      `GELDAR_NATS_URL=${wiring.natsUrl}`,
      `GELDAR_NATS_USER=${wiring.natsUser}`,
      `GELDAR_NATS_PASSWORD_FILE=${BODY_NATS_PASSWORD_FILE}`,
    ],
    Labels: {
      'com.centurylinklabs.watchtower.enable': 'false',
      'com.geldar.stack': wiring.stack ?? DEFAULT_STACK,
      'geldar.owner': input.owner,
      [BODY_LABEL]: input.name,
    },
    HostConfig: {
      NanoCpus: limits.nanoCpus,
      Memory: limits.memory,
      MemorySwap: limits.memory,
      PidsLimit: limits.pidsLimit,
      NetworkMode: wiring.network ?? DEFAULT_NETWORK,
      Binds: [
        `${wiring.natsSecretHostPath}:${BODY_NATS_PASSWORD_FILE}:ro`,
        `${wiring.shardHostPath}:${BODY_SHARD_DIR}/${wiring.shard}.yaml:ro`,
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
