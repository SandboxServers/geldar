import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  boundLog,
  createDockerEngine,
  demuxLogs,
  ENGINE_REPLY_MAX_BYTES,
  type EngineReply,
  type EngineRequest,
  LOG_MAX_BYTES,
  readCapped,
  SOVEREIGN_HOST_LABEL,
} from './engine.ts';
import { BODY_LABEL } from './template.ts';

const json = (status: number, value: unknown): EngineReply => ({
  status,
  body: Buffer.from(JSON.stringify(value)),
});
const empty = (status: number): EngineReply => ({ status, body: Buffer.alloc(0) });

/** A fake Engine: list answers come from the label filter, so the count is the Engine's, not a guess. */
function fakeEngine(runningBodies: number, runningHosts: number) {
  const calls: { method: string; path: string }[] = [];
  const request: EngineRequest = async (method, path) => {
    calls.push({ method, path });
    if (method === 'GET' && path.startsWith('/containers/json')) {
      const filters = JSON.parse(decodeURIComponent(path.split('filters=')[1] ?? '')) as {
        label: string[];
      };
      if (filters.label[0] === BODY_LABEL) return json(200, Array(runningBodies).fill({}));
      if (filters.label[0] === SOVEREIGN_HOST_LABEL) return json(200, Array(runningHosts).fill({}));
    }
    return empty(404);
  };
  return { request, calls };
}

describe('engine: the reply size cap', () => {
  it('keeps a reply of exactly the cap and refuses one byte more', async () => {
    const fits = new PassThrough();
    fits.end(Buffer.alloc(ENGINE_REPLY_MAX_BYTES, 1));
    expect((await readCapped(fits, 200)).body.length).toBe(ENGINE_REPLY_MAX_BYTES);
    const over = new PassThrough();
    over.end(Buffer.alloc(ENGINE_REPLY_MAX_BYTES + 1, 1));
    await expect(readCapped(over, 200)).rejects.toThrow('docker reply too large');
  });

  it('a stream error rejects the call and keeps no partial body', async () => {
    const broken = new PassThrough();
    broken.write('partial');
    broken.destroy(new Error('socket closed'));
    await expect(readCapped(broken, 200)).rejects.toThrow('socket closed');
  });
});

describe('engine: the global count', () => {
  it('sums running Bodies and running sovereign hosts with one label filter each', async () => {
    const { request, calls } = fakeEngine(24, 15);
    expect(await createDockerEngine(request).countCounted()).toBe(39);
    const lists = calls.filter((c) => c.path.startsWith('/containers/json'));
    expect(lists).toHaveLength(2);
    expect(lists.every((c) => c.path.includes('status'))).toBe(true);
  });

  it('counts only running containers: the filter asks for status running', async () => {
    const { request, calls } = fakeEngine(0, 0);
    await createDockerEngine(request).countCounted();
    expect(calls[0]?.path).toContain(encodeURIComponent('"status":["running"]'));
  });
});

describe('engine: the verbs', () => {
  it('inspect answers null for a 404 and the id and running state otherwise', async () => {
    const absent = createDockerEngine(async () => empty(404));
    expect(await absent.inspect('body1')).toBeNull();
    const present = createDockerEngine(async () =>
      json(200, { Id: 'abc', Name: '/body1', State: { Running: true } }),
    );
    expect(await present.inspect('body1')).toEqual({ id: 'abc', running: true, helperBody: false });
  });

  it('reads the Body label: a Body label gives helperBody true; no labels, or another label, gives false', async () => {
    const labelled = (labels: Record<string, string> | null) =>
      createDockerEngine(async () =>
        json(200, {
          Id: 'abc',
          Name: '/body1',
          State: { Running: true },
          Config: { Labels: labels },
        }),
      );
    expect(await labelled({ [BODY_LABEL]: 'body1' }).inspect('body1')).toEqual({
      id: 'abc',
      running: true,
      helperBody: true,
    });
    expect(await labelled(null).inspect('body1')).toEqual({
      id: 'abc',
      running: true,
      helperBody: false,
    });
    expect(await labelled({ 'geldar.owner': 'x' }).inspect('body1')).toEqual({
      id: 'abc',
      running: true,
      helperBody: false,
    });
  });

  it('treats a reply for another name as absent: an id prefix match is not the container asked for', async () => {
    const byPrefix = createDockerEngine(async () =>
      json(200, {
        Id: 'abc123def',
        Name: '/unrelated',
        State: { Running: true },
        Config: { Labels: { [BODY_LABEL]: 'unrelated' } },
      }),
    );
    expect(await byPrefix.inspect('abc123')).toBeNull();
  });

  it('create refuses a non-201 reply and never echoes the reply body in the error', async () => {
    const engine = createDockerEngine(async () => ({
      status: 409,
      body: Buffer.from('secret engine detail'),
    }));
    const error = await engine.create('body1', {}).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('docker create refused');
  });

  it('remove accepts 404 (already gone) and forces the delete', async () => {
    const calls: string[] = [];
    const engine = createDockerEngine(async (method, path) => {
      calls.push(`${method} ${path}`);
      return empty(404);
    });
    await engine.remove('abc');
    expect(calls).toEqual(['DELETE /containers/abc?force=true']);
  });

  it('stop refuses a 500 reply', async () => {
    const engine = createDockerEngine(async () => empty(500));
    await expect(engine.stop('body1')).rejects.toThrow('docker stop refused');
  });

  it('logs asks for the tail and returns the bounded text', async () => {
    const frame = Buffer.concat([Buffer.from([1, 0, 0, 0, 0, 0, 0, 3]), Buffer.from('abc')]);
    const calls: string[] = [];
    const engine = createDockerEngine(async (_m, path) => {
      calls.push(path);
      return { status: 200, body: frame };
    });
    expect(await engine.logs('body1')).toBe('abc');
    expect(calls[0]).toContain('tail=200');
  });

  it('bodies lists Body-labelled containers with their name and owner from the labels', async () => {
    const engine = createDockerEngine(async () =>
      json(200, [{ Labels: { [BODY_LABEL]: 'stray1', 'geldar.owner': 'owner-1' } }]),
    );
    expect(await engine.bodies()).toEqual([{ name: 'stray1', owner: 'owner-1' }]);
  });
});

describe('engine: log bounds', () => {
  it('unframes the stream and keeps the newest LOG_MAX_BYTES', () => {
    const payload = Buffer.alloc(LOG_MAX_BYTES + 10, 'x');
    const header = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]);
    header.writeUInt32BE(payload.length, 4);
    const text = boundLog(demuxLogs(Buffer.concat([header, payload])));
    expect(text.length).toBe(LOG_MAX_BYTES);
  });

  it('reads an unframed body as text', () => {
    expect(demuxLogs(Buffer.from('plain text')).toString()).toBe('plain text');
  });
});
