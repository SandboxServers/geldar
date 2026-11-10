import { describe, expect, it } from 'vitest';
import { FakeBodyLink, FakeEventPublisher, FakeEventSource } from './fakes/body.fakes.ts';
import { FakeEmbedder, FakeMemoryStore } from './fakes/memory.fakes.ts';
import { makeSnapshot, VALID_THOUGHT } from './loop/loop-fixtures.ts';
import { agentRow, checkOllamaEmbedder, type LogLine, type MindStack, startMind } from './main.ts';
import { loadCommittedConfig } from './phase0-shard.fixture.ts';
import type { AgentRow, ModelClient } from './ports/index.ts';

const config = await loadCommittedConfig({ env: {}, allowPlaceholders: true });

/** A stack of fakes that writes every open and close to `calls`. */
function fakeStack(calls: string[], failAt?: string): MindStack {
  const step = (name: string): void => {
    calls.push(name);
    if (failAt === name) throw new Error(`${name} failed`);
  };
  const store = new FakeMemoryStore();
  const model: ModelClient = {
    complete: async () => ({ text: VALID_THOUGHT, thinkerId: 'fake', latencyMs: 1 }),
  };
  return {
    embedder: () => new FakeEmbedder(),
    async openStore() {
      step('postgres');
      const original = store.ensureAgent.bind(store);
      store.ensureAgent = async (agent: AgentRow) => {
        calls.push('ensureAgent');
        await original(agent);
      };
      return {
        store,
        journal: store,
        close: async () => {
          calls.push('close pool');
        },
      };
    },
    async checkEmbedder() {
      step('embedder');
    },
    async startHub() {
      step('hub');
      return {
        model,
        stop: async () => {
          calls.push('drain thinkers');
        },
      };
    },
    async openLink() {
      step('link');
      return {
        body: new FakeBodyLink(makeSnapshot({ agent_id: config.agent.username })),
        events: new FakeEventSource(),
        publisher: new FakeEventPublisher(),
        start: async () => {
          calls.push('consumer start');
        },
        stopConsumer: () => {
          calls.push('stop consumer');
        },
        close: async () => {
          calls.push('close nats');
        },
      };
    },
  };
}

describe('the Mind process', () => {
  it('starts in the documented order and stops in the reverse order', async () => {
    const calls: string[] = [];
    const lines: Record<string, unknown>[] = [];
    const log: LogLine = (line) => lines.push(line);
    const running = await startMind(config, fakeStack(calls), log);
    expect(calls).toEqual(['postgres', 'ensureAgent', 'embedder', 'hub', 'link', 'consumer start']);
    await running.mind.settled();
    await running.stop();
    expect(calls.slice(6)).toEqual(['stop consumer', 'close nats', 'drain thinkers', 'close pool']);
    expect(lines.every((l) => typeof l.event === 'string')).toBe(true);
    expect(lines.some((l) => l.event === 'mind_started' && l.life_id === 'ag_adam_03')).toBe(true);
  });

  it('closes what is open and rethrows when a step fails, and never opens the later ones', async () => {
    const calls: string[] = [];
    await expect(startMind(config, fakeStack(calls, 'hub'), () => undefined)).rejects.toThrow(
      'hub failed',
    );
    expect(calls).toEqual(['postgres', 'ensureAgent', 'embedder', 'hub', 'close pool']);
  });

  it('builds the agent row from the pinned model config, the tier, the seed and the game account', () => {
    const row = agentRow(config, new Date('2026-11-09T10:00:00.000Z'));
    expect(row).toMatchObject({
      agentId: 'ag_adam_03',
      gameAccount: 'ag_adam_03',
      lifeSeq: 3,
      tier: config.agent.tier,
      personalitySeed: config.agent.personalitySeed,
      shard: config.shard,
    });
    expect(row.modelConfig).toContain(row.declaredModel);
  });
});

describe('the embedder check', () => {
  const tags = (names: string[], ok = true): typeof fetch =>
    (async () =>
      ({
        ok,
        status: ok ? 200 : 500,
        json: async () => ({ models: names.map((name) => ({ name })) }),
      }) as Response) as unknown as typeof fetch;

  it('passes when the model is listed, with or without the latest tag', async () => {
    await checkOllamaEmbedder(config, tags(['nomic-embed-text:latest']));
    await checkOllamaEmbedder(config, tags(['qwen3:8b', 'nomic-embed-text']));
  });

  it('names the missing model and the command that fixes it', async () => {
    await expect(checkOllamaEmbedder(config, tags(['qwen3:8b']))).rejects.toThrow(
      'ollama pull nomic-embed-text',
    );
  });

  it('says Ollama is unreachable when the request fails or answers an error', async () => {
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(checkOllamaEmbedder(config, down)).rejects.toThrow('not reachable');
    await expect(checkOllamaEmbedder(config, tags([], false))).rejects.toThrow('HTTP 500');
  });
});
