import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The supervisor holds no Docker socket and no Docker client (C7-03c3, decision 0260): Bodies are controlled
// through the host body helper over NATS. A production file that names the socket or imports a Docker client
// fails here. Test files are exempt: they may name the socket to assert it is absent. The compose bind test
// (no docker.sock in compose/colo.yml) belongs to C7-03b2, not here.
const SUPERVISOR_ROOT = fileURLToPath(new URL('../../../supervisor/', import.meta.url));
const SUPERVISOR_SRC = `${SUPERVISOR_ROOT}src/`;

// A module reference: a static `from`, a dynamic `import(`, or a `require(`, with a quoted specifier.
const MODULE_REF = /(?:from\s+|import\(\s*|require\(\s*)['"]/;

const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: 'the Docker socket path', pattern: /docker\.sock/ },
  { name: 'the Docker run directory', pattern: /\/var\/run\/docker/ },
  {
    name: 'a Docker client package',
    pattern: new RegExp(`${MODULE_REF.source}[^'"]*docker(?:ode|-modem)[^'"]*['"]`),
  },
  {
    name: 'a local docker module',
    pattern: new RegExp(`${MODULE_REF.source}(?:[^'"]*\\/)?docker[\\w.-]*['"]`),
  },
];

// Every production .ts file under supervisor/src, at any depth, as paths relative to supervisor/src.
function productionFiles(): string[] {
  return readdirSync(SUPERVISOR_SRC, { recursive: true })
    .map((entry) => String(entry).replaceAll('\\', '/'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
}

// The first forbidden mention in a source text, as a fixed label; null when the text is clean.
export function dockerMention(source: string): string | null {
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(source)) return rule.name;
  }
  return null;
}

describe('supervisor production code holds no Docker socket or client', () => {
  it('scans at least the service and the helper client', () => {
    const files = productionFiles();
    expect(files).toContain('service.ts');
    expect(files).toContain('helper-client.ts');
  });

  it('no production file mentions the Docker socket, its run directory, or a Docker client', () => {
    const found = productionFiles()
      .map((name) => {
        const mention = dockerMention(readFileSync(`${SUPERVISOR_SRC}${name}`, 'utf8'));
        return mention === null ? null : `${name}: ${mention}`;
      })
      .filter((entry): entry is string => entry !== null);
    expect(found).toEqual([]);
  });

  it('no supervisor dependency is a Docker package', () => {
    const manifest = JSON.parse(readFileSync(`${SUPERVISOR_ROOT}package.json`, 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    const names = [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ].flatMap((field) => Object.keys(manifest[field] ?? {}));
    expect(names.filter((name) => name.toLowerCase().includes('docker'))).toEqual([]);
  });

  it('the scan catches each forbidden form', () => {
    expect(dockerMention("const s = '/var/run/docker.sock';")).toBe('the Docker socket path');
    expect(dockerMention("import { Docker } from './docker.ts';")).toBe('a local docker module');
    expect(dockerMention("import { Docker } from './docker.js';")).toBe('a local docker module');
    expect(dockerMention("import { C } from './docker-client.ts';")).toBe('a local docker module');
    expect(dockerMention("import Dockerode from 'dockerode';")).toBe('a Docker client package');
    expect(dockerMention("import type { D } from '@types/dockerode';")).toBe(
      'a Docker client package',
    );
    expect(dockerMention("const d = await import('dockerode');")).toBe('a Docker client package');
    expect(dockerMention("const d = require('dockerode');")).toBe('a Docker client package');
    expect(dockerMention("import { m } from 'docker-modem';")).toBe('a Docker client package');
    expect(dockerMention("const ok = 'docker';")).toBeNull();
    expect(dockerMention('const ok = 1;')).toBeNull();
  });
});
