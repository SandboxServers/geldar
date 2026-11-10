import { describe, expect, it } from 'vitest';
import {
  checkActionPins,
  checkComposeImageDigests,
  checkDockerfileFrom,
  checkExactDependencies,
  checkLockfileSources,
  checkPins,
  isComposeImageFile,
  isDockerfile,
} from './pin-rules.ts';

const DIGEST = `@sha256:${'a'.repeat(64)}`;
const SHA = 'b'.repeat(40);

describe('checkExactDependencies', () => {
  it('accepts exact versions and workspace links', () => {
    const text = JSON.stringify({
      dependencies: { pg: '8.23.1', '@geldar/animus': 'workspace:*' },
      devDependencies: { vitest: '5.0.5-beta.1' },
    });
    expect(checkExactDependencies('package.json', text)).toEqual([]);
  });

  it('reports a range in any dependency field', () => {
    const text = JSON.stringify({
      dependencies: { pg: '^8.23.1' },
      optionalDependencies: { fsevents: '~2.3.0' },
    });
    const problems = checkExactDependencies('package.json', text);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('dependencies.pg');
  });

  it('ignores peerDependencies, which are ranges by design', () => {
    const text = JSON.stringify({ peerDependencies: { zod: '^4.0.0' } });
    expect(checkExactDependencies('package.json', text)).toEqual([]);
  });

  it('reports a manifest that is not JSON', () => {
    expect(checkExactDependencies('package.json', '{')).toHaveLength(1);
  });
});

describe('checkDockerfileFrom', () => {
  it('accepts a digest, scratch, and a stage reference', () => {
    const text = `FROM node:22.23.2-trixie-slim${DIGEST} AS deps\nFROM deps AS app\nFROM scratch\n`;
    expect(checkDockerfileFrom('Dockerfile', text)).toEqual([]);
  });

  it('reports a tag without a digest, with its line number', () => {
    const text = 'FROM node:22.23-alpine\nRUN true\n';
    expect(checkDockerfileFrom('eventsink/Dockerfile', text)).toEqual([
      'eventsink/Dockerfile:1: FROM node:22.23-alpine is not pinned by digest',
    ]);
  });

  it('skips a --platform flag before the image', () => {
    const text = `FROM --platform=linux/amd64 node:22${DIGEST}\n`;
    expect(checkDockerfileFrom('Dockerfile', text)).toEqual([]);
  });
});

describe('checkComposeImageDigests', () => {
  it('accepts a digest and a service built locally', () => {
    const text = `services:\n  db:\n    image: pgvector/pgvector:0.8.6-pg16${DIGEST}\n  mcp:\n    build: .\n    image: geldar-mcp:local\n`;
    expect(checkComposeImageDigests('compose/phase0.yml', text)).toEqual([]);
  });

  it('reports a pulled image with only a tag', () => {
    const text = 'services:\n  nats:\n    image: nats:2.15.1-alpine\n';
    const problems = checkComposeImageDigests('compose/phase0.yml', text);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('service nats');
  });
});

describe('checkActionPins', () => {
  it('accepts a full commit SHA and a local action', () => {
    const text = `steps:\n  - uses: actions/checkout@${SHA} # v6\n  - uses: ./.github/actions/x\n`;
    expect(checkActionPins('.github/workflows/ci.yml', text)).toEqual([]);
  });

  it('reports a tag and a short SHA', () => {
    const text = `steps:\n  - uses: actions/checkout@v6\n  - uses: docker/build-push-action@c3c9e26\n`;
    const problems = checkActionPins('.github/workflows/ci.yml', text);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain(':2:');
  });
});

describe('checkLockfileSources', () => {
  it('accepts registry entries', () => {
    const text = 'packages:\n  hono@4.13.14:\n    resolution: {integrity: sha512-abc}\n';
    expect(checkLockfileSources('pnpm-lock.yaml', text)).toEqual([]);
  });

  it('reports git, tarball, and file sources', () => {
    const text = [
      'packages:',
      '  a@1.0.0:',
      '    resolution: {tarball: https://example.test/a.tgz}',
      '  b@1.0.0:',
      '    resolution: {type: git, repo: x}',
      '  c@1.0.0:',
      '    resolution: {integrity: x}',
      '    version: file:../c',
    ].join('\n');
    expect(checkLockfileSources('pnpm-lock.yaml', text)).toHaveLength(3);
  });
});

describe('file selection', () => {
  it('matches Dockerfiles but not .dockerignore files', () => {
    expect(isDockerfile('threshold/mcp/Dockerfile')).toBe(true);
    expect(isDockerfile('threshold/mcp/Dockerfile.dockerignore')).toBe(false);
  });

  it('matches compose files by name', () => {
    expect(isComposeImageFile('compose/phase0.yml')).toBe(true);
    expect(isComposeImageFile('docker-compose.yml')).toBe(true);
    expect(isComposeImageFile('threshold/mcp-mock/compose.example.yml')).toBe(true);
    expect(isComposeImageFile('golem/config.yml')).toBe(false);
  });

  it('dispatches by path and returns nothing for an uncovered file', () => {
    expect(checkPins('README.md', 'FROM x')).toEqual([]);
    expect(checkPins('eventsink/Dockerfile', 'FROM node:22')).toHaveLength(1);
  });
});
