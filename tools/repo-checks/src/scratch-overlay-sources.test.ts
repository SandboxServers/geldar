import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Relative bind sources in the compose overlays that deploy/scratch/scratch.sh can add. Compose resolves every relative path in
// every file against the project directory, which is the directory of the FIRST -f file (scratch.sh passes no --project-directory).
// scratch.sh puts compose/phase0.yml first, so the project directory is compose/, not the overlay's own directory. An overlay
// written relative to its own directory (compose/opt-in/) fails here: its source names a path that does not exist.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRATCH = join(ROOT, 'deploy/scratch/scratch.sh');

interface Layer {
  guard: string;
  file: string;
}

// compose_run prepends each -f (last prepended is first on the command line), so the list is reversed to get the real order.
function composeLayers(): Layer[] {
  const text = readFileSync(SCRATCH, 'utf8');
  const start = text.indexOf('\ncompose_run() {');
  const end = text.indexOf('\n}\n', start);
  if (start < 0 || end < 0) throw new Error('scratch.sh: compose_run not found');
  const layers: Layer[] = [];
  for (const line of text.slice(start, end).split('\n')) {
    const m = /^(.*?)set -- (?:-p "\$PROJECT" )?-f "\$ROOT\/(compose\/[^"]+)" "\$@"/.exec(line);
    if (m) layers.push({ guard: m[1] ?? '', file: m[2] ?? '' });
  }
  return layers.reverse();
}

const LAYERS = composeLayers();
const FILES = LAYERS.map((l) => l.file);
const PROJECT_DIR = dirname(join(ROOT, FILES[0] ?? ''));

interface Bind {
  file: string;
  target: string;
  source: string;
}

// Literal relative sources only: a source with ${...} is an env-chosen host path and is not checked here.
function relativeBinds(file: string): Bind[] {
  const doc = parse(readFileSync(join(ROOT, file), 'utf8'), { logLevel: 'silent' }) as {
    services?: Record<string, { volumes?: unknown[] }>;
  } | null;
  const binds: Bind[] = [];
  for (const svc of Object.values(doc?.services ?? {})) {
    for (const v of svc.volumes ?? []) {
      if (!v || typeof v !== 'object') continue;
      const vol = v as { type?: string; source?: unknown; target?: unknown };
      if (vol.type !== 'bind' || typeof vol.source !== 'string') continue;
      if (vol.source.includes('${')) continue;
      if (!vol.source.startsWith('./') && !vol.source.startsWith('../')) continue;
      binds.push({ file, target: String(vol.target), source: vol.source });
    }
  }
  return binds;
}

function insideRepo(path: string): boolean {
  const rel = relative(ROOT, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

const BINDS: Bind[] = FILES.flatMap(relativeBinds);

describe('scratch.sh compose order', () => {
  it('puts compose/phase0.yml first, so the project directory is compose/', () => {
    expect(FILES[0]).toBe('compose/phase0.yml');
    expect(PROJECT_DIR).toBe(join(ROOT, 'compose'));
  });

  it('passes no --project-directory (the first -f file sets the project directory)', () => {
    expect(readFileSync(SCRATCH, 'utf8')).not.toMatch(/--project-directory/);
  });

  it('includes the NeoForge extra-mods overlay after the NeoForge overlay in the neoforge list', () => {
    const extra = FILES.indexOf('compose/opt-in/scratch-neoforge-extra-mods.yml');
    const neo = FILES.indexOf('compose/opt-in/scratch-neoforge.yml');
    expect(extra).toBeGreaterThan(0);
    expect(neo).toBeGreaterThan(0);
    expect(neo).toBeLessThan(extra);
    expect(LAYERS[extra]?.guard).toMatch(/SCRATCH_EXTRA_MODS/);
  });
});

describe('overlay relative bind sources resolve against the project directory', () => {
  it('finds the extra-mods overlay bind sources (the test is not empty)', () => {
    const extra = BINDS.filter((b) => b.file === 'compose/opt-in/scratch-neoforge-extra-mods.yml');
    expect(extra.map((b) => b.target).sort()).toEqual([
      '/geldar/extra-mods/bluemap-config',
      '/geldar/extra-mods/bluemap-config.sh',
    ]);
  });

  it.each(BINDS.map((b) => [b.file, b.target, b.source] as const))(
    '%s: %s source %s exists inside the repo',
    (_file, _target, source) => {
      const resolved = resolve(PROJECT_DIR, source);
      expect(insideRepo(resolved), `${source} resolves outside the repo`).toBe(true);
      expect(existsSync(resolved), `${source} resolves to ${resolved}, which does not exist`).toBe(
        true,
      );
    },
  );
});
