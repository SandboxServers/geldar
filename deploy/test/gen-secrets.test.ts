import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHOWN_SHIM,
  canSymlink,
  DEPLOY,
  fixture,
  posix,
  run,
  setMode,
  setOwner,
  writeShim,
} from './colo-deploy-fixture';

// The default list (deploy/genesis/secret-names.list): the names gen-secrets.sh creates when GELDAR_SECRETS_LIST is unset.
const LIST = readFileSync(join(DEPLOY, 'genesis', 'secret-names.list'), 'utf8')
  .split('\n')
  .filter((l) => l !== '' && !l.startsWith('#'));
// The owner-provided names gen-secrets.sh refuses (its OWNER_PROVIDED deny set): never generated, so never in the list.
const OWNER_PROVIDED = [
  'register-ms-secret.txt',
  'register-github-secret.txt',
  'register-discord-secret.txt',
];
// The fake chmod: records each call ("MODE PATH") in $FAKE_CHMOD_LOG and changes nothing.
const CHMOD_SHIM = `#!/bin/sh
echo "$*" >>"$FAKE_CHMOD_LOG"
`;
// Symlink tests need symlink creation; a directory link is also left to CI on Windows (junctions are not symlinks there).
const itLink = canSymlink ? it : it.skip;
const itDirLink = canSymlink && process.platform !== 'win32' ? it : it.skip;

// The content and mtime of every listed file in a directory, so a test can prove that nothing was rewritten.
function snap(dir: string) {
  return Object.fromEntries(
    LIST.filter((f) => existsSync(join(dir, f))).map((f) => [
      f,
      { content: readFileSync(join(dir, f), 'utf8'), mtimeMs: statSync(join(dir, f)).mtimeMs },
    ]),
  );
}

describe('gen-secrets.sh (G2-01): create-if-missing, owner, mode and names-only report', () => {
  it('the default list names the Glass session key and the two supervisor passwords, and is the only list read', () => {
    expect(LIST).toEqual([
      'postgres.txt',
      'rcon.txt',
      'velocity-forwarding.txt',
      'nats-body.txt',
      'postgres-mcp.txt',
      'postgres-glass.txt',
      'postgres-register.txt',
      'register-pepper.txt',
      'mcp-token-pepper.txt',
      'register-session-key.txt',
      'postgres-supervisor.txt',
      'nats-supervisor.txt',
    ]);
    expect(LIST.every((f) => /^[a-z0-9][a-z0-9-]*\.txt$/.test(f))).toBe(true);
  });

  it('no default-list name is owner-provided (the Entra client secret is placed by the owner)', () => {
    expect(LIST.filter((f) => OWNER_PROVIDED.includes(f))).toEqual([]);
  });

  it('a second run changes nothing: the same content and mtime for every file, and every name reported kept', () => {
    const fx = fixture();
    const dir = join(fx.dir, 'twice');
    const extra = { GELDAR_SECRETS_DIR: posix(dir), GELDAR_SERVICE_UID: '1000' };
    const first = run('gen-secrets.sh', fx, extra);
    expect(first.code).toBe(0);
    for (const f of LIST) expect(first.out).toContain(`created: ${f}`);
    const before = snap(dir);
    expect(Object.keys(before)).toHaveLength(LIST.length);
    const second = run('gen-secrets.sh', fx, extra);
    expect(second.code).toBe(0);
    expect(snap(dir)).toEqual(before);
    expect(second.out).not.toContain('created:');
    for (const f of LIST) expect(second.out).toContain(`kept (exists): ${f}`);
  });

  it('a missing file is created with mode 0600 and the files that exist keep their value', () => {
    const fx = fixture();
    const dir = join(fx.dir, 'missing');
    const extra = { GELDAR_SECRETS_DIR: posix(dir), GELDAR_SERVICE_UID: '1000' };
    expect(run('gen-secrets.sh', fx, extra).code).toBe(0);
    const kept = readFileSync(join(dir, 'postgres.txt'), 'utf8');
    rmSync(join(dir, 'rcon.txt'));
    const r = run('gen-secrets.sh', fx, extra);
    expect(r.code).toBe(0);
    expect(r.out).toContain('created: rcon.txt');
    expect(r.out).not.toContain('created: postgres.txt');
    expect(readFileSync(join(dir, 'rcon.txt'), 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(dir, 'postgres.txt'), 'utf8')).toBe(kept);
    // NTFS reports 0666 whatever the script does, so the mode is checked on POSIX only (`umask 077` everywhere).
    if (process.platform !== 'win32')
      expect(statSync(join(dir, 'rcon.txt')).mode & 0o777).toBe(0o600);
  });

  it('a wrong owner is reported by name, the value is kept, and the script exits non-zero', () => {
    const fx = fixture();
    const dir = join(fx.dir, 'wrong-owner');
    const extra = { GELDAR_SECRETS_DIR: posix(dir), GELDAR_SERVICE_UID: '1000' };
    expect(run('gen-secrets.sh', fx, extra).code).toBe(0);
    const before = readFileSync(join(dir, 'rcon.txt'), 'utf8');
    setOwner(fx, 'rcon.txt', '1001');
    const r = run('gen-secrets.sh', fx, extra);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('wrong-owner: rcon.txt');
    expect(r.out).toContain('run as root to fix');
    expect(r.out).not.toContain('kept (exists): rcon.txt');
    expect(readFileSync(join(dir, 'rcon.txt'), 'utf8')).toBe(before);
  });

  it('a wrong mode as a non-root account is reported as wrong-mode, the value is kept, and the script exits non-zero', () => {
    const fx = fixture();
    const dir = join(fx.dir, 'wrong-mode');
    const extra = { GELDAR_SECRETS_DIR: posix(dir), GELDAR_SERVICE_UID: '1000' };
    expect(run('gen-secrets.sh', fx, extra).code).toBe(0);
    const before = readFileSync(join(dir, 'rcon.txt'), 'utf8');
    setMode(fx, 'rcon.txt', '644');
    const r = run('gen-secrets.sh', fx, extra);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('wrong-mode: rcon.txt has mode 644');
    expect(r.out).toContain('run as root to fix');
    expect(r.out).not.toContain('mode fixed');
    expect(readFileSync(join(dir, 'rcon.txt'), 'utf8')).toBe(before);
  });

  it('root fixes a wrong owner on an existing file (chown only, the value is not touched)', () => {
    const fx = fixture();
    writeShim(join(fx.dir, 'bin'), 'chown', CHOWN_SHIM);
    const dir = join(fx.dir, 'root-fix');
    const log = join(fx.dir, 'root-fix-chown.log');
    const extra = {
      GELDAR_SECRETS_DIR: posix(dir),
      GELDAR_SERVICE_UID: '1000',
      FAKE_CHOWN_LOG: posix(log),
    };
    expect(run('gen-secrets.sh', fx, { ...extra, FAKE_RUNNER_UID: '0' }).code).toBe(0);
    const before = readFileSync(join(dir, 'rcon.txt'), 'utf8');
    setOwner(fx, 'rcon.txt', '1001');
    // Only the second run's chown calls are asserted: the fresh run chowned every created file, so its log is cleared.
    writeFileSync(log, '');
    const r = run('gen-secrets.sh', fx, { ...extra, FAKE_RUNNER_UID: '0' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('kept (exists), owner fixed: rcon.txt');
    expect(readFileSync(log, 'utf8')).toBe(
      `1000 ${posix(join(dir, 'rcon.txt'))}\n1000 ${posix(dir)}\n`,
    );
    expect(readFileSync(join(dir, 'rcon.txt'), 'utf8')).toBe(before);
  });

  it('root fixes a wrong mode on an existing file: chmod 0600 on that file, and the report says so', () => {
    const fx = fixture();
    const bin = join(fx.dir, 'bin');
    writeShim(bin, 'chown', CHOWN_SHIM);
    writeShim(bin, 'chmod', CHMOD_SHIM);
    const dir = join(fx.dir, 'root-mode');
    const chmodLog = join(fx.dir, 'root-mode-chmod.log');
    const extra = {
      GELDAR_SECRETS_DIR: posix(dir),
      GELDAR_SERVICE_UID: '1000',
      FAKE_RUNNER_UID: '0',
      FAKE_CHOWN_LOG: posix(join(fx.dir, 'root-mode-chown.log')),
      FAKE_CHMOD_LOG: posix(chmodLog),
    };
    expect(run('gen-secrets.sh', fx, extra).code).toBe(0);
    const before = readFileSync(join(dir, 'rcon.txt'), 'utf8');
    setMode(fx, 'rcon.txt', '644');
    writeFileSync(chmodLog, '');
    const r = run('gen-secrets.sh', fx, extra);
    expect(r.code).toBe(0);
    expect(r.out).toContain('kept (exists), mode fixed to 0600: rcon.txt');
    // The directory is set to 0700 on every run; the only other chmod is the 0600 on the wrong file.
    expect(readFileSync(chmodLog, 'utf8')).toBe(
      `700 ${posix(dir)}\n600 ${posix(join(dir, 'rcon.txt'))}\n`,
    );
    expect(readFileSync(join(dir, 'rcon.txt'), 'utf8')).toBe(before);
  });

  itLink(
    'a symlink named rcon.txt that points outside the directory is refused: non-zero, and root changes nothing',
    () => {
      const fx = fixture();
      writeShim(join(fx.dir, 'bin'), 'chown', CHOWN_SHIM);
      const dir = join(fx.dir, 'link-file');
      mkdirSync(dir);
      const outside = join(fx.dir, 'outside.txt');
      writeFileSync(outside, 'outside-value\n');
      symlinkSync(outside, join(dir, 'rcon.txt'));
      // The fake stat reports the link's owner as the service uid's other account, so a root run would try a chown.
      setOwner(fx, 'rcon.txt', '1001');
      const log = join(fx.dir, 'link-file-chown.log');
      const r = run('gen-secrets.sh', fx, {
        GELDAR_SECRETS_DIR: posix(dir),
        GELDAR_SERVICE_UID: '1000',
        FAKE_RUNNER_UID: '0',
        FAKE_CHOWN_LOG: posix(log),
      });
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('refusing a symlink (not followed): rcon.txt');
      expect(existsSync(log) ? readFileSync(log, 'utf8') : '').toBe('');
      expect(readFileSync(outside, 'utf8')).toBe('outside-value\n');
    },
  );

  itDirLink(
    'a symlink at the secrets directory is refused before any chmod or chown (root)',
    () => {
      const fx = fixture();
      writeShim(join(fx.dir, 'bin'), 'chown', CHOWN_SHIM);
      const target = join(fx.dir, 'real-dir');
      mkdirSync(target);
      const dir = join(fx.dir, 'link-dir');
      symlinkSync(target, dir);
      const log = join(fx.dir, 'link-dir-chown.log');
      const r = run('gen-secrets.sh', fx, {
        GELDAR_SECRETS_DIR: posix(dir),
        GELDAR_SERVICE_UID: '1000',
        FAKE_RUNNER_UID: '0',
        FAKE_CHOWN_LOG: posix(log),
      });
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('refusing a symlink (not followed): the secrets directory');
      expect(existsSync(log) ? readFileSync(log, 'utf8') : '').toBe('');
      expect(readdirSync(target)).toEqual([]);
    },
  );

  it('a list that names a file twice is refused before anything is created', () => {
    const fx = fixture();
    const list = join(fx.dir, 'twice.list');
    writeFileSync(list, 'postgres.txt\nrcon.txt\npostgres.txt\n');
    const dir = join(fx.dir, 'twice-list');
    const r = run('gen-secrets.sh', fx, {
      GELDAR_SECRETS_DIR: posix(dir),
      GELDAR_SECRETS_LIST: posix(list),
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secret name listed twice');
    expect(r.out).toContain('line 3');
    expect(existsSync(dir)).toBe(false);
  });

  it.each(OWNER_PROVIDED)(
    'an owner-provided name (%s) in a list is refused, naming the line, before any file is created',
    (name) => {
      const fx = fixture();
      const list = join(fx.dir, 'owner.list');
      writeFileSync(list, `postgres.txt\n${name}\n`);
      const dir = join(fx.dir, 'owner-list');
      const r = run('gen-secrets.sh', fx, {
        GELDAR_SECRETS_DIR: posix(dir),
        GELDAR_SECRETS_LIST: posix(list),
        GELDAR_SERVICE_UID: '1000',
      });
      expect(r.code).not.toBe(0);
      expect(r.out).toContain(`owner-provided, never generated here: ${name} in`);
      expect(r.out).toContain('line 2');
      expect(existsSync(dir)).toBe(false);
    },
  );

  it('a list with a CRLF line is refused, naming the line, before anything is created', () => {
    const fx = fixture();
    const list = join(fx.dir, 'crlf.list');
    writeFileSync(list, 'postgres.txt\r\nrcon.txt\r\n');
    const dir = join(fx.dir, 'crlf-list');
    const r = run('gen-secrets.sh', fx, {
      GELDAR_SECRETS_DIR: posix(dir),
      GELDAR_SECRETS_LIST: posix(list),
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('CRLF line ending');
    expect(r.out).toContain('line 1');
    expect(existsSync(dir)).toBe(false);
  });

  it('canary: a value already on disk never appears in the output, nor any new 64-hex value', () => {
    const fx = fixture();
    const dir = join(fx.dir, 'canary');
    mkdirSync(dir);
    const canary = 'CANARY-g201-do-not-print-7c1e';
    writeFileSync(join(dir, 'rcon.txt'), `${canary}\n`);
    setOwner(fx, 'rcon.txt', '1001');
    const extra = { GELDAR_SECRETS_DIR: posix(dir), GELDAR_SERVICE_UID: '1000' };
    const r = run('gen-secrets.sh', fx, extra);
    expect(r.out).not.toContain(canary);
    expect(r.out).not.toMatch(/[0-9a-f]{64}/);
    expect(readFileSync(join(dir, 'rcon.txt'), 'utf8')).toBe(`${canary}\n`);
  });

  it('GELDAR_SECRETS_LIST names the files for one environment; a bad name stops before anything is created', () => {
    const fx = fixture();
    const list = join(fx.dir, 'env-names.list');
    writeFileSync(list, '# one environment\nonly-one.txt\n\n');
    const dir = join(fx.dir, 'env-list');
    const extra = {
      GELDAR_SECRETS_DIR: posix(dir),
      GELDAR_SECRETS_LIST: posix(list),
      GELDAR_SERVICE_UID: '1000',
    };
    expect(run('gen-secrets.sh', fx, extra).code).toBe(0);
    expect(existsSync(join(dir, 'only-one.txt'))).toBe(true);
    expect(existsSync(join(dir, 'rcon.txt'))).toBe(false);

    const bad = join(fx.dir, 'bad-names.list');
    writeFileSync(bad, 'ok.txt\n../escape.txt\n');
    const dir2 = join(fx.dir, 'bad-list');
    const r = run('gen-secrets.sh', fx, {
      GELDAR_SECRETS_DIR: posix(dir2),
      GELDAR_SECRETS_LIST: posix(bad),
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('bad secret name');
    expect(existsSync(dir2)).toBe(false);
  });
});
