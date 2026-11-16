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

  it('counts running and restarting containers: a crash-looping Body keeps its slot while it is down', async () => {
    const { request, calls } = fakeEngine(0, 0);
    await createDockerEngine(request).countCounted();
    const statusFilter = encodeURIComponent('"status":["running","restarting"]');
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.path.includes(statusFilter))).toBe(true);
  });
});

describe('engine: the verbs', () => {
  it('inspect answers null for a 404 and the id and running state otherwise', async () => {
    const absent = createDockerEngine(async () => empty(404));
    expect(await absent.inspect('body1')).toBeNull();
    const present = createDockerEngine(async () =>
      json(200, { Id: 'abc', Name: '/body1', State: { Running: true } }),
    );
    expect(await present.inspect('body1')).toEqual({
      id: 'abc',
      running: true,
      helperBody: false,
      owner: null,
      lifeId: null,
      exitCode: null,
      managed: false,
    });
  });

  it('reports the exit code and the managed label (BH-6): a number exit code, and managed only for the value 1', async () => {
    const exited = (labels: Record<string, string>) =>
      createDockerEngine(async () =>
        json(200, {
          Id: 'abc',
          Name: '/body1',
          State: { Running: false, ExitCode: 78 },
          Config: { Labels: labels },
        }),
      );
    expect(await exited({ 'geldar.managed': '1' }).inspect('body1')).toMatchObject({
      running: false,
      exitCode: 78,
      managed: true,
    });
    expect(await exited({ 'geldar.managed': 'yes' }).inspect('body1')).toMatchObject({
      managed: false,
    });
    const noCode = createDockerEngine(async () =>
      json(200, { Id: 'abc', Name: '/body1', State: { Running: true } }),
    );
    expect(await noCode.inspect('body1')).toMatchObject({ exitCode: null, managed: false });
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
      owner: null,
      lifeId: null,
      exitCode: null,
      managed: false,
    });
    expect(await labelled(null).inspect('body1')).toEqual({
      id: 'abc',
      running: true,
      helperBody: false,
      owner: null,
      lifeId: null,
      exitCode: null,
      managed: false,
    });
    expect(await labelled({ 'geldar.owner': 'x' }).inspect('body1')).toEqual({
      id: 'abc',
      running: true,
      helperBody: false,
      owner: 'x',
      lifeId: null,
      exitCode: null,
      managed: false,
    });
  });

  it('reads the geldar.owner label as the owner of the container, with the Body label', async () => {
    const owned = createDockerEngine(async () =>
      json(200, {
        Id: 'abc',
        Name: '/body1',
        State: { Running: true },
        Config: { Labels: { [BODY_LABEL]: 'body1', 'geldar.owner': 'own-a' } },
      }),
    );
    expect(await owned.inspect('body1')).toEqual({
      id: 'abc',
      running: true,
      helperBody: true,
      owner: 'own-a',
      lifeId: null,
      exitCode: null,
      managed: false,
    });
  });

  it('reports the geldar.life label as lifeId only when it is a managed life id', async () => {
    const labelled = (life: string) =>
      createDockerEngine(async () =>
        json(200, {
          Id: 'abc',
          Name: '/body1',
          State: { Running: true },
          Config: { Labels: { [BODY_LABEL]: 'body1', 'geldar.life': life } },
        }),
      );
    expect((await labelled('ag_0123456789ab').inspect('body1'))?.lifeId).toBe('ag_0123456789ab');
    for (const bad of ['ag_ABC', 'ag_a;rm', '', 'ag_0123456789abc', 'ag_a/../b']) {
      expect((await labelled(bad).inspect('body1'))?.lifeId).toBeNull();
    }
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

  it('matches the exact name, not a prefix: a body10 reply is absent for body1, and body1 for body10', async () => {
    const replyFor = (serverName: string) =>
      createDockerEngine(async () =>
        json(200, {
          Id: 'ffff',
          Name: `/${serverName}`,
          State: { Running: true },
          Config: { Labels: { [BODY_LABEL]: serverName } },
        }),
      );
    expect(await replyFor('body10').inspect('body1')).toBeNull();
    expect(await replyFor('body1').inspect('body10')).toBeNull();
    expect(await replyFor('body1').inspect('body1')).toEqual({
      id: 'ffff',
      running: true,
      helperBody: true,
      owner: null,
      lifeId: null,
      exitCode: null,
      managed: false,
    });
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
    expect(await engine.bodies()).toEqual([{ name: 'stray1', owner: 'owner-1', running: false }]);
  });

  it('bodies reads the State of each listed container: running gives running true, any other state false', async () => {
    const labelled = (name: string) => ({ [BODY_LABEL]: name, 'geldar.owner': 'owner-1' });
    const engine = createDockerEngine(async () =>
      json(200, [
        { Labels: labelled('up1'), State: 'running' },
        { Labels: labelled('down1'), State: 'exited' },
      ]),
    );
    expect(await engine.bodies()).toEqual([
      { name: 'up1', owner: 'owner-1', running: true },
      { name: 'down1', owner: 'owner-1', running: false },
    ]);
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

const ONE_SHOT_NAME = 'geldar-admit-ag_0123456789ab';
const ONE_SHOT_ROUTES: Record<string, EngineReply> = {
  'POST /containers/create': json(201, { Id: 'abc123' }),
  'POST /containers/abc123/start': empty(204),
  'POST /containers/abc123/wait': json(200, { StatusCode: 0 }),
  'DELETE /containers/abc123': empty(204),
};

/**
 * A scripted Engine for runOneShot. Each route (method and path without the query) answers with its reply, or throws
 * when the reply is an Error. A call with no scripted route throws, so an unexpected call fails the test.
 */
function oneShotFake(routes: Record<string, EngineReply | Error>) {
  const calls: { method: string; path: string }[] = [];
  const request: EngineRequest = async (method, path) => {
    calls.push({ method, path });
    const key = `${method} ${path.split('?')[0]}`;
    const reply = routes[key];
    if (reply === undefined) throw new Error(`unscripted ${key}`);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const run = (config: Record<string, unknown> = {}) =>
    createDockerEngine(request).runOneShot(ONE_SHOT_NAME, config);
  return { calls, run };
}

describe('engine: runOneShot', () => {
  it('creates by name, starts, waits, force-removes, and returns the exit code', async () => {
    const { calls, run } = oneShotFake({ ...ONE_SHOT_ROUTES });
    expect(await run()).toBe(0);
    expect(calls).toEqual([
      { method: 'POST', path: `/containers/create?name=${ONE_SHOT_NAME}` },
      { method: 'POST', path: '/containers/abc123/start' },
      { method: 'POST', path: '/containers/abc123/wait' },
      { method: 'DELETE', path: '/containers/abc123?force=true' },
    ]);
  });

  it('returns a non-zero exit code as the code the one-shot exited with', async () => {
    const { run } = oneShotFake({
      ...ONE_SHOT_ROUTES,
      'POST /containers/abc123/wait': json(200, { StatusCode: 3 }),
    });
    expect(await run()).toBe(3);
  });

  it.each([{}, { StatusCode: '0' }, { StatusCode: null }])(
    'a wait reply with no numeric StatusCode (%j) is a refusal, -1, never 0',
    async (waitBody) => {
      const { calls, run } = oneShotFake({
        ...ONE_SHOT_ROUTES,
        'POST /containers/abc123/wait': json(200, waitBody),
      });
      expect(await run()).toBe(-1);
      expect(calls.at(-1)).toEqual({ method: 'DELETE', path: '/containers/abc123?force=true' });
    },
  );

  it.each([404, 500])(
    'a wait answered %i throws, and the one-shot is still force-removed',
    async (status) => {
      const { calls, run } = oneShotFake({
        ...ONE_SHOT_ROUTES,
        'POST /containers/abc123/wait': empty(status),
      });
      await expect(run()).rejects.toThrow('docker wait refused');
      expect(calls.at(-1)).toEqual({ method: 'DELETE', path: '/containers/abc123?force=true' });
    },
  );

  it('a start answered 500 throws, never waits, and the created one-shot is still force-removed', async () => {
    const { calls, run } = oneShotFake({
      ...ONE_SHOT_ROUTES,
      'POST /containers/abc123/start': empty(500),
    });
    await expect(run()).rejects.toThrow('docker start refused');
    expect(calls.map((c) => c.path)).not.toContain('/containers/abc123/wait');
    expect(calls.at(-1)).toEqual({ method: 'DELETE', path: '/containers/abc123?force=true' });
  });

  it('a create answered 409 throws and sends no remove, since no container was made', async () => {
    const { calls, run } = oneShotFake({
      ...ONE_SHOT_ROUTES,
      'POST /containers/create': empty(409),
    });
    await expect(run()).rejects.toThrow('docker create refused');
    expect(calls.map((c) => c.method)).toEqual(['POST']);
  });

  it('a wait body that is not JSON throws, and the one-shot is still force-removed', async () => {
    const { calls, run } = oneShotFake({
      ...ONE_SHOT_ROUTES,
      'POST /containers/abc123/wait': { status: 200, body: Buffer.from('<html>') },
    });
    await expect(run()).rejects.toThrow('docker reply not json');
    expect(calls.at(-1)).toEqual({ method: 'DELETE', path: '/containers/abc123?force=true' });
  });

  it('a failed force-remove after a good wait does not change the exit code', async () => {
    const { run } = oneShotFake({
      ...ONE_SHOT_ROUTES,
      'DELETE /containers/abc123': new Error('daemon gone'),
    });
    expect(await run()).toBe(0);
  });
});
