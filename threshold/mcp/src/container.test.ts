import { readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
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
    expect(excluded('compose/secrets/postgres-mcp.txt')).toBe(true);
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

  it('starts the server: the entrypoint takes the start subcommand and cli.ts exits 2 without it', () => {
    expect(dockerfile).toMatch(/^ENTRYPOINT \["node", "src\/cli\.ts"\]$/m);
    expect(dockerfile).toMatch(/^CMD \["start"\]$/m);
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
    expect(route?.service).toBe('http://geldar-mcp:8788');
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
    expect(overlay.secrets['postgres-mcp.txt']?.file).toMatch(/^\.\/secrets\//);
  });
});

/** Workspace package name to its directory, read from each package.json (the runtime resolves these by name). */
const workspaceDirs = [
  'animus',
  'contract',
  'threshold/mcp',
  'threshold/mcp-mock',
  'tools/repo-checks',
];
const workspaceByName = new Map(
  workspaceDirs.map((dir) => [
    (JSON.parse(read(`${dir}/package.json`)) as { name: string }).name,
    dir,
  ]),
);

/** The module specifiers a source file names in import, export-from or dynamic import statements. */
function specifiersOf(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map(
    (m) => m[1] as string,
  );
}

/** Every repo file the runtime entry reaches: relative imports and workspace packages, followed transitively. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of specifiersOf(read(file))) {
      if (spec.startsWith('.')) {
        queue.push(posix.join(posix.dirname(file), spec));
      } else if (spec.startsWith('@geldar/')) {
        const [scope, name, ...rest] = spec.split('/');
        const dir = workspaceByName.get(`${scope}/${name}`);
        if (dir === undefined)
          throw new Error(`${file} imports an unknown workspace package: ${spec}`);
        if (rest.length > 0) {
          queue.push(posix.join(dir, rest.join('/')));
        } else {
          const pkg = JSON.parse(read(`${dir}/package.json`)) as {
            exports?: Record<string, string>;
          };
          const entryFile = pkg.exports?.['.'];
          if (typeof entryFile !== 'string')
            throw new Error(`${dir} has no string exports["."] entry`);
          queue.push(posix.join(dir, entryFile));
        }
      }
    }
  }
  return seen;
}

describe('the image holds everything the runtime reads or imports', () => {
  const entry = 'threshold/mcp/src/cli.ts';

  it('keeps the shard file the default config path reads, and the workspace root marker', () => {
    for (const path of ['shards/phase0.yaml', 'pnpm-workspace.yaml']) {
      expect(excluded(path), path).toBe(false);
    }
  });

  it('keeps every file reached from src/cli.ts through relative and workspace imports', () => {
    const reached = reachableFrom(entry);
    expect(reached.has('tools/repo-checks/src/identity-mode.ts')).toBe(true);
    expect(reached.has('threshold/mcp-mock/src/index.ts')).toBe(true);
    expect(reached.size).toBeGreaterThan(20);
    for (const file of reached) expect(excluded(file), file).toBe(false);
  });
});

describe('compose/mcp.yml healthcheck', () => {
  const overlay = parse(read('compose/mcp.yml')) as {
    services: Record<string, Record<string, unknown>>;
  };
  const mcp = overlay.services['geldar-mcp'] as Record<string, unknown>;

  it('declares a TCP probe of the published port so a crash loop is visible to up --wait', () => {
    const hc = mcp.healthcheck as {
      test: string[];
      interval: string;
      retries: number;
      start_period: string;
    };
    expect(hc.test.join(' ')).toMatch(/8788/);
    expect(hc.test.join(' ')).toMatch(/connect/);
    expect(hc.retries).toBeGreaterThan(0);
    expect(hc.start_period).toMatch(/^\d+s$/);
    expect(hc.interval).toMatch(/^\d+s$/);
  });
});

describe('geldar.ps1 Wave M block', () => {
  const script = read('geldar.ps1');
  const block = script.slice(
    script.indexOf('function Invoke-Mcp'),
    script.indexOf('switch ($Command)'),
  );

  it('saves and restores in a finally every environment variable it sets', () => {
    const names = [...block.matchAll(/\$env:(\w+)\s*=/gi)].map((m) => m[1] as string);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(block, `${name} is saved before it is set`).toMatch(
        new RegExp(`\\$saved = @\\{[^}]*\\b${name} = \\$env:${name}\\b`),
      );
      const at = block.indexOf(`$env:${name} =`);
      const finallyAt = block.indexOf('finally', at);
      expect(finallyAt, `${name} has a finally`).toBeGreaterThan(at);
      expect(block.slice(finallyAt, finallyAt + 300), name).toContain('$saved.Keys');
    }
  });
});
