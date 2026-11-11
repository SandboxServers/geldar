/**
 * The shard secret files (`./geldar.ps1 shard secrets`, spec 6.7) and the early NATS check of `shard up colo`. The behaviour
 * part runs the real generator under pwsh in a temporary copy of geldar.ps1, shards/ and compose/*.yml, so the repo's own
 * compose/secrets/ is never written. It skips when pwsh is not on PATH. Mode checks run off Windows only (CI on Linux).
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = readFileSync(join(ROOT, 'geldar.ps1'), 'utf8');
/** The three secrets Initialize-ShardSecrets writes, in the order it writes them. */
const SECRETS = ['postgres.txt', 'rcon.txt', 'velocity-forwarding.txt'];
/** The files `shard nats-auth colo` writes that `shard up colo` needs (Assert-ColoNatsSecrets). */
const NATS_SECRETS = [
  'nats-body.txt',
  'nats-mind.txt',
  'nats-paper.txt',
  'nats-velocity.txt',
  'nats-eventsink.txt',
  'nats-mcp.txt',
  'nats-auth.conf',
];

const hasPwsh =
  spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' }).status === 0;

/** The text of one top-level PowerShell function, from its keyword to the next top-level function. */
function functionBody(name: string): string {
  const start = SCRIPT.indexOf(`function ${name}`);
  if (start < 0) return '';
  const next = SCRIPT.indexOf('\nfunction ', start + 1);
  return SCRIPT.slice(start, next < 0 ? undefined : next);
}

/** A temp copy of the generator inputs: geldar.ps1, shards/ and the compose/*.yml files. The repo itself is not touched. */
function copyGenerator(): string {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-shard-secrets-'));
  copyFileSync(join(ROOT, 'geldar.ps1'), join(dir, 'geldar.ps1'));
  cpSync(join(ROOT, 'shards'), join(dir, 'shards'), { recursive: true });
  mkdirSync(join(dir, 'compose'));
  for (const f of readdirSync(join(ROOT, 'compose'))) {
    if (f.endsWith('.yml')) copyFileSync(join(ROOT, 'compose', f), join(dir, 'compose', f));
  }
  return dir;
}

/** `./geldar.ps1 shard <args>` run from the temp copy. stderr names paths and errors only: no secret is ever printed. */
function shard(dir: string, ...args: string[]) {
  const run = spawnSync(
    'pwsh',
    ['-NoProfile', '-File', join(dir, 'geldar.ps1'), 'shard', ...args],
    {
      encoding: 'utf8',
      cwd: dir,
    },
  );
  return { status: run.status, stderr: (run.stderr ?? '').trim().slice(0, 1500) };
}

/**
 * `./geldar.ps1 shard <args>` from the temp copy, read through a try/catch that prints the exception's own message on
 * stdout. The error record on stderr is formatted for the console: it wraps at the width, adds a `|` gutter and, on
 * Linux, colour codes that split words (`decision` and `0082` end up apart). The message itself has none of that.
 */
function refusal(dir: string, ...args: string[]) {
  const quoted = ['shard', ...args].map((arg) => `'${arg}'`).join(' ');
  const script = join(dir, 'geldar.ps1');
  const command = `try { & '${script}' ${quoted} } catch { Write-Output ('REFUSAL: ' + $_.Exception.Message); exit 1 }`;
  const run = spawnSync('pwsh', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    cwd: dir,
  });
  return { status: run.status, message: (run.stdout ?? '').trim().slice(0, 1500) };
}

/**
 * Removes whitespace and the `|` gutter, so a comparison is on the words, not on how a message was wrapped.
 * Used on the exception message, which the test reads without a console format.
 */
const squash = (text: string) => text.replace(/[\s|]/g, '');

/** The permission bits of a path, as the octal the tests compare with. */
const mode = (path: string) => statSync(path).mode & 0o777;

describe('geldar.ps1 shard secrets: static wiring', () => {
  it('defines the owner-only helpers and the colo NATS check', () => {
    for (const name of [
      'Set-OwnerOnlyAcl',
      'Assert-OwnerOnlyMode',
      'Initialize-ShardSecrets',
      'Assert-ColoNatsSecrets',
    ]) {
      expect(functionBody(name), name).not.toBe('');
    }
  });

  it('makes the off-Windows branch of Set-OwnerOnlyAcl delegate to Restrict-OwnerOnly, so mode 600 has one implementation', () => {
    expect(functionBody('Set-OwnerOnlyAcl')).toMatch(
      /if \(-not \$IsWindows\) \{\s*Restrict-OwnerOnly \$Path/,
    );
    expect(functionBody('Restrict-OwnerOnly')).toMatch(/& chmod 600 \$Path/);
  });

  it('runs the colo NATS check first in the up action, before the plugin check', () => {
    expect(SCRIPT).toMatch(
      /'up' \{\s*if \(\$shard -eq 'colo'\) \{ Assert-ColoNatsSecrets \}\s*Assert-PluginJar \$shard/,
    );
  });

  it('checks every nats-* file secret that compose/colo.yml declares', () => {
    // A new NATS secret in colo.yml must reach the early check too, or `up colo` fails in docker again.
    const colo = readFileSync(join(ROOT, 'compose', 'colo.yml'), 'utf8');
    const declared = [...colo.matchAll(/file: \.\/secrets\/(nats-[\w.-]+)/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    const body = functionBody('Assert-ColoNatsSecrets');
    expect(declared.filter((name) => !body.includes(`'${name}'`))).toEqual([]);
  });

  it('checks every NATS file that colo.yml and nats-auth.yml declare, and the server config', () => {
    // The overlay declares its own password files, so the check reads both files, not colo.yml alone.
    const text = ['colo.yml', 'nats-auth.yml']
      .map((f) => readFileSync(join(ROOT, 'compose', f), 'utf8'))
      .join('\n');
    const declared = [...text.matchAll(/file: \.\/secrets\/(nats-[\w.-]+)/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    const body = functionBody('Assert-ColoNatsSecrets');
    expect(declared.filter((name) => !body.includes(`'${name}'`))).toEqual([]);
    expect(body).toContain("'nats-auth.conf'");
    expect(NATS_SECRETS.filter((name) => !body.includes(`'${name}'`))).toEqual([]);
  });

  it('merges nats-auth.yml into shard up colo, and into no other shard or action', () => {
    expect(functionBody('Invoke-Shard')).toMatch(
      /if \(\$shard -eq 'colo' -and \$action -eq 'up'\) \{ \$files \+= @\('-f', \(Join-Path \$Root 'compose\/nats-auth\.yml'\)\) \}/,
    );
  });
});

describe.skipIf(!hasPwsh)('geldar.ps1 shard secrets: the files it writes', () => {
  let dir = '';
  let run: { status: number | null; stderr: string } | undefined;

  beforeAll(() => {
    dir = copyGenerator();
    run = shard(dir, 'secrets', 'colo');
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('runs the generator without error and writes the three secret files', () => {
    expect(run?.status, `exit ${run?.status}: ${run?.stderr}`).toBe(0);
    const secrets = join(dir, 'compose', 'secrets');
    expect(SECRETS.map((f) => existsSync(join(secrets, f)))).toEqual(SECRETS.map(() => true));
  });

  it('writes each secret as 32 URL-safe characters with no newline', () => {
    const secrets = join(dir, 'compose', 'secrets');
    // A boolean, not a toMatch: a failing matcher would print the secret.
    const ok = SECRETS.map((f) =>
      /^[A-Za-z0-9_-]{32}$/.test(readFileSync(join(secrets, f), 'utf8')),
    );
    expect(ok).toEqual(SECRETS.map(() => true));
  });

  it.skipIf(process.platform === 'win32')(
    'makes the secrets directory 0700 and each secret file 0600',
    () => {
      const secrets = join(dir, 'compose', 'secrets');
      expect(mode(secrets)).toBe(0o700);
      expect(SECRETS.map((f) => mode(join(secrets, f)))).toEqual(SECRETS.map(() => 0o600));
    },
  );

  it('keeps existing secrets on a second run: no value changes and the modes stay owner-only', () => {
    const secrets = join(dir, 'compose', 'secrets');
    const before = SECRETS.map((f) => readFileSync(join(secrets, f), 'utf8'));
    const again = shard(dir, 'secrets', 'colo');
    expect(again.status, `exit ${again.status}: ${again.stderr}`).toBe(0);
    const after = SECRETS.map((f) => readFileSync(join(secrets, f), 'utf8'));
    expect(after.map((v, i) => v === before[i])).toEqual(SECRETS.map(() => true));
    if (process.platform !== 'win32') {
      expect(SECRETS.map((f) => mode(join(secrets, f)))).toEqual(SECRETS.map(() => 0o600));
    }
  });
});

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'geldar.ps1 shard secrets: a world-readable secret left by an older run',
  () => {
    it('is tightened to 0600 on the next run, and its value is kept', () => {
      const dir = copyGenerator();
      try {
        const secrets = join(dir, 'compose', 'secrets');
        mkdirSync(secrets, { recursive: true });
        const old = 'A'.repeat(32);
        writeFileSync(join(secrets, 'rcon.txt'), old);
        // The mode a umask-022 create leaves behind, the case this change closes.
        chmodSync(join(secrets, 'rcon.txt'), 0o644);
        const run = shard(dir, 'secrets', 'colo');
        expect(run.status, `exit ${run.status}: ${run.stderr}`).toBe(0);
        expect(mode(join(secrets, 'rcon.txt'))).toBe(0o600);
        expect(readFileSync(join(secrets, 'rcon.txt'), 'utf8')).toBe(old);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);

describe.skipIf(!hasPwsh)('geldar.ps1 shard up colo: the NATS secrets are checked first', () => {
  it('fails before docker, names nats-body.txt and the command to run, and writes no secret', () => {
    const dir = copyGenerator();
    try {
      const run = shard(dir, 'up', 'colo');
      expect(run.status).not.toBe(0);
      expect(squash(run.stderr)).toContain(squash('compose/secrets/nats-body.txt'));
      expect(squash(run.stderr)).toContain(squash('./geldar.ps1 shard nats-auth colo'));
      expect(existsSync(join(dir, 'compose', 'secrets', 'postgres.txt'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails the same way for an empty nats-body.txt', () => {
    const dir = copyGenerator();
    try {
      mkdirSync(join(dir, 'compose', 'secrets'), { recursive: true });
      writeFileSync(join(dir, 'compose', 'secrets', 'nats-body.txt'), '');
      const run = shard(dir, 'up', 'colo');
      expect(run.status).not.toBe(0);
      expect(squash(run.stderr)).toContain(squash('compose/secrets/nats-body.txt'));
      expect(squash(run.stderr)).toContain(squash('is missing or empty'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('gets past the NATS check once every NATS secret exists, so it fails later for another reason', () => {
    const dir = copyGenerator();
    try {
      mkdirSync(join(dir, 'compose', 'secrets'), { recursive: true });
      for (const name of NATS_SECRETS) {
        writeFileSync(join(dir, 'compose', 'secrets', name), 'x'.repeat(32));
      }
      const run = shard(dir, 'up', 'colo');
      // The temp copy has no plugin jar, so the run stops at Assert-PluginJar, not at the NATS check.
      expect(run.status).not.toBe(0);
      expect(squash(run.stderr)).not.toContain(squash('shard nats-auth colo'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasPwsh)('geldar.ps1 shard up colo: --rcon-host is refused', () => {
  it('refuses --rcon-host before anything starts, names the flag and the decision, and writes no secret', () => {
    const dir = copyGenerator();
    try {
      const run = refusal(dir, 'up', 'colo', '--rcon-host');
      expect(run.status).not.toBe(0);
      expect(squash(run.message)).toContain(squash('shard up colo: --rcon-host is refused'));
      expect(squash(run.message)).toContain(squash('decision 0082'));
      expect(existsSync(join(dir, 'compose', 'secrets', 'postgres.txt'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not refuse --rcon-host for phase0: the refusal is for the colo shard only', () => {
    const dir = copyGenerator();
    try {
      const run = shard(dir, 'up', 'phase0', '--rcon-host');
      expect(squash(run.stderr)).not.toContain(squash('--rcon-host is refused'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
