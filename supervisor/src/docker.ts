import { request as httpRequest } from 'node:http';
import type {
  BodyRecord,
  BodyRuntimePort,
  BodySpec,
  ContainerConfig,
  DisplayNamePort,
} from './ports.ts';

// The Docker Engine HTTP API over the unix socket (or the Windows named pipe), with node:http and
// socketPath: no client dependency. The socket is opened read-write, since the supervisor must create
// containers; the uid and group of the socket are the control (C7-03b2), not this code.

/** An Engine call with no answer in this long is abandoned, so a hung Engine cannot hold a start. */
export const ENGINE_TIMEOUT_MS = 30_000;
/** The deadline for removing a container after a create or start gave up. */
export const CLEANUP_TIMEOUT_MS = 10_000;
/** The Minecraft login name shape. A display name outside it cannot be a login, so the start is refused. */
const LOGIN_NAME = /^[A-Za-z0-9_]{3,16}$/;
/** The network and log driver golem-body uses in compose/colo.yml (the `colo` network, json-file 10m x 3). */
const COLO_NETWORK = 'geldar-colo';
/** The uid and gid the compose file gives golem-body by default (GELDAR_SERVICE_UID). */
const BODY_USER = '1000:1000';

export interface EngineReply {
  status: number;
  body: string;
}

// One Engine call. An abort destroys the request, so the caller's promise rejects at once; a reply
// that takes longer than timeoutMs destroys it too.
export function engineRequest(
  socketPath: string,
  method: string,
  path: string,
  json?: unknown,
  signal?: AbortSignal,
  timeoutMs: number = ENGINE_TIMEOUT_MS,
): Promise<EngineReply> {
  return new Promise((resolve, reject) => {
    const payload = json === undefined ? undefined : JSON.stringify(json);
    const headers: Record<string, string | number> = {};
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    const req = httpRequest({ socketPath, method, path, headers, signal }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('docker engine timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

export interface ContainerInfo {
  id: string;
  running: boolean;
  owner: string;
}

// The calls the runtime needs. Every container is addressed by a name the supervisor lower-cases, or
// by the id a create returned. Nothing removes by a name, since a name is shared with a newer attempt.
export interface DockerClient {
  readonly image: string;
  inspect(name: string, signal?: AbortSignal): Promise<ContainerInfo | null>;
  create(name: string, config: ContainerConfig, owner: string, loginName: string): Promise<string>;
  start(id: string, signal?: AbortSignal): Promise<void>;
  stop(name: string, signal?: AbortSignal): Promise<void>;
  remove(id: string, signal?: AbortSignal): Promise<void>;
}

// A status outside the list is an error. The reply body is not echoed: it may carry engine detail.
function expect(reply: EngineReply, statuses: readonly number[], what: string): EngineReply {
  if (!statuses.includes(reply.status)) throw new Error(`docker ${what} refused`);
  return reply;
}

// The Body container config for one spec (0082): NanoCpus and Memory from the limits, with the swap
// equal to the memory so a body cannot swap past its limit. The rest mirrors golem-body's service in
// compose/colo.yml: pids limit, network, user and log driver. CapDrop and no-new-privileges are the
// orchestrator's ruling; golem-body does not set them, so this container is stricter than that service.
export function containerBody(
  spec: BodySpec,
  image: string,
  loginName: string,
): Record<string, unknown> {
  return {
    Image: image,
    User: BODY_USER,
    // The login name keeps the player's exact case (0033). The container name stays lower-cased.
    Env: [`GELDAR_LOGIN_NAME=${loginName}`],
    Labels: { 'geldar.owner': spec.ownerId, 'geldar.player': spec.playerName.toLowerCase() },
    HostConfig: {
      NanoCpus: spec.config.NanoCpus,
      Memory: spec.config.Memory,
      MemorySwap: spec.config.MemorySwap,
      PidsLimit: spec.config.PidsLimit,
      NetworkMode: COLO_NETWORK,
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
    },
  };
}

export function createDockerClient(
  socketPath: string,
  image: string,
  timeoutMs: number = ENGINE_TIMEOUT_MS,
): DockerClient {
  const call = (method: string, path: string, json?: unknown, signal?: AbortSignal) =>
    engineRequest(socketPath, method, path, json, signal, timeoutMs);
  return {
    image,
    async inspect(name, signal) {
      const reply = await call(
        'GET',
        `/containers/${encodeURIComponent(name)}/json`,
        undefined,
        signal,
      );
      if (reply.status === 404) return null;
      expect(reply, [200], 'inspect');
      const json = JSON.parse(reply.body) as {
        Id: string;
        State?: { Running?: boolean };
        Config?: { Labels?: Record<string, string> };
      };
      return {
        id: json.Id,
        running: json.State?.Running === true,
        owner: json.Config?.Labels?.['geldar.owner'] ?? '',
      };
    },
    async create(name, config, owner, loginName) {
      const spec: BodySpec = {
        ownerId: owner,
        playerName: name,
        config,
      };
      const reply = await call(
        'POST',
        `/containers/create?name=${encodeURIComponent(name)}`,
        containerBody(spec, image, loginName),
      );
      const json = JSON.parse(expect(reply, [201], 'create').body) as { Id: string };
      return json.Id;
    },
    async start(id, signal) {
      const reply = await call(
        'POST',
        `/containers/${encodeURIComponent(id)}/start`,
        undefined,
        signal,
      );
      expect(reply, [204, 304], 'start');
    },
    async stop(name, signal) {
      const reply = await call(
        'POST',
        `/containers/${encodeURIComponent(name)}/stop`,
        undefined,
        signal,
      );
      // 404 is no body to stop, which is the state the stop asks for.
      expect(reply, [204, 304, 404], 'stop');
    },
    async remove(id, signal) {
      const reply = await call(
        'DELETE',
        `/containers/${encodeURIComponent(id)}?force=true`,
        undefined,
        signal,
      );
      expect(reply, [204, 404], 'remove');
    },
  };
}

// Resolves with the work's value unless the signal aborts first. The work is not cancelled: its
// result still arrives, and the caller decides what to do with it.
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('runtime call aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('runtime call aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

// The BodyRuntimePort over the Docker client. A start replaces a stopped container of the name (the
// previous roster owner's, or this owner's), and refuses a running one. Cleanup after a give-up is
// bounded by cleanupMs, so a hung Engine cannot hold the start.
export function createDockerRuntime(
  client: DockerClient,
  names: DisplayNamePort,
  cleanupMs: number = CLEANUP_TIMEOUT_MS,
): BodyRuntimePort {
  return {
    async inspect(playerName) {
      const name = playerName.toLowerCase();
      const info = await client.inspect(name);
      if (info === null) return null;
      const record: BodyRecord = { ownerId: info.owner, playerName: name, running: info.running };
      return record;
    },
    async start(spec, signal) {
      const name = spec.playerName.toLowerCase();
      // The exact-case login name is read before anything is removed or created: no name, no container.
      // A name outside the Minecraft login shape is refused the same way: the owner sees why in the reply.
      const loginName = await names.displayName(spec.ownerId, spec.playerName);
      if (loginName === null || !LOGIN_NAME.test(loginName)) throw new Error('login name unknown');
      const existing = await client.inspect(name, signal);
      if (existing?.running) throw new Error('body already running');
      if (existing) await client.remove(existing.id, signal);
      // The create's id is the only handle on what it made. If the caller gives up before the id
      // returns, the id is removed when it lands, never by name.
      const created = client.create(name, spec.config, spec.ownerId, loginName);
      let id: string;
      try {
        id = await untilAborted(created, signal);
      } catch (error) {
        void created.then(
          (madeId) => client.remove(madeId, AbortSignal.timeout(cleanupMs)).catch(() => undefined),
          () => undefined,
        );
        throw error;
      }
      try {
        await client.start(id, signal);
      } catch (error) {
        await client.remove(id, AbortSignal.timeout(cleanupMs)).catch(() => undefined);
        throw error;
      }
    },
    // A stop by name is the known gap of fix G, finding 1: a roster move inside one call can stop the
    // new owner's body. The Engine API has no attempt id to stop by.
    async stop(playerName) {
      await client.stop(playerName.toLowerCase());
    },
  };
}
