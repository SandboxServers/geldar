import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { parseAnimusConfig, repoRoot } from '../src/config.ts';
import { type LinkResource, type MindStack, type StoreResource, startMind } from '../src/main.ts';
import type { Embedder, ModelClient, OutputValidator } from '../src/ports/index.ts';
import { createOutputValidator } from '../src/validate/index.ts';

// The Mind is replaced by a stub that records the dependencies it was built with. The wiring under
// test is main.ts's, so the stub only has to accept them.
const seen = vi.hoisted(() => ({ validator: undefined as unknown }));

vi.mock('../src/mind.ts', () => ({
  Mind: class {
    constructor(deps: { validator: unknown }) {
      seen.validator = deps.validator;
    }
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
  },
}));

vi.mock('../src/validate/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/validate/index.ts')>();
  return { ...actual, createOutputValidator: vi.fn(actual.createOutputValidator) };
});

/** The Phase 0 shard file with a bound that differs from the default, parsed through the real config. */
function configWithBounds(bounds: {
  worldBorderRadius: number;
  maxWorldTicks: number;
  maxBlockOperations: number;
}) {
  const doc = parse(readFileSync(join(repoRoot(), 'shards', 'phase0.yaml'), 'utf8'));
  doc.world_border_radius = bounds.worldBorderRadius;
  doc.max_world_ticks = bounds.maxWorldTicks;
  doc.max_block_operations = bounds.maxBlockOperations;
  return parseAnimusConfig(doc, { env: {}, allowPlaceholders: true });
}

/** A start-up stack whose outside pieces do nothing; only the validator wiring is under test. */
function quietStack(): MindStack {
  const store = { ensureAgent: async () => {} };
  const link = {
    body: {},
    events: {},
    publisher: { publish: async () => {} },
    start: async () => {},
    stopConsumer: () => {},
    close: async () => {},
  };
  return {
    embedder: () => ({}) as Embedder,
    openStore: async () =>
      ({ store, journal: {}, close: async () => {} }) as unknown as StoreResource,
    checkEmbedder: async () => {},
    startHub: async () => ({ model: {} as ModelClient, stop: async () => {} }),
    openLink: async () => link as unknown as LinkResource,
  };
}

describe('animus main: the output validator wiring', () => {
  beforeEach(() => {
    vi.mocked(createOutputValidator).mockClear();
    seen.validator = undefined;
  });

  it('builds the validator from the shard config bounds, not the defaults', async () => {
    const config = configWithBounds({
      worldBorderRadius: 300,
      maxWorldTicks: 1200,
      maxBlockOperations: 20,
    });
    const running = await startMind(config, quietStack(), () => {});
    expect(createOutputValidator).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createOutputValidator).mock.calls[0]?.[0]).toEqual({
      worldBorderRadius: 300,
      maxWorldTicks: 1200,
      maxBlockOperations: 20,
    });
    expect(seen.validator).toBe(
      vi.mocked(createOutputValidator).mock.results[0]?.value as OutputValidator,
    );
    await running.stop();
  });
});
