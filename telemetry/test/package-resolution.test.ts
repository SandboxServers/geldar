import { describe, expect, it } from 'vitest';

// Resolves the package by its name, the way a sibling workspace package imports it.
describe('package resolution', () => {
  it('resolves @geldar/telemetry by name to its TypeScript entry', async () => {
    const mod = await import('@geldar/telemetry');
    expect(typeof mod.startTelemetry).toBe('function');
    expect(typeof mod.createLogger).toBe('function');
    expect(typeof mod.injectTrace).toBe('function');
  });
});
