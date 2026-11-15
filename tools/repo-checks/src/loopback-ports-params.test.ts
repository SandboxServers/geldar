import { describe, expect, it } from 'vitest';
import { COLO_PATH, findPublicPorts } from './loopback-ports.ts';

// The parameterised host port form (G0-03): only `127.0.0.1:${GELDAR_PORT_<NAME>:-<default>}:<container>`
// on an allowlisted NAME with its listed default. Everything else that interpolates stays rejected.
// The entries are template literals with `\${` so Biome's noTemplateCurlyInString rule does not flag them.

function velocityPorts(entry: string): string {
  return `services:\n  velocity:\n    ports:\n      - ${JSON.stringify(entry)}\n`;
}

/** The port findings only: the colo service rules (labels, limits) are another check's concern. */
function problemsFor(entry: string): string[] {
  return findPublicPorts(COLO_PATH, velocityPorts(entry))
    .map((finding) => JSON.stringify(finding))
    .filter((text) => /port/i.test(text));
}

describe('loopback-ports: allowlisted parameterised host ports', () => {
  it.each([
    [`127.0.0.1:\${GELDAR_PORT_BOT:-25567}:25565`],
    [`127.0.0.1:\${GELDAR_PORT_MCP:-8788}:8788`],
    [`127.0.0.1:\${GELDAR_PORT_REGISTER:-18090}:8090`],
    [`127.0.0.1:\${GELDAR_PORT_GLASS:-8787}:8787`],
    [`127.0.0.1:\${GELDAR_PORT_BLUEMAP:-8100}:8100`],
  ])('accepts %s', (entry) => {
    expect(problemsFor(entry)).toEqual([]);
  });

  it('still accepts a plain loopback literal', () => {
    expect(problemsFor('127.0.0.1:18091:8090')).toEqual([]);
  });

  it.each([
    [
      'name not on the allowlist',
      `127.0.0.1:\${GELDAR_PORT_OTHER:-25567}:25565`,
      'not an allowlisted port name',
    ],
    [
      'default off the allowlist',
      `127.0.0.1:\${GELDAR_PORT_BOT:-25568}:25565`,
      'not the allowlisted default',
    ],
    [
      'default is the reserved game port',
      `127.0.0.1:\${GELDAR_PORT_BOT:-25565}:25565`,
      'not the allowlisted default',
    ],
    ['no default', `127.0.0.1:\${GELDAR_PORT_BOT}:25565`, 'uses interpolation'],
    ['empty default', `127.0.0.1:\${GELDAR_PORT_BOT:-}:25565`, 'uses interpolation'],
    ['not loopback', `0.0.0.0:\${GELDAR_PORT_BOT:-25567}:25565`, 'uses interpolation'],
    ['wildcard host', `\${GELDAR_PORT_BOT:-25567}:25565`, 'uses interpolation'],
    [
      'interpolated container port',
      `127.0.0.1:\${GELDAR_PORT_BOT:-25567}:\${PORT}`,
      'uses interpolation',
    ],
    [
      'nested default',
      `127.0.0.1:\${GELDAR_PORT_BOT:-\${OTHER:-25567}}:25565`,
      'uses interpolation',
    ],
    ['lower-case name', `127.0.0.1:\${GELDAR_PORT_bot:-25567}:25565`, 'uses interpolation'],
    ['any other variable', `127.0.0.1:\${GELDAR_MC_PORT:?}:25565`, 'uses interpolation'],
  ])('rejects %s', (_label, entry, reason) => {
    const problems = problemsFor(entry);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toContain(reason);
  });
});
