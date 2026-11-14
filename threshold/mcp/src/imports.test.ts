import { describe, expect, it } from 'vitest';

/**
 * The animus modules the MCP server reuses (validator, plan builder, speech classifier, Mind
 * event link, Body link, ids) and the mock's package must resolve from this package. A rename
 * in animus or the mock fails here, not at the first tool call.
 */
const PATHS = [
  '@geldar/player-core/src/validate/index.ts',
  '@geldar/player-core/src/loop/plan.ts',
  '@geldar/player-core/src/attention/classify.ts',
  '@geldar/player-core/src/link/mind-event.ts',
  '@geldar/player-core/src/link/nats-body-link.ts',
  '@geldar/player-core/src/ids.ts',
  '@geldar/mcp-mock',
] as const;

/** A first import transforms the animus sources cold; under parallel load that outruns the 5 s default. */
const IMPORT_TIMEOUT_MS = 30_000;

describe('animus and mock imports', () => {
  for (const path of PATHS) {
    it(
      `resolves ${path}`,
      async () => {
        const module = await import(path);
        expect(Object.keys(module).length).toBeGreaterThan(0);
      },
      IMPORT_TIMEOUT_MS,
    );
  }

  it(
    'exposes the names the wave uses',
    async () => {
      const validate = await import('@geldar/player-core/src/validate/index.ts');
      const plan = await import('@geldar/player-core/src/loop/plan.ts');
      const classify = await import('@geldar/player-core/src/attention/classify.ts');
      const mock = await import('@geldar/mcp-mock');

      expect(typeof validate.createOutputValidator).toBe('function');
      expect(typeof plan.buildPlan).toBe('function');
      expect(typeof classify.classifySpeech).toBe('function');
      expect(typeof mock.buildSnapshot).toBe('function');
    },
    IMPORT_TIMEOUT_MS,
  );
});
