import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadReflexConfig } from '../body/reflex-config.ts';
import { repoRoot } from '../config.ts';
import { buildSnapshot } from '../snapshot.ts';
import { FakeEars, FakePerception, FakeVoice } from './senses.fakes.ts';

/** The few bot fields `buildSnapshot` reads, enough for a plain world with nothing in it. */
function fakeBot(): Bot {
  return {
    time: { age: 100, timeOfDay: 1000 },
    entity: { position: { x: 1.5, y: 64, z: 2.5 }, effects: {} },
    blockAt: () => null,
    thunderState: 0,
    isRaining: false,
    health: 20,
    food: 20,
    heldItem: null,
    inventory: { items: () => [] },
    registry: { effects: {} },
  } as unknown as Bot;
}

const options = { lifeId: 'ag_adam_01', shard: 'phase0', revision: 1 };

describe('buildSnapshot options', () => {
  it('keeps today defaults: empty surroundings, no recipes, no generation', () => {
    const snapshot = buildSnapshot(fakeBot(), options);
    expect(snapshot.surroundings.blocks_summary).toBe('');
    expect(snapshot.self.unlocked_recipes).toBeUndefined();
    expect(snapshot.body_generation).toBeUndefined();
  });

  it('carries the surroundings, unlocked recipes and body generation it is given', () => {
    const perception = new FakePerception();
    perception.surroundingsValue = {
      blocks_summary: 'grass plains',
      notable_blocks: [],
      entities: [],
      agents: [],
    };
    perception.recipes = ['oak_planks', 'stick'];
    const snapshot = buildSnapshot(fakeBot(), {
      ...options,
      surroundings: perception.surroundings(),
      unlockedRecipes: perception.unlockedRecipes(),
      bodyGeneration: 3,
    });
    expect(snapshot.surroundings.blocks_summary).toBe('grass plains');
    expect(snapshot.self.unlocked_recipes).toEqual(['oak_planks', 'stick']);
    expect(snapshot.body_generation).toBe(3);
  });

  it('throws when the contract rejects the unlocked recipes', () => {
    expect(() => buildSnapshot(fakeBot(), { ...options, unlockedRecipes: ['a', 'a'] })).toThrow(
      /rejected by the contract/,
    );
  });
});

describe('sense fakes', () => {
  it('keeps events until they are acked, and leaves heard lines in place', () => {
    const ears = new FakeEars();
    ears.lines = [{ from: 'Sage', text: 'hi', age_seconds: 1 }];
    ears.queued = [{ type: 'agent_approached' }];
    expect(ears.peekEvents()).toHaveLength(1);
    expect(ears.peekEvents()).toHaveLength(1);
    ears.ackEvents(1);
    expect(ears.peekEvents()).toHaveLength(0);
    expect(ears.heard()).toHaveLength(1);
    expect(ears.heard()).toHaveLength(1);
  });

  it('records what the voice was asked to say and can script a refusal', async () => {
    const voice = new FakeVoice();
    expect(await voice.say('hello')).toEqual({ status: 'said', text: 'hello' });
    voice.outcome = { status: 'refused', reason: 'rate_limited' };
    expect(await voice.say('again')).toEqual({ status: 'refused', reason: 'rate_limited' });
    expect(voice.said).toEqual(['hello', 'again']);
  });
});

/** The parts of the shard file this test reads. */
interface ShardDoc {
  mind: Record<string, unknown> & {
    agent: Record<string, unknown>;
    thinker: Record<string, unknown>;
    thought: Record<string, unknown>;
    reflection: Record<string, unknown>;
    admission: Record<string, unknown>;
    plan: Record<string, unknown>;
  };
  model_pins: Record<string, Record<string, unknown>>;
  embedding: Record<string, unknown>;
}

describe('shards/phase0.yaml Mind blocks', () => {
  const file = join(repoRoot(), 'shards', 'phase0.yaml');

  it('keeps the reflex loader working next to the new blocks', async () => {
    const config = await loadReflexConfig(file);
    expect(config.enabled).toBe(true);
  });

  it('has the blocks of decisions 0049 to 0051 with the pinned values', async () => {
    const doc = parse(await readFile(file, 'utf8')) as ShardDoc;
    expect(doc.mind.agent.username).toBe('ag_adam_01');
    expect(doc.mind.thinker).toMatchObject({ host: '127.0.0.1', port: 7410, heartbeat_s: 15 });
    expect(doc.mind.thought).toMatchObject({ max_tokens: 600, deadline_s: 25, reasoning: 'off' });
    expect(doc.mind.reflection).toMatchObject({ max_tokens: 1200, reasoning: 'on' });
    expect(doc.mind.admission.max_thoughts_per_real_hour).toBe(120);
    expect(doc.mind.plan.expires_after_ticks).toBe(1200);
    expect(doc.mind.run_tier).toBe('strong');
    for (const tag of ['qwen3:32b', 'qwen3:8b']) {
      expect(doc.model_pins[tag]).toMatchObject({
        num_ctx: 8192,
        keep_alive: '30m',
        max_concurrent: 1,
      });
    }
    expect(doc.embedding).toMatchObject({ model: 'nomic-embed-text', dims: 768, on_cpu: true });
  });
});
