// Tests for the space floor in the "write the release manifest into the inbox" step of .github/workflows/colo-deploy.yml.
// The step's run block is extracted and run under bash with df, docker and mktemp stand-ins first on PATH. The floor must fire
// BEFORE the mktemp, and say whether inodes or blocks ran out.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SH } from './colo-deploy-fixture';

// Git for Windows' bash on a Windows desktop (a bare 'bash' there is WSL), the system bash elsewhere.
const BASH = SH === 'sh' ? 'bash' : join(dirname(SH), 'bash');

const WORKFLOW = fileURLToPath(new URL('../../.github/workflows/colo-deploy.yml', import.meta.url));
const posix = (p: string) => p.replaceAll(String.fromCharCode(92), '/');
// A PATH entry in the form MSYS bash accepts: C:/x would be split at the colon.
const msys = (p: string) =>
  posix(p).replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function runBlock(): string {
  const lines = readFileSync(WORKFLOW, 'utf8').split('\n');
  const step = lines.findIndex((l) =>
    l.includes('name: write the release manifest into the inbox'),
  );
  const runAt = lines.findIndex((l, i) => i > step && /^\s+run: \|$/.test(l));
  const indent = (lines[runAt] ?? '').search(/\S/);
  const body: string[] = [];
  for (const l of lines.slice(runAt + 1)) {
    if (l.trim() !== '' && l.search(/\S/) <= indent) break;
    body.push(l.slice(indent + 2));
  }
  return body.join('\n');
}

// df: 5 KiB free or 50 free inodes only for a path containing "poor"; plenty elsewhere.
const dfShim = (kind: 'inodes' | 'blocks' | 'none') =>
  `#!/bin/bash
case "\${@: -1}" in *poor*) poor=1;; *) poor=0;; esac
if [ "$1" = -Pi ]; then n=900000; [ $poor = 1 ] && [ ${kind === 'inodes' ? 1 : 0} = 1 ] && n=50
  printf 'F I U IF P M\\nx 1000000 1 %s 1%% /\\n' "$n"
else n=999999999; [ $poor = 1 ] && [ ${kind === 'blocks' ? 1 : 0} = 1 ] && n=\${POOR_KB:-5}
  printf 'F B U A C M\\nx 999999999 1 %s 1%% /\\n' "$n"; fi
exit 0
`;

function setup(
  kind: 'inodes' | 'blocks' | 'none',
  where: 'inbox' | 'docker' | 'nowhere',
  opts: { env?: Record<string, string | undefined>; dockerSilent?: boolean } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-floor-'));
  dirs.push(dir);
  const bin = join(dir, 'bin');
  const poor = join(dir, 'poor');
  const fine = join(dir, 'fine');
  for (const d of [bin, poor, fine]) mkdirSync(d);
  writeFileSync(join(bin, 'df'), dfShim(kind), { mode: 0o755 });
  const droot = where === 'docker' ? poor : fine;
  // A silent docker stands for `docker info` failing or printing nothing (an unprivileged runner account).
  const say = opts.dockerSilent ? '' : `echo "${posix(droot)}"`;
  writeFileSync(join(bin, 'docker'), `#!/bin/bash\n${say}\n`, { mode: 0o755 });
  const log = join(dir, 'mktemp.log');
  writeFileSync(
    join(bin, 'mktemp'),
    `#!/bin/bash\necho "$*" >> "${posix(log)}"\nexec "$(dirname "$(command -v bash)")/mktemp" "$@"\n`,
    { mode: 0o755 },
  );
  const src = join(dir, 'release.env');
  writeFileSync(src, '# manifest\n');
  const inbox = where === 'inbox' ? poor : fine;
  const r = spawnSync(BASH, ['-c', `PATH="${msys(bin)}:$PATH"\n${runBlock()}`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      INBOX: posix(inbox),
      SRC: posix(src),
      GELDAR_MIN_FREE_INODES: '100',
      GELDAR_MIN_FREE_KB_DEPLOY: '10',
      ...opts.env,
    },
  });
  return { code: r.status, err: r.stderr, out: r.stdout, log, inbox };
}

describe('colo-deploy.yml inbox write: the space floor runs before the mktemp', () => {
  it('refuses an inbox volume out of inodes (blocks fine), naming inodes, before any mktemp', () => {
    const r = setup('inodes', 'inbox');
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('out of INODES on the deploy volume');
    expect(existsSync(r.log)).toBe(false);
  });

  it('refuses an inbox volume out of blocks, naming blocks, before any mktemp', () => {
    const r = setup('blocks', 'inbox');
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('out of BLOCKS on the deploy volume');
    expect(existsSync(r.log)).toBe(false);
  });

  it("refuses Docker's data root out of inodes, before any mktemp", () => {
    const r = setup('inodes', 'docker');
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('out of INODES on the docker data root');
    expect(existsSync(r.log)).toBe(false);
  });

  it('control: healthy filesystems reach the mktemp and write the manifest', () => {
    const r = setup('none', 'nowhere');
    expect(r.code).toBe(0);
    expect(existsSync(r.log)).toBe(true);
    expect(existsSync(join(r.inbox, 'release.env'))).toBe(true);
  });

  // The defaults and the variable name are part of the step: a 10 GiB floor on /var could never pass (a ~9 GB volume).
  describe('the block floor of the step', () => {
    const noEnv = { GELDAR_MIN_FREE_KB_DEPLOY: undefined, GELDAR_MIN_FREE_KB: undefined };
    const GIB = 1048576;

    it('defaults to 1 GiB: 2 GiB free passes, 512 MiB is refused naming the floor', () => {
      const ok = setup('blocks', 'inbox', { env: { ...noEnv, POOR_KB: String(2 * GIB) } });
      expect(ok.code).toBe(0);
      const low = setup('blocks', 'inbox', { env: { ...noEnv, POOR_KB: String(GIB / 2) } });
      expect(low.code).not.toBe(0);
      expect(low.err).toContain('out of BLOCKS on the deploy volume');
      expect(low.err).toContain('the floor is 1048576 KiB');
    });

    it('is set by GELDAR_MIN_FREE_KB_DEPLOY, not by the checkout variable GELDAR_MIN_FREE_KB', () => {
      const huge = { ...noEnv, GELDAR_MIN_FREE_KB: String(100 * GIB), POOR_KB: String(2 * GIB) };
      expect(setup('blocks', 'inbox', { env: huge }).code).toBe(0);
      const own = {
        ...noEnv,
        GELDAR_MIN_FREE_KB_DEPLOY: String(4 * GIB),
        POOR_KB: String(2 * GIB),
      };
      const r = setup('blocks', 'inbox', { env: own });
      expect(r.code).not.toBe(0);
      expect(r.err).toContain('the floor is 4194304 KiB');
    });

    it("applies the same default to Docker's data root", () => {
      const ok = setup('blocks', 'docker', { env: { ...noEnv, POOR_KB: String(2 * GIB) } });
      expect(ok.code).toBe(0);
      const low = setup('blocks', 'docker', { env: { ...noEnv, POOR_KB: String(GIB / 2) } });
      expect(low.code).not.toBe(0);
      expect(low.err).toContain('out of BLOCKS on the docker data root');
    });
  });

  it("says plainly that Docker's data root was not checked when docker info is silent, and still passes", () => {
    const r = setup('none', 'nowhere', { dockerSilent: true });
    expect(r.code).toBe(0);
    expect(r.out).toContain('Docker data root NOT checked here');
  });
});
