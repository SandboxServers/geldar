import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path: string): string => readFileSync(resolve(repo, path), 'utf8');

const ignoreLines = read('threshold/mcp/Dockerfile.dockerignore')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '' && !l.startsWith('#'));

/** One dockerignore pattern, anchored at the context root, as a regular expression (same rules as the mock's test). */
function toRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** Last matching pattern wins; a leading "!" re-includes. Ancestor directories are tried too. */
function excluded(path: string): boolean {
  const parts = path.split('/');
  const candidates = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  let result = false;
  for (const line of ignoreLines) {
    const negate = line.startsWith('!');
    const re = toRegExp(negate ? line.slice(1) : line);
    if (candidates.some((c) => re.test(c))) result = !negate;
  }
  return result;
}

describe('threshold/mcp/Dockerfile.dockerignore', () => {
  it('keeps tokens, env files, secrets and tests out of the build context', () => {
    expect(excluded('threshold/mcp/mcp-tokens.json')).toBe(true);
    expect(excluded('compose/secrets/mcp-db.txt')).toBe(true);
    expect(excluded('threshold/mcp/.env.local')).toBe(true);
    expect(excluded('threshold/mcp/src/config.test.ts')).toBe(true);
    expect(excluded('threshold/mcp/src/store/node_modules/pg/index.js')).toBe(true);
  });

  it('keeps what the image build needs', () => {
    for (const kept of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.nvmrc',
      'contract/package.json',
      'animus/package.json',
      'animus/src/validate/index.ts',
      'threshold/mcp/package.json',
      'threshold/mcp/src/config.ts',
      'threshold/mcp-mock/src/cli.ts',
      'threshold/mcp-mock/scenarios/dawn.scenario.json',
    ]) {
      expect(excluded(kept), kept).toBe(false);
    }
  });
});

describe('threshold/mcp/Dockerfile', () => {
  const dockerfile = read('threshold/mcp/Dockerfile');
  const fromLines = dockerfile.split('\n').filter((l) => l.startsWith('FROM '));

  it('pins every base image by digest', () => {
    expect(fromLines).toHaveLength(2);
    for (const line of fromLines) expect(line).toMatch(/@sha256:[0-9a-f]{64}\b/);
  });

  it('runs the final stage as a numeric non-root user', () => {
    expect(dockerfile).toMatch(/^USER 1000:1000$/m);
    expect(dockerfile).not.toMatch(/^USER root$/m);
  });

  it('does not copy a token, env file or secret into the image', () => {
    const copies = dockerfile.split('\n').filter((l) => l.startsWith('COPY'));
    expect(copies.length).toBeGreaterThan(0);
    expect(copies.join('\n')).not.toMatch(/tokens|\.env|secret/);
  });
});

describe('compose/cloudflared/config.example.yml', () => {
  const config = parse(read('compose/cloudflared/config.example.yml')) as {
    ingress: { hostname?: string; path?: string; service: string }[];
  };

  it('parses and ends with the 404 catch-all', () => {
    const rules = config.ingress;
    expect(rules.at(-1)).toEqual({ service: 'http_status:404' });
    expect(rules.slice(0, -1).every((r) => r.service !== 'http_status:404')).toBe(true);
  });

  it('routes only /p/<player> to the MCP on loopback', () => {
    const [route] = config.ingress;
    expect(route?.service).toBe('http://127.0.0.1:8788');
    const re = new RegExp(route?.path ?? '');
    expect(re.test('/p/ag-test-01')).toBe(true);
    expect(re.test('/p/a')).toBe(false);
    expect(re.test('/p/1abc')).toBe(false);
    expect(re.test('/p/ag/../admin')).toBe(false);
    expect(re.test('/admin/p/ag-test-01')).toBe(false);
  });
});

describe('compose/mcp.yml', () => {
  const overlay = parse(read('compose/mcp.yml')) as {
    services: Record<string, Record<string, unknown>>;
    secrets: Record<string, { file: string }>;
  };
  const mcp = overlay.services['geldar-mcp'] as Record<string, unknown>;

  it('hardens the container: read-only root, no capabilities, no new privileges, limits', () => {
    expect(mcp.read_only).toBe(true);
    expect(mcp.cap_drop).toEqual(['ALL']);
    expect(mcp.security_opt).toEqual(['no-new-privileges:true']);
    expect(mcp.mem_limit).toBe('512m');
    expect(mcp.pids_limit).toEqual(expect.any(Number));
    expect(mcp.user).toBe('1000:1000');
  });

  it('publishes only the loopback port and keeps secrets out of the environment', () => {
    expect(mcp.ports).toEqual(['127.0.0.1:8788:8788']);
    const env = mcp.environment as Record<string, string>;
    for (const [key, value] of Object.entries(env)) {
      expect(key, key).not.toMatch(/PASSWORD$|SECRET$|TOKEN$/);
      expect(value, key).not.toMatch(/^(?:[a-z0-9]{32,}|gmcp-)/i);
    }
    expect(env.GELDAR_MCP_DB_PASSWORD_FILE).toMatch(/^\/run\/secrets\//);
    expect(overlay.secrets['mcp-db']?.file).toMatch(/^\.\/secrets\//);
  });
});
