/**
 * The world volume the Paper server writes to. Compose names it `<project>_paper-data`; GELDAR_WORLD_VOLUME selects
 * another volume (compose/phase0.yml). The default is the volume the existing runs used.
 *
 * `prepare-volume` makes a new, empty, compose-labelled volume for one run and records its name in the run folder's
 * manifest.json. Nothing here deletes or reuses a volume.
 */
import type { FileStore, Runner } from './ports.ts';
import { runPaths } from './ports.ts';

export const COMPOSE_PROJECT = 'geldar-phase0';
export const DEFAULT_WORLD_VOLUME = `${COMPOSE_PROJECT}_paper-data`;
export const WORLD_VOLUME_ENV = 'GELDAR_WORLD_VOLUME';
/** The compose labels that let compose adopt a volume it did not create (compose refuses an unlabelled one). */
const LABEL_PROJECT = 'com.docker.compose.project';
const LABEL_VOLUME = 'com.docker.compose.volume';
/** The compose volume key of the Paper data volume. */
const COMPOSE_VOLUME_KEY = 'paper-data';
/** The image of the emptiness check: its `ls` runs read-only over the volume. Pinned in compose/phase0.yml. */
const CHECK_IMAGE =
  'nats:2.15.1-alpine@sha256:7ae34c25dfd6fe2e01c6483eabef20d796690fdcac6c4d94ca780a6cf9877fde';
export const PREPARED_SCHEMA = 'adam-run-prepared/1';

/** The record `prepare-volume` writes as the run folder's manifest.json. `start` replaces it with the run manifest. */
export interface PreparedRecord {
  schema: typeof PREPARED_SCHEMA;
  profile: string;
  runId: string;
  worldVolume: string;
  preparedAt: string;
}

export interface VolumeState {
  exists: boolean;
  /** Both compose labels carry this project and this volume key. */
  labelled: boolean;
  /** The volume holds no entries, read by a read-only container. */
  empty: boolean;
  /** The ids of every container, running or stopped, that mounts the volume. */
  usedBy: string[];
}

/** The Docker calls the world volume needs. The real one is `createWorldVolumes`; the tests pass a fake. */
export interface WorldVolumes {
  inspect(name: string): Promise<VolumeState>;
  create(name: string, runId: string): Promise<void>;
}

const MISSING: VolumeState = { exists: false, labelled: false, empty: false, usedBy: [] };

/** The prepared record in a manifest.json text, or null for a missing file, bad JSON or a run manifest. */
export function parsePrepared(text: string | null): PreparedRecord | null {
  if (text === null) return null;
  try {
    const rec = JSON.parse(text) as Partial<PreparedRecord> | null;
    if (rec?.schema !== PREPARED_SCHEMA) return null;
    return typeof rec.worldVolume === 'string' && typeof rec.profile === 'string'
      ? (rec as PreparedRecord)
      : null;
  } catch {
    return null;
  }
}

/** The name `prepare-volume` gives a run's world volume: the compose project, then the run id. */
export function volumeNameFor(runId: string): string {
  return `${COMPOSE_PROJECT}-world-${runId}`;
}

/** The Docker port over the Runner. Every call is one docker program with an argument array. */
export function createWorldVolumes(runner: Runner): WorldVolumes {
  return {
    async inspect(name) {
      const meta = await runner.exec('docker', [
        'volume',
        'inspect',
        '--format',
        '{{json .Labels}}',
        name,
      ]);
      if (meta.code !== 0) {
        if (/no such volume/i.test(meta.stderr)) return MISSING;
        throw new Error(`docker volume inspect ${name} exited ${meta.code}: ${meta.stderr.trim()}`);
      }
      const labels = (JSON.parse(meta.stdout.trim() || 'null') ?? {}) as Record<string, string>;
      const users = await runner.exec('docker', [
        'ps',
        '-a',
        '--filter',
        `volume=${name}`,
        '--format',
        '{{.ID}}',
      ]);
      if (users.code !== 0) throw new Error(`docker ps for ${name} exited ${users.code}`);
      const listing = await runner.exec('docker', [
        'run',
        '--rm',
        '--network',
        'none',
        '--read-only',
        '--entrypoint',
        'ls',
        '-v',
        `${name}:/data:ro`,
        CHECK_IMAGE,
        '-A',
        '/data',
      ]);
      if (listing.code !== 0) {
        throw new Error(`the emptiness check of ${name} exited ${listing.code}`);
      }
      return {
        exists: true,
        labelled:
          labels[LABEL_PROJECT] === COMPOSE_PROJECT && labels[LABEL_VOLUME] === COMPOSE_VOLUME_KEY,
        empty: listing.stdout.trim() === '',
        usedBy: users.stdout
          .split('\n')
          .map((id) => id.trim())
          .filter((id) => id !== ''),
      };
    },
    async create(name, runId) {
      const res = await runner.exec('docker', [
        'volume',
        'create',
        '--label',
        `${LABEL_PROJECT}=${COMPOSE_PROJECT}`,
        '--label',
        `${LABEL_VOLUME}=${COMPOSE_VOLUME_KEY}`,
        '--label',
        `geldar.run-id=${runId}`,
        name,
      ]);
      if (res.code !== 0) {
        throw new Error(`docker volume create ${name} exited ${res.code}: ${res.stderr.trim()}`);
      }
    },
  };
}

export type PrepareResult = { ok: true; record: PreparedRecord } | { ok: false; error: string };

/**
 * Makes the run's new volume and records it in the run folder's manifest.json. Refuses when the folder already holds a
 * manifest or the volume name exists. Never deletes or reuses a volume: a volume left behind is named in the error.
 */
export async function prepareWorldVolume(
  deps: { volumes: WorldVolumes; files: FileStore; nowMs: number },
  input: { profile: string; runId: string; runDir: string },
): Promise<PrepareResult> {
  const manifest = runPaths(input.runDir).manifest;
  if (deps.files.read(manifest) !== null) {
    return { ok: false, error: `${input.runDir} already holds a manifest; pick another --run-id` };
  }
  const name = volumeNameFor(input.runId);
  if ((await deps.volumes.inspect(name)).exists) {
    return { ok: false, error: `volume ${name} already exists; pick another --run-id` };
  }
  await deps.volumes.create(name, input.runId);
  const after = await deps.volumes.inspect(name);
  if (!after.labelled || !after.empty) {
    const why = after.labelled ? 'not empty' : 'not labelled';
    return { ok: false, error: `volume ${name} was created but is ${why}; it was left in place` };
  }
  const record: PreparedRecord = {
    schema: PREPARED_SCHEMA,
    profile: input.profile,
    runId: input.runId,
    worldVolume: name,
    preparedAt: new Date(deps.nowMs).toISOString(),
  };
  deps.files.write(manifest, `${JSON.stringify(record, null, 2)}\n`);
  return { ok: true, record };
}

/** What `prepare-volume` prints: the volume, the record, and the steps that make the stack use it. */
export function preparedText(rec: PreparedRecord, runDir: string): string {
  return [
    `prepared ${rec.profile} world volume ${rec.worldVolume} (empty, labelled for ${COMPOSE_PROJECT})`,
    `record: ${runDir}/manifest.json (run ${rec.runId})`,
    'to use it, stop the stack, set the variable in this shell, start the stack again:',
    '  ./geldar.ps1 adam down',
    `  $env:${WORLD_VOLUME_ENV} = '${rec.worldVolume}'`,
    '  ./geldar.ps1 adam up',
    `then: ./geldar.ps1 adam-run ${rec.profile} start --run-id ${rec.runId}`,
  ].join('\n');
}
