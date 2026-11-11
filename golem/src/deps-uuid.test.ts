import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * uuid is only transitive here: yggdrasil (via minecraft-protocol) and @azure/msal-node (via prismarine-auth)
 * both depend on it. The override in pnpm-workspace.yaml pins it to 11.1.1 for the v3/v5/v6 buffer advisory.
 * These tests walk the same dependency chain mineflayer uses, so they fail if the override is reverted.
 */
const golemRequire = createRequire(import.meta.url);
const mineflayerRequire = createRequire(golemRequire.resolve('mineflayer'));
const mcpRequire = createRequire(mineflayerRequire.resolve('minecraft-protocol'));
const yggdrasilRequire = createRequire(mcpRequire.resolve('yggdrasil'));
const authRequire = createRequire(mcpRequire.resolve('prismarine-auth'));

function packageVersion(req: ReturnType<typeof createRequire>, name: string): string {
  const file = req.resolve(`${name}/package.json`);
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}

describe('uuid transitive dependencies', () => {
  it('yggdrasil loads and resolves uuid 11.1.1', () => {
    const yggdrasil = mcpRequire('yggdrasil') as object;
    expect(yggdrasil).toBeTruthy();
    expect(packageVersion(yggdrasilRequire, 'uuid')).toBe('11.1.1');
  });

  it('@azure/msal-node loads and resolves uuid 11.1.1', () => {
    const msal = authRequire('@azure/msal-node') as object;
    expect(msal).toBeTruthy();
    const msalRequire = createRequire(authRequire.resolve('@azure/msal-node'));
    expect(packageVersion(msalRequire, 'uuid')).toBe('11.1.1');
  });
});
