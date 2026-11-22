/**
 * The service worker, public/sw.js, run in a sandbox with a fake cache and a fake network. It may keep a
 * copy of the page's own files and nothing else: these tests fail when it answers for the API, the stream,
 * Kino or the register service, when it stores anything but a good reply for a shell file, when it hides a
 * refusal (the kill switch) behind its copy, or when its file list drifts from what Glass serves.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { STATIC_FILES } from '../src/static-files.ts';

const SOURCE = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://glass.example.test';

interface FakeResponse {
  ok: boolean;
  status: number;
  body: string;
  clone(): FakeResponse;
}

function response(status: number, body: string): FakeResponse {
  const made: FakeResponse = { ok: status >= 200 && status < 300, status, body, clone: () => made };
  return made;
}

class FakeCache {
  entries = new Map<string, FakeResponse>();
  added: string[] = [];
  async addAll(paths: string[]): Promise<void> {
    this.added.push(...paths);
    for (const path of paths) this.entries.set(path, response(200, `precached ${path}`));
  }
  /** Set, every store fails, as it does when the browser's storage is full. */
  full = false;
  async put(key: string, value: FakeResponse): Promise<void> {
    if (this.full) throw new Error('QuotaExceededError');
    this.entries.set(key, value);
  }
  async match(key: string): Promise<FakeResponse | undefined> {
    return this.entries.get(key);
  }
}

interface FetchEvent {
  request: { method: string; url: string };
  respondWith: ReturnType<typeof vi.fn>;
}

/** Loads the worker into a fresh sandbox and returns its listeners and its world. */
function load(network: (request: { url: string }) => Promise<FakeResponse>) {
  const listeners = new Map<string, (event: never) => void>();
  const stores = new Map<string, FakeCache>();
  const caches = {
    open: async (name: string) => {
      const found = stores.get(name) ?? new FakeCache();
      stores.set(name, found);
      return found;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: never) => void) =>
      void listeners.set(type, listener),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
  };
  const fetch = vi.fn(network);
  // The script's top-level constants, read back for the tests.
  const sandbox = {
    self,
    caches,
    fetch,
    URL,
    Set,
    Promise,
    exported: {} as Record<string, unknown>,
  };
  runInNewContext(`${SOURCE}\nexported.SHELL = SHELL; exported.CACHE = CACHE;`, sandbox);
  const shell = sandbox.exported.SHELL as string[];
  const cacheName = sandbox.exported.CACHE as string;

  /** Sends one fetch event; returns the reply the worker gave, or undefined when it left the request alone. */
  async function request(path: string, method = 'GET', origin = ORIGIN) {
    const event: FetchEvent = {
      request: { method, url: `${origin}${path}` },
      respondWith: vi.fn(),
    };
    listeners.get('fetch')?.(event as never);
    if (event.respondWith.mock.calls.length === 0) return undefined;
    return (await event.respondWith.mock.calls[0]?.[0]) as FakeResponse;
  }

  /** Runs a lifecycle event to the end of what it waits for. */
  async function lifecycle(type: 'install' | 'activate'): Promise<void> {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)?.({ waitUntil: (p: Promise<unknown>) => waits.push(p) } as never);
    await Promise.all(waits);
  }

  return { self, fetch, stores, shell, cacheName, request, lifecycle };
}

const online = async (request: { url: string }) => response(200, `fresh ${request.url}`);
const offline = async (): Promise<FakeResponse> => {
  throw new TypeError('Failed to fetch');
};

describe('the service worker file list', () => {
  it('is every file Glass serves except the worker itself', () => {
    const { shell } = load(online);
    expect([...shell].sort()).toEqual(
      [...STATIC_FILES.keys()].filter((path) => path !== '/sw.js').sort(),
    );
    expect(new Set(shell).size).toBe(shell.length);
  });

  it('holds no API, stream, Kino or register path', () => {
    const { shell } = load(online);
    for (const path of shell) {
      expect(path, path).not.toMatch(/^\/(api|kino|register|roster)(\/|$)/);
    }
    // The source names no such path anywhere but its comments.
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\/api|\/kino|\/register|\/roster/);
  });
});

describe('the service worker', () => {
  it('copies the shell when it is installed, and takes over without waiting', async () => {
    const worker = load(online);
    await worker.lifecycle('install');
    expect(worker.stores.get(worker.cacheName)?.added).toEqual(worker.shell);
    expect(worker.self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('removes the copies of older versions when it activates, and leaves other caches alone', async () => {
    const worker = load(online);
    worker.stores.set('glass-shell-v0', new FakeCache());
    worker.stores.set('someone-elses-cache', new FakeCache());
    worker.stores.set(worker.cacheName, new FakeCache());
    await worker.lifecycle('activate');
    expect([...worker.stores.keys()].sort()).toEqual(
      [worker.cacheName, 'someone-elses-cache'].sort(),
    );
    expect(worker.self.clients.claim).toHaveBeenCalledTimes(1);
  });

  it.each([
    '/api/thoughts?limit=50',
    '/api/thoughts/th-1',
    '/api/agents',
    '/api/receipts?action_id=a',
    '/api/stream',
    '/api/session',
    '/kino/',
    '/kino/ws',
    '/kino/targets',
    '/register/',
    '/register/callback?code=x',
    '/roster',
    '/nowhere',
    '/sw.js',
  ])('leaves %s alone: no answer, no copy', async (path) => {
    const worker = load(online);
    expect(await worker.request(path)).toBeUndefined();
    expect(worker.fetch).not.toHaveBeenCalled();
    expect(worker.stores.size).toBe(0);
  });

  it('leaves every write alone, even to a shell path, and every other origin', async () => {
    const worker = load(online);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect(await worker.request('/', method), method).toBeUndefined();
    }
    expect(
      await worker.request('/app.js', 'GET', 'https://elsewhere.example.test'),
    ).toBeUndefined();
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it('asks the network first for a shell file, passes its answer on and keeps a copy of it', async () => {
    const worker = load(online);
    const reply = await worker.request('/app.js');
    expect(reply?.body).toBe(`fresh ${ORIGIN}/app.js`);
    expect(worker.fetch).toHaveBeenCalledTimes(1);
    expect(worker.stores.get(worker.cacheName)?.entries.get('/app.js')?.body).toBe(
      `fresh ${ORIGIN}/app.js`,
    );
  });

  it('treats a bookmarked page as the page: the query is not part of the copy', async () => {
    const worker = load(online);
    await worker.request('/?agent=ag_1&q=secret+search');
    expect([...(worker.stores.get(worker.cacheName)?.entries.keys() ?? [])]).toEqual(['/']);
  });

  it('passes a refusal on as it is, and never serves the copy in its place: the kill switch reaches the reader', async () => {
    const worker = load(async () => response(503, 'Service unavailable'));
    await worker.lifecycle('install');
    const reply = await worker.request('/');
    expect([reply?.status, reply?.body]).toEqual([503, 'Service unavailable']);
    // The refusal did not replace the copy either.
    expect(worker.stores.get(worker.cacheName)?.entries.get('/')?.body).toBe('precached /');
  });

  it('serves the copy only when the network gives no answer at all', async () => {
    const worker = load(offline);
    await worker.lifecycle('install');
    expect((await worker.request('/'))?.body).toBe('precached /');
    expect((await worker.request('/?agent=ag_1'))?.body).toBe('precached /');
    expect((await worker.request('/fonts/dm-mono-latin-400-normal.woff2'))?.body).toBe(
      'precached /fonts/dm-mono-latin-400-normal.woff2',
    );
    // Offline, the API still has no answer from the worker: the page shows no thoughts.
    expect(await worker.request('/api/thoughts?limit=50')).toBeUndefined();
  });

  it('passes the server answer on when the copy cannot be stored: a full disk never serves an old page', async () => {
    const worker = load(online);
    await worker.lifecycle('install');
    const cache = worker.stores.get(worker.cacheName);
    if (cache !== undefined) cache.full = true;
    const reply = await worker.request('/app.js');
    expect(reply?.body).toBe(`fresh ${ORIGIN}/app.js`);
    // The old copy is still there for an offline visit; it was not served in place of the new answer.
    expect(cache?.entries.get('/app.js')?.body).toBe('precached /app.js');
  });

  it('fails as the network failed when there is no copy', async () => {
    const worker = load(offline);
    await expect(worker.request('/app.css')).rejects.toThrow('Failed to fetch');
  });
});
