/**
 * The hub against the real `lantern-local` Thinker class (P0-22), with Ollama replaced by a
 * scripted chat function. The class is imported from the sibling package by path: it has no
 * import side effects, and neither package may edit the other.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatRequest, ChatResult } from '../../../lantern-local/src/ollama.ts';
import { LocalThinker } from '../../../lantern-local/src/thinker.ts';
import { ModelError } from '../ports/model.ts';
import type { ThinkerHub } from './hub.ts';
import { THINKER_PATH } from './hub.ts';
import { LocalThinkerClient } from './local-client.ts';
import { MODEL, startHub, until } from './thinker.fakes.ts';

let hub: ThinkerHub | undefined;
let thinker: LocalThinker | undefined;

afterEach(async () => {
  await thinker?.stop();
  thinker = undefined;
  await hub?.stop();
  hub = undefined;
});

async function connect(
  chat: (request: ChatRequest, signal: AbortSignal) => Promise<ChatResult>,
): Promise<LocalThinkerClient> {
  hub = await startHub();
  thinker = new LocalThinker({
    wsUrl: `ws://127.0.0.1:${hub.port}${THINKER_PATH}`,
    models: [
      {
        name: MODEL,
        digest: `sha256:${'a'.repeat(64)}`,
        numCtx: 8192,
        keepAlive: '30m',
        maxConcurrent: 1,
      },
    ],
    chat,
    version: '1.2.3',
  });
  thinker.start();
  const connected = hub;
  await until(() => connected.pick(MODEL) !== undefined, 'the Thinker to be welcomed');
  return new LocalThinkerClient(hub);
}

const NEVER = new AbortController().signal;

function job(overrides: Record<string, unknown> = {}) {
  return {
    model: MODEL,
    messages: [{ role: 'user' as const, content: 'hi' }],
    maxTokens: 50,
    temperature: 0.2,
    deadline: new Date(Date.now() + 5000),
    stablePrefixChars: 0,
    ...overrides,
  };
}

describe('the hub with the real lantern-local Thinker', () => {
  it('completes a job and passes the schema and the reasoning switch through', async () => {
    const seen: ChatRequest[] = [];
    const client = await connect(async (request) => {
      seen.push(request);
      return { text: '{"ok":true}', promptTokens: 11, completionTokens: 4 };
    });
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    const done = await client.complete(job({ responseSchema: schema, reasoning: 'on' }), NEVER);
    expect(done).toMatchObject({
      text: '{"ok":true}',
      usageReported: { promptTokens: 11, completionTokens: 4 },
      thinkerId: 'test-thinker',
    });
    expect(seen[0]).toMatchObject({ schema, think: true, maxTokens: 50, temperature: 0.2 });
    expect(hub?.stats()[0]).toMatchObject({ anomalies: 0, droppedFrames: 0 });
  });

  it('turns a Thinker error into the matching ModelError', async () => {
    const client = await connect(async () => {
      throw new Error('boom');
    });
    const failed = await client.complete(job(), NEVER).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(ModelError);
    expect((failed as ModelError).code).toBe('internal');
  });

  it('cancels a running job: the Thinker aborts its model call', async () => {
    let aborted = false;
    const client = await connect(
      (_request, signal) =>
        new Promise<ChatResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const controller = new AbortController();
    const pending = client.complete(job(), controller.signal).catch((err: unknown) => err);
    await until(() => hub?.session('local-1')?.inFlight(MODEL) === 1, 'the job to be running');
    controller.abort();
    expect(((await pending) as ModelError).code).toBe('cancelled');
    await until(() => aborted, 'the Thinker to abort');
  });

  it('refuses a second job past the Thinker max_concurrent before it is sent', async () => {
    const release: Array<() => void> = [];
    const client = await connect(
      () =>
        new Promise<ChatResult>((resolve) => {
          release.push(() => resolve({ text: 'x', promptTokens: 1, completionTokens: 1 }));
        }),
    );
    const first = client.complete(job(), NEVER);
    await until(() => release.length === 1, 'the first job to start');
    const second = await client.complete(job(), NEVER).catch((err: unknown) => err);
    expect((second as ModelError).code).toBe('no_thinker');
    release[0]?.();
    await first;
  });
});
