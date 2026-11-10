import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { OllamaEmbedder } from './embedder-ollama.ts';
import { toVectorLiteral } from './vector.ts';

const vec = (n: number, fill = 0.5): number[] => new Array<number>(n).fill(fill);

let server: Server | undefined;
afterEach(async () => {
  await new Promise((done) => (server ? server.close(done) : done(undefined)));
  server = undefined;
});

/** Starts a fake Ollama that answers every call with `reply` and records the request bodies. */
async function fakeOllama(
  reply: (body: { input: string[] }) => { status?: number; json?: unknown; hang?: boolean },
): Promise<{ url: string; bodies: Record<string, unknown>[] }> {
  const bodies: Record<string, unknown>[] = [];
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      const body = JSON.parse(raw) as { input: string[] };
      bodies.push({ ...body, path: req.url });
      const r = reply(body);
      if (r.hang) return;
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.json ?? {}));
    });
  });
  const started = server;
  await new Promise<void>((done) => started.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${(started.address() as AddressInfo).port}`, bodies };
}

describe('OllamaEmbedder', () => {
  it('prefixes documents and queries, posts to /api/embed and asks for CPU', async () => {
    const o = await fakeOllama((b) => ({ json: { embeddings: b.input.map(() => vec(768)) } }));
    const e = new OllamaEmbedder({ baseUrl: o.url, model: 'nomic-embed-text', onCpu: true });
    const out = await e.embed(['a', 'b'], 'document');
    await e.embed(['q'], 'query');
    expect(out).toHaveLength(2);
    expect(o.bodies[0]).toMatchObject({
      path: '/api/embed',
      model: 'nomic-embed-text',
      input: ['search_document: a', 'search_document: b'],
      options: { num_gpu: 0 },
    });
    expect(o.bodies[1]?.input).toEqual(['search_query: q']);
  });

  it('sends no options when the embedder may use the GPU', async () => {
    const o = await fakeOllama((b) => ({ json: { embeddings: b.input.map(() => vec(768)) } }));
    await new OllamaEmbedder({ baseUrl: o.url, model: 'm', onCpu: false }).embed(['a'], 'query');
    expect(o.bodies[0]).not.toHaveProperty('options');
  });

  it('refuses a vector that is not 768 numbers', async () => {
    const o = await fakeOllama(() => ({ json: { embeddings: [vec(767)] } }));
    const e = new OllamaEmbedder({ baseUrl: o.url, model: 'm', onCpu: true });
    await expect(e.embed(['a'], 'document')).rejects.toThrow(/768/);
  });

  it('refuses a wrong count of vectors and an HTTP error', async () => {
    const o = await fakeOllama(() => ({ json: { embeddings: [] } }));
    const e = new OllamaEmbedder({ baseUrl: o.url, model: 'm', onCpu: true });
    await expect(e.embed(['a'], 'document')).rejects.toThrow(/0 vectors for 1/);
    const bad = await fakeOllama(() => ({ status: 500 }));
    await expect(
      new OllamaEmbedder({ baseUrl: bad.url, model: 'm', onCpu: true }).embed(['a'], 'document'),
    ).rejects.toThrow(/500/);
  });

  it('gives up after the timeout', async () => {
    const o = await fakeOllama(() => ({ hang: true }));
    const e = new OllamaEmbedder({ baseUrl: o.url, model: 'm', onCpu: true, timeoutMs: 100 });
    await expect(e.embed(['a'], 'document')).rejects.toThrow();
  });
});

describe('toVectorLiteral', () => {
  it('writes a bracketed list and checks length and finiteness', () => {
    expect(toVectorLiteral([1, 2.5, -3], 3)).toBe('[1,2.5,-3]');
    expect(() => toVectorLiteral([1, 2], 3)).toThrow(/expected 3/);
    expect(() => toVectorLiteral([1, Number.NaN, 3], 3)).toThrow(/finite/);
    expect(() => toVectorLiteral(vec(767))).toThrow(/768/);
  });
});
