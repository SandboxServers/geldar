import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHOWN_SHIM,
  calls,
  canSymlink,
  fixture,
  GENERATED,
  mutates,
  NATS_BIND,
  posix,
  REAL,
  run,
  SECRET_FILES,
  SECRETS,
  secretValue,
  setMode,
  setOwner,
  writeConfig,
  writeShim,
} from './colo-deploy-fixture';

describe('secret files come from the merged config (decision 0084)', () => {
  it.each(SECRETS)(
    'refuses when the file of compose secret %s is missing, and names it',
    (name, file) => {
      const fx = fixture();
      rmSync(join(fx.secrets, file));
      const r = run('colo-up.sh', fx, REAL);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain(`secret file missing: ${file} (compose secret: ${name},`);
      expect(mutates(calls(fx))).toBe(false);
    },
  );

  it('refuses an empty secret file, and names it', () => {
    const fx = fixture();
    writeFileSync(join(fx.secrets, 'rcon.txt'), '');
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secret file empty: rcon.txt (compose secret: rcon)');
    expect(mutates(calls(fx))).toBe(false);
  });

  it.skipIf(!canSymlink)(
    'refuses a symlink that resolves outside the secrets directories, and never reads its target',
    () => {
      const fx = fixture();
      const outside = join(fx.dir, 'outside.txt');
      writeFileSync(outside, 'OUTSIDE-test-value\n');
      rmSync(join(fx.secrets, 'rcon.txt'));
      symlinkSync(outside, join(fx.secrets, 'rcon.txt'));
      const r = run('colo-up.sh', fx, REAL);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('secret file rcon.txt (compose secret: rcon) resolves outside');
      expect(r.out).not.toContain('OUTSIDE-test-value');
      expect(mutates(calls(fx))).toBe(false);
    },
  );

  // The same containment check without a symlink, so it also runs where symlinks are refused.
  it('refuses a merged-config path that lies outside the secrets directory, and runs no pull or up', () => {
    const fx = fixture();
    const elsewhere = join(fx.dir, 'elsewhere');
    mkdirSync(elsewhere);
    const outsideFile = join(elsewhere, 'postgres.txt');
    writeFileSync(outsideFile, 'ELSEWHERE-test-value\n');
    const text = readFileSync(fx.config, 'utf8');
    writeFileSync(
      fx.config,
      text.split(posix(join(fx.secrets, 'postgres.txt'))).join(posix(outsideFile)),
    );
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secret file postgres.txt (compose secret: postgres) resolves outside');
    expect(r.out).not.toContain('ELSEWHERE-test-value');
    expect(mutates(calls(fx))).toBe(false);
  });

  it('never prints a secret file contents, even when the file is refused', () => {
    const fx = fixture();
    writeFileSync(join(fx.secrets, 'postgres.txt'), 'SENTINEL-7f3a9c\n');
    setMode(fx, 'postgres.txt', '644');
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secret file postgres.txt has mode 644');
    expect(r.out).not.toContain('SENTINEL-7f3a9c');
  });

  it('passes when every file the merged config declares is present and owner-only', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx);
    expect(r.code).toBe(0);
    expect(r.out).toContain('each file the merged config declares is present');
  });

  it('requires a secret added to the merged config, with no change to the script', () => {
    const fx = fixture();
    writeConfig(fx.config, fx.secrets, [...SECRETS, ['new-thing', 'new-thing.txt']]);
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secret file missing: new-thing.txt (compose secret: new-thing,');
    expect(mutates(calls(fx))).toBe(false);
    writeFileSync(join(fx.secrets, 'new-thing.txt'), 'new-thing-test-value\n');
    expect(run('colo-up.sh', fx, REAL).code).toBe(0);
  });

  it('refuses a merged config that declares no secret files', () => {
    const fx = fixture();
    writeConfig(fx.config, fx.secrets, []);
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('declares no secret files');
  });

  it('names the trusted-machine step for a missing NATS file', () => {
    const fx = fixture();
    rmSync(join(fx.secrets, 'nats-mind.txt'));
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secret file missing: nats-mind.txt');
    expect(r.out).toContain('./geldar.ps1 shard nats-auth colo');
  });

  it('refuses when the nats-auth overlay is merged and nats-auth.conf is missing, then passes once it exists', () => {
    const fx = fixture();
    const conf = join(fx.secrets, 'nats-auth.conf');
    writeConfig(fx.config, fx.secrets, SECRETS, '25567', NATS_BIND(posix(conf)));
    const missing = run('colo-up.sh', fx, REAL);
    expect(missing.code).not.toBe(0);
    expect(missing.out).toContain('secret file missing: nats-auth.conf');
    expect(missing.out).toContain('./geldar.ps1 shard nats-auth colo');
    expect(mutates(calls(fx))).toBe(false);
    writeFileSync(conf, 'nats-auth-test-value\n');
    expect(run('colo-up.sh', fx, REAL).code).toBe(0);
  });
});

describe('service uid: root is refused and every secret is owned by GELDAR_SERVICE_UID', () => {
  it('refuses to run the deploy as uid 0, and runs no pull or up', () => {
    const fx = fixture();
    const r = run('colo-up.sh', fx, { ...REAL, FAKE_RUNNER_UID: '0' });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('refusing to run the deploy as root');
    expect(mutates(calls(fx))).toBe(false);
  });

  it.each([
    ['0', 'must not run as root'],
    ['abc', 'must be a number'],
  ])('refuses GELDAR_SERVICE_UID=%s', (uid, msg) => {
    const r = run('colo-up.sh', fixture(), { ...REAL, GELDAR_SERVICE_UID: uid });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(msg);
  });

  it('refuses a secret file owned by another uid, names it and the expected uid, and runs no pull or up', () => {
    const fx = fixture();
    setOwner(fx, 'rcon.txt', '1001');
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('rcon.txt is owned by uid 1001; expected uid 1000');
    expect(r.out).not.toContain(secretValue('rcon.txt'));
    expect(mutates(calls(fx))).toBe(false);
  });

  it('refuses a secrets directory owned by another uid', () => {
    const fx = fixture();
    setOwner(fx, 'secrets', '1001');
    const r = run('colo-up.sh', fx, REAL);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secrets directory');
    expect(r.out).toContain('expected uid 1000');
  });

  it('passes when the directory and every secret file are owned by GELDAR_SERVICE_UID=1001', () => {
    const fx = fixture();
    setOwner(fx, 'secrets', '1001');
    for (const f of SECRET_FILES) setOwner(fx, f, '1001');
    expect(run('colo-up.sh', fx, { ...REAL, GELDAR_SERVICE_UID: '1001' }).code).toBe(0);
  });

  it('dry run ends with "dry-run complete", not "deployed"', () => {
    const r = run('colo-up.sh', fixture());
    expect(r.code).toBe(0);
    expect(r.out.trimEnd().split('\n').at(-1)).toContain('dry-run complete');
    expect(r.out).not.toContain('deployed:');
  });

  it('gen-secrets as root chowns the directory and each generated file to GELDAR_SERVICE_UID', () => {
    const fx = fixture();
    writeShim(join(fx.dir, 'bin'), 'chown', CHOWN_SHIM);
    const gen = join(fx.dir, 'gen');
    const log = join(fx.dir, 'chown.log');
    const r = run('gen-secrets.sh', fx, {
      FAKE_RUNNER_UID: '0',
      GELDAR_SERVICE_UID: '1001',
      GELDAR_SECRETS_DIR: posix(gen),
      FAKE_CHOWN_LOG: posix(log),
    });
    expect(r.code).toBe(0);
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines).toContain(`1001 ${posix(gen)}`);
    for (const f of GENERATED) expect(lines).toContain(`1001 ${posix(join(gen, f))}`);
  });

  it('gen-secrets as another user refuses unless that uid is GELDAR_SERVICE_UID, and creates nothing', () => {
    const fx = fixture();
    const gen = join(fx.dir, 'gen-user');
    const r = run('gen-secrets.sh', fx, {
      GELDAR_SERVICE_UID: '1001',
      GELDAR_SECRETS_DIR: posix(gen),
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('uid 1000');
    expect(r.out).toContain('GELDAR_SERVICE_UID');
    expect(existsSync(gen)).toBe(false);
  });
});
