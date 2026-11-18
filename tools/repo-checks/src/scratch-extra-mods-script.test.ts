/**
 * The scratch extra mods hook (SCRATCH_EXTRA_MODS=1) in deploy/scratch/scratch.sh and deploy/scratch/scratch-extra-mods.sh,
 * run under sh with the docker stubs. The tree copy holds fixture jars and a fixture pins file (the real jars are not in the
 * repo, so their pins cannot match). A refusal must exit 2 with no docker call. Nothing starts a container.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTH, CAN_SYMLINK, runScript, skipWithoutSh, slash } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const HOOK_TEXT = readFileSync(`${ROOT}deploy/scratch/scratch-extra-mods.sh`, 'utf8');
const OVERLAY = 'opt-in/scratch-neoforge-extra-mods.yml';
const NEOFORGE_YML = 'opt-in/scratch-neoforge.yml';
const CHUNKY = 'chunky fixture bytes\n';
const BLUEMAP = 'bluemap fixture bytes\n';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const jarPath = (base: string, name: string) => slash(join(base, 'jars', name));
const composeCalls = (calls: string[]) => calls.filter((c) => c.includes('-p scratch-'));

/** The fixture tree: the hook, a pins file whose hashes match the fixture jars, and (unless guard is false) the BlueMap
 * config seeding file the hook's guard looks for. The jars sit beside the tree, not in it. */
function fixture(base: string, guard = true): void {
  const tree = join(base, 'tree');
  mkdirSync(join(tree, 'deploy', 'scratch'), { recursive: true });
  mkdirSync(join(tree, 'compose', 'neoforge'), { recursive: true });
  mkdirSync(join(base, 'jars'), { recursive: true });
  writeFileSync(join(tree, 'deploy', 'scratch', 'scratch-extra-mods.sh'), HOOK_TEXT);
  writeFileSync(join(base, 'jars', 'chunky.jar'), CHUNKY);
  writeFileSync(join(base, 'jars', 'bluemap.jar'), BLUEMAP);
  writeFileSync(
    join(tree, 'compose', 'neoforge', 'extra-mods.pins'),
    `chunky ${sha(CHUNKY)} Chunky.jar 1.5.66\nbluemap ${sha(BLUEMAP)} bluemap.jar 5.29\n`,
  );
  if (guard) {
    writeFileSync(join(tree, 'compose', 'neoforge', 'extra-mods-bluemap-config.sh'), '# fixture\n');
  }
}

type Over = Record<string, string | undefined>;
const good = (base: string): Over => ({
  ...AUTH,
  SCRATCH_PLATFORM: 'neoforge',
  SCRATCH_EXTRA_MODS: '1',
  SCRATCH_EXTRA_CHUNKY_JAR_HOST: jarPath(base, 'chunky.jar'),
  SCRATCH_EXTRA_BLUEMAP_JAR_HOST: jarPath(base, 'bluemap.jar'),
});

/** Runs a verb against the fixture tree. over edits the environment; after edits the fixture files once they exist. */
function run(
  args: string[],
  over: (base: string) => Over = () => ({}),
  opts: { guard?: boolean; after?: (base: string) => void } = {},
) {
  return runScript(args, (base) => ({ ...good(base), ...over(base) }), {
    tree: { jars: true },
    prepare: (base) => {
      fixture(base, opts.guard ?? true);
      opts.after?.(base);
    },
  });
}

// Each run starts sh and the stubs, and a successful up runs several compose calls: slower than the 5 s default on Windows.
describe.skipIf(skipWithoutSh())(
  'scratch.sh: the extra mods hook (SCRATCH_EXTRA_MODS=1)',
  { timeout: 60_000 },
  () => {
    it('up with both jars matching their pins adds the overlay once to every compose call, after scratch-neoforge.yml', () => {
      const r = run(['up', 'a']);
      expect(r.status, r.stderr).toBe(0);
      const calls = composeCalls(r.calls);
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c.split(OVERLAY).length - 1, c).toBe(1);
        expect(c.indexOf(NEOFORGE_YML)).toBeLessThan(c.indexOf(OVERLAY));
      }
    });

    it('a paper project never gets the overlay, even with the variables set (down, no refusal)', () => {
      const r = run(['down', 'a'], () => ({ SCRATCH_PLATFORM: undefined }));
      expect(composeCalls(r.calls).length).toBeGreaterThan(0);
      for (const c of composeCalls(r.calls)) expect(c).not.toContain(OVERLAY);
    });

    it('with SCRATCH_EXTRA_MODS unset no compose call names the overlay', () => {
      const r = run(['up', 'a'], () => ({ SCRATCH_EXTRA_MODS: undefined }));
      expect(r.status, r.stderr).toBe(0);
      expect(composeCalls(r.calls).length).toBeGreaterThan(0);
      for (const c of composeCalls(r.calls)) expect(c).not.toContain(OVERLAY);
    });

    it('down keeps the overlay for a NeoForge project and never refuses on the jar variables', () => {
      const r = run(['down', 'a'], (base) => ({
        SCRATCH_EXTRA_CHUNKY_JAR_HOST: 'jars/chunky.jar',
        SCRATCH_EXTRA_BLUEMAP_JAR_HOST: jarPath(base, 'missing.jar'),
      }));
      expect(r.stderr).not.toContain('nothing started');
      expect(composeCalls(r.calls).length).toBeGreaterThan(0);
      for (const c of composeCalls(r.calls)) expect(c.split(OVERLAY).length - 1).toBe(1);
    });

    it('SCRATCH_EXTRA_MODS=yes is refused with exit 2 and no docker call', () => {
      const r = run(['up', 'a'], () => ({ SCRATCH_EXTRA_MODS: 'yes' }));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('SCRATCH_EXTRA_MODS must be 1 or unset');
      expect(r.calls).toEqual([]);
    });

    it('SCRATCH_PLATFORM=paper with SCRATCH_EXTRA_MODS=1 is refused with no docker call', () => {
      const r = run(['up', 'a'], () => ({ SCRATCH_PLATFORM: 'paper' }));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('needs SCRATCH_PLATFORM=neoforge');
      expect(r.calls).toEqual([]);
    });

    it.each([
      [
        'the chunky variable unset',
        (): Over => ({ SCRATCH_EXTRA_CHUNKY_JAR_HOST: undefined }),
        'CHUNKY_JAR_HOST is not set',
      ],
      [
        'the bluemap variable unset',
        (): Over => ({ SCRATCH_EXTRA_BLUEMAP_JAR_HOST: undefined }),
        'BLUEMAP_JAR_HOST is not set',
      ],
      [
        'a relative chunky path',
        (): Over => ({ SCRATCH_EXTRA_CHUNKY_JAR_HOST: 'jars/chunky.jar' }),
        'absolute path',
      ],
      [
        'a directory as the bluemap jar',
        (base: string): Over => ({ SCRATCH_EXTRA_BLUEMAP_JAR_HOST: slash(join(base, 'jars')) }),
        'regular file',
      ],
      [
        'a jar with a quote in its path',
        (base: string): Over => ({
          SCRATCH_EXTRA_CHUNKY_JAR_HOST: `${jarPath(base, 'chunky.jar')}"`,
        }),
        'quotes',
      ],
    ])('refused before any docker call: %s', (_name, over, message) => {
      const r = run(['up', 'a'], over);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(message);
      expect(r.calls).toEqual([]);
    });

    it('an empty chunky jar is refused before any docker call', () => {
      const r = run(['up', 'a'], undefined, {
        after: (base) => writeFileSync(join(base, 'jars', 'chunky.jar'), ''),
      });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('non-empty');
      expect(r.calls).toEqual([]);
    });

    it('a bluemap jar whose sha256 does not match its pin is refused (the chunky jar is fine)', () => {
      const r = run(['up', 'a'], undefined, {
        after: (base) => writeFileSync(join(base, 'jars', 'bluemap.jar'), 'tampered\n'),
      });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('SCRATCH_EXTRA_BLUEMAP_JAR_HOST does not match its pin');
      expect(r.calls).toEqual([]);
    });

    it.skipIf(!CAN_SYMLINK)('a symlink to a good jar is refused before any docker call', () => {
      const r = run(
        ['up', 'a'],
        (base) => ({ SCRATCH_EXTRA_CHUNKY_JAR_HOST: jarPath(base, 'link.jar') }),
        {
          after: (base) =>
            symlinkSync(join(base, 'jars', 'chunky.jar'), join(base, 'jars', 'link.jar')),
        },
      );
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('not a symlink');
      expect(r.calls).toEqual([]);
    });

    it('the guard: no BlueMap config seeding in the tree, so up is refused before any docker call', () => {
      const r = run(['up', 'a'], undefined, { guard: false });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('not in this tree');
      expect(r.calls).toEqual([]);
    });
  },
);
