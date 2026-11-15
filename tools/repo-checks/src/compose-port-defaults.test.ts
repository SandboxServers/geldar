import { describe, expect, it } from 'vitest';
import { resolveComposePorts } from './compose-port-defaults.ts';

// Template literals with `\${` keep the compose interpolation text out of plain strings (Biome noTemplateCurlyInString).

describe('compose-port-defaults: resolving parameterised ports to their defaults', () => {
  it('resolves an allowlisted parameter form to its default literal', () => {
    expect(resolveComposePorts([`127.0.0.1:\${GELDAR_PORT_MCP:-8788}:8788`])).toEqual([
      '127.0.0.1:8788:8788',
    ]);
    expect(resolveComposePorts([`127.0.0.1:\${GELDAR_PORT_BOT:-25567}:25565`])).toEqual([
      '127.0.0.1:25567:25565',
    ]);
  });

  it('leaves a plain loopback literal unchanged', () => {
    expect(resolveComposePorts(['127.0.0.1:8100:8100'])).toEqual(['127.0.0.1:8100:8100']);
  });

  it('throws on another interpolation, a bare OTHER variable', () => {
    expect(() => resolveComposePorts([`127.0.0.1:\${OTHER}:8788`])).toThrow(/is not 127\.0\.0\.1/);
    expect(() => resolveComposePorts([`127.0.0.1:\${OTHER:-8788}:8788`])).toThrow(
      /is not 127\.0\.0\.1/,
    );
  });

  it('throws on a parameter form with a missing default', () => {
    expect(() => resolveComposePorts([`127.0.0.1:\${GELDAR_PORT_MCP}:8788`])).toThrow(
      /is not 127\.0\.0\.1/,
    );
  });

  it('throws on a name that is not on the allowlist', () => {
    expect(() => resolveComposePorts([`127.0.0.1:\${GELDAR_PORT_OTHER:-9000}:9000`])).toThrow(
      /not allowlisted/,
    );
  });

  it('throws when the ports value is not a list of strings', () => {
    expect(() => resolveComposePorts('127.0.0.1:8100:8100')).toThrow(/not a list of strings/);
    expect(() => resolveComposePorts([{ published: 8100 }])).toThrow(/not a list of strings/);
  });
});
