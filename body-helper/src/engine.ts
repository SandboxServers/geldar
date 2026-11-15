// The helper's Docker Engine adapter (C7-03c1). It talks to the Engine API over the unix socket named in the
// helper's config, with node:http and no client dependency. It is the only Docker code in the helper: no
// Docker CLI is run, and no container is addressed by anything but the lower-cased name the helper gave it or
// the id a create returned.
import { request as httpRequest } from 'node:http';
import type { Readable } from 'node:stream';
import type { BodyEngine, ContainerState } from './service.ts';
import type { SweepBody, SweepEngine } from './sweep.ts';
import { BODY_LABEL } from './template.ts';

/** An Engine call with no answer in this long is abandoned, so a hung Engine cannot hold a verb. */
export const ENGINE_TIMEOUT_MS = 30_000;
/** The last lines of a container's log a logtail returns. */
export const LOG_TAIL_LINES = 200;
/** The most log bytes a logtail returns: the newest bytes, cut at this size. */
export const LOG_MAX_BYTES = 64 * 1024;
/** The label a sovereign player host carries: compose sets `com.docker.compose.service` on every `run` (colo-admin.sh). */
export const SOVEREIGN_HOST_KEY = 'com.docker.compose.service';
export const SOVEREIGN_HOST_VALUE = 'players-host';
export const SOVEREIGN_HOST_LABEL = `${SOVEREIGN_HOST_KEY}=${SOVEREIGN_HOST_VALUE}`;

export interface EngineReply {
  status: number;
  body: Buffer;
}

/** One Engine call: a method, a path under the API version root, and an optional JSON body. */
export type EngineRequest = (method: string, path: string, json?: unknown) => Promise<EngineReply>;

/** The unix-socket transport. A reply that takes longer than ENGINE_TIMEOUT_MS destroys the request. */
export function socketRequest(socketPath: string): EngineRequest {
  return (method, path, json) =>
    new Promise((resolve, reject) => {
      const payload = json === undefined ? undefined : JSON.stringify(json);
      const headers: Record<string, string | number> = {};
      if (payload !== undefined) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = Buffer.byteLength(payload);
      }
      const req = httpRequest({ socketPath, method, path, headers }, (res) => {
        readCapped(res, res.statusCode ?? 0).then(resolve, reject);
      });
      req.setTimeout(ENGINE_TIMEOUT_MS, () => req.destroy(new Error('docker engine timeout')));
      req.on('error', reject);
      req.end(payload);
    });
}

/** The most reply bytes the helper keeps from the Engine. A larger reply is cut off and the call fails. */
export const ENGINE_REPLY_MAX_BYTES = 1024 * 1024;

/** Collects one reply body. Past ENGINE_REPLY_MAX_BYTES it destroys the response and rejects; no partial body is kept. */
export function readCapped(res: Readable, status: number): Promise<EngineReply> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > ENGINE_REPLY_MAX_BYTES) {
        res.destroy(new Error('docker reply too large'));
        return;
      }
      chunks.push(chunk);
    });
    res.on('error', reject);
    res.on('end', () => resolve({ status, body: Buffer.concat(chunks) }));
  });
}

// A status outside the list is an error. The reply body is never echoed: it may carry engine detail.
function expect(reply: EngineReply, statuses: readonly number[], what: string): EngineReply {
  if (!statuses.includes(reply.status)) throw new Error(`docker ${what} refused`);
  return reply;
}

function parseJson(reply: EngineReply): unknown {
  try {
    return JSON.parse(reply.body.toString('utf8')) as unknown;
  } catch {
    throw new Error('docker reply not json');
  }
}

/**
 * Docker log frames: an 8-byte header (stream type, three zero bytes, big-endian size) then the payload. A
 * body whose first byte is not a stream type is not framed (a tty), and is read as text.
 */
export function demuxLogs(raw: Buffer): Buffer {
  if (raw.length > 0 && (raw[0] ?? 0) > 2) return raw;
  const frames: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= raw.length) {
    const size = raw.readUInt32BE(offset + 4);
    frames.push(raw.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return Buffer.concat(frames);
}

/** The newest LOG_MAX_BYTES of the log, as text. */
export function boundLog(text: Buffer): string {
  const bytes = text.length > LOG_MAX_BYTES ? text.subarray(text.length - LOG_MAX_BYTES) : text;
  return bytes.toString('utf8');
}

function filterQuery(filters: Record<string, string[]>, all: boolean): string {
  return `/containers/json?all=${all}&filters=${encodeURIComponent(JSON.stringify(filters))}`;
}

async function runningWithLabel(request: EngineRequest, label: string): Promise<number> {
  // A Body in `restarting` (a restart policy, a crash loop) is still on the node and still holds its slot.
  const reply = expect(
    await request('GET', filterQuery({ label: [label], status: ['running', 'restarting'] }, false)),
    [200],
    'list',
  );
  const list = parseJson(reply);
  return Array.isArray(list) ? list.length : 0;
}

/** The Engine adapter for the helper's BodyEngine port and the stray sweep's SweepEngine port. */
export function createDockerEngine(request: EngineRequest): BodyEngine & SweepEngine {
  const path = (name: string, rest = '') => `/containers/${encodeURIComponent(name)}${rest}`;
  return {
    async inspect(name): Promise<ContainerState | null> {
      const reply = await request('GET', path(name, '/json'));
      if (reply.status === 404) return null;
      const info = parseJson(expect(reply, [200], 'inspect')) as {
        Id: string;
        Name?: string;
        State: { Running: boolean };
        Config?: { Labels?: Record<string, string> | null };
      };
      // Docker also resolves a unique id prefix: a container of any other name is not the one this verb asked for.
      if (info.Name !== `/${name}`) return null;
      const labels = info.Config?.Labels ?? {};
      return {
        id: info.Id,
        running: info.State.Running === true,
        helperBody: BODY_LABEL in labels,
      };
    },
    async countCounted(): Promise<number> {
      // Running or restarting Bodies plus running or restarting sovereign hosts: the global cap counts both (decision 0261).
      const bodies = await runningWithLabel(request, BODY_LABEL);
      const hosts = await runningWithLabel(request, SOVEREIGN_HOST_LABEL);
      return bodies + hosts;
    },
    async create(name, config): Promise<string> {
      const reply = expect(
        await request('POST', `/containers/create?name=${encodeURIComponent(name)}`, config),
        [201],
        'create',
      );
      return (parseJson(reply) as { Id: string }).Id;
    },
    async start(id): Promise<void> {
      expect(await request('POST', path(id, '/start')), [204, 304], 'start');
    },
    async stop(name): Promise<void> {
      expect(await request('POST', path(name, '/stop')), [204, 304], 'stop');
    },
    async remove(id): Promise<void> {
      expect(await request('DELETE', `${path(id)}?force=true`), [204, 404], 'remove');
    },
    async logs(name): Promise<string> {
      const query = `/logs?stdout=true&stderr=true&tail=${LOG_TAIL_LINES}`;
      const reply = expect(await request('GET', path(name, query)), [200], 'logs');
      return boundLog(demuxLogs(reply.body));
    },
    async bodies(): Promise<SweepBody[]> {
      const reply = expect(
        await request('GET', filterQuery({ label: [BODY_LABEL] }, true)),
        [200],
        'list',
      );
      const list = parseJson(reply);
      if (!Array.isArray(list)) return [];
      return list.map(
        (item: { Labels?: Record<string, string>; Names?: string[]; State?: string }) => ({
          running: item.State === 'running',
          name: (
            item.Labels?.[BODY_LABEL] ??
            item.Names?.[0]?.replace(/^\//, '') ??
            ''
          ).toLowerCase(),
          owner: item.Labels?.['geldar.owner'] ?? '',
        }),
      );
    },
  };
}
