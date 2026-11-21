// Tests for deploy/genesis/verify-neoforge-artifacts.sh (GE-02e). The script runs under `sh`, needs unzip, and checks the
// geldar-neoforge jar and the ledger jar against neoforge-artifacts.sha256. The digests come from node:crypto and the fixture jars
// are written here by a small stored-zip writer, so the test does not share code with what it tests.
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../genesis/verify-neoforge-artifacts.sh', import.meta.url));

// On Windows the sh is Git for Windows' (as in verify-plugin-jars.test.ts); GELDAR_TEST_SH overrides it.
function findSh(): string {
  if (process.env.GELDAR_TEST_SH) return process.env.GELDAR_TEST_SH;
  if (process.platform !== 'win32') return 'sh';
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
    (p): p is string => Boolean(p),
  );
  return (
    roots.map((root) => join(root, 'Git', 'usr', 'bin', 'sh.exe')).find((p) => existsSync(p)) ??
    'sh'
  );
}
const SH = findSh();
const GELDAR = 'geldar-neoforge.jar';
const LEDGER = 'geldar-neoforge-ledger-0.1.0.jar';
const SUMS = 'neoforge-artifacts.sha256';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const NESTED = [
  'META-INF/jarjar/geldar-plugin.ledger-core-0.1.0.jar',
  'META-INF/jarjar/opentelemetry-api-1.67.0.jar',
  'META-INF/jarjar/opentelemetry-common-1.67.0.jar',
  'META-INF/jarjar/opentelemetry-context-1.67.0.jar',
];

let root: string;
let dir: string;

const digest = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

// A zip of stored (uncompressed) entries, with the CRC and offsets unzip checks; no compression library or zip tool is needed.
function zipOf(entries: Array<[string, string]>): Buffer {
  const parts: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name);
    const d = Buffer.from(text);
    const crc = crc32(d);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(d.length, 18);
    local.writeUInt32LE(d.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(d.length, 20);
    central.writeUInt32LE(d.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    parts.push(local, n, d);
    centrals.push(central, n);
    offset += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

// The mod descriptor: the mod's own modId comes first, as in the real neoforge.mods.toml; the dependency block follows.
function modsToml(modId: string): string {
  return [
    'modLoader = "javafml"',
    '',
    '[[mods]]',
    `modId = "${modId}"`,
    'version = "0.1.0"',
    '',
    `[[dependencies.${modId}]]`,
    'modId = "neoforge"',
    '',
  ].join('\n');
}

function geldarJar(modId = 'geldar_neoforge'): Buffer {
  return zipOf([
    ['META-INF/neoforge.mods.toml', modsToml(modId)],
    ['dev/geldar/neoforge/GeldarMod.class', 'class bytes'],
  ]);
}

function ledgerJar(nested: string[] = NESTED, modId = 'ledger'): Buffer {
  return zipOf([
    ['META-INF/neoforge.mods.toml', modsToml(modId)],
    ['dev/geldar/ledger/LedgerMod.class', 'class bytes'],
    ...nested.map((name): [string, string] => [name, 'nested jar bytes']),
  ]);
}

// Writes both jars and a neoforge-artifacts.sha256 whose digests match them, as the workflow's collect step does.
function publish(geldar = geldarJar(), ledger = ledgerJar()): void {
  writeFileSync(join(dir, GELDAR), geldar);
  writeFileSync(join(dir, LEDGER), ledger);
  writeFileSync(
    join(dir, SUMS),
    [
      `# NeoForge artifacts, built from commit ${COMMIT}.`,
      `${digest(geldar)}  ${GELDAR}`,
      `${digest(ledger)}  ${LEDGER}`,
      '',
    ].join('\n'),
  );
}

// On Windows the PATH is the sh's own usr/bin only (it holds unzip, sha256sum, sed and grep): with the full Windows PATH every
// MSYS fork is slow enough to time out.
function runScript(args: string[]): SpawnSyncReturns<string> {
  const path = process.platform === 'win32' ? dirname(SH) : (process.env.PATH ?? '');
  return spawnSync(SH, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: path },
  });
}

function verify(target: string): { status: number | null; stdout: string; stderr: string } {
  const result = runScript([target]);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Each run starts a Git for Windows sh and forks several tools; on Windows that takes seconds, so the default 5 s timeout is short.
const itRuns = (name: string, fn: () => void): void => it(name, fn, 60_000);

// Creating a symlink needs a privilege on some Windows hosts; the symlink case is skipped where the probe cannot create one.
function canSymlink(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'neoforge-symlink-probe-'));
  try {
    symlinkSync(join(probe, 'missing-target'), join(probe, 'link.jar'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}
const SYMLINKS = canSymlink();
const itSymlink = (name: string, fn: () => void): void => {
  if (SYMLINKS) itRuns(name, fn);
  else it.skip(name, fn);
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'neoforge-artifacts-verify-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  dir = mkdtempSync(join(root, 'case-'));
});

describe('verify-neoforge-artifacts.sh', () => {
  itRuns(
    'passes when both jars match their digests, their modIds and the ledger jarjar set',
    () => {
      publish();
      const result = verify(dir);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`ok: ${GELDAR}`);
      expect(result.stdout).toContain(`ok: ${LEDGER}`);
    },
  );

  itRuns('fails when a jar was tampered with after publish', () => {
    publish();
    writeFileSync(join(dir, GELDAR), Buffer.concat([geldarJar(), Buffer.from('!')]));
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(`digest mismatch: ${GELDAR}`);
  });

  itRuns('fails when a listed jar is missing', () => {
    publish();
    unlinkSync(join(dir, LEDGER));
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(`missing jar: ${LEDGER}`);
  });

  itRuns('fails when a jar that the sha256 file does not list sits in the directory', () => {
    publish();
    writeFileSync(join(dir, 'geldar-neoforge-extra.jar'), geldarJar());
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('unexpected file in');
    expect(result.stderr).toContain('geldar-neoforge-extra.jar');
  });

  itRuns('fails when the geldar jar carries the ledger modId', () => {
    publish(geldarJar('ledger'));
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(
      `wrong modId in ${GELDAR}: expected geldar_neoforge, got ledger`,
    );
  });

  itRuns('fails when the ledger jar carries another modId', () => {
    publish(geldarJar(), ledgerJar(NESTED, 'geldar_neoforge'));
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(
      `wrong modId in ${LEDGER}: expected ledger, got geldar_neoforge`,
    );
  });

  itRuns('fails when the ledger jar is missing a jarjar entry', () => {
    publish(geldarJar(), ledgerJar(NESTED.slice(0, 3)));
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(`${LEDGER} nests 3 jars under META-INF/jarjar/, expected 4`);
  });

  itRuns('fails when the ledger jar nests a fifth jar', () => {
    publish(geldarJar(), ledgerJar([...NESTED, 'META-INF/jarjar/io.nats-jnats-2.25.0.jar']));
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(`${LEDGER} nests 5 jars under META-INF/jarjar/, expected 4`);
  });

  itRuns('fails when the ledger jar has the four nested jars but not opentelemetry-context', () => {
    publish(
      geldarJar(),
      ledgerJar([NESTED[0], NESTED[1], NESTED[2], 'META-INF/jarjar/opentelemetry-api-1.67.0.jar']),
    );
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(`${LEDGER} does not nest opentelemetry-context`);
  });

  itRuns('fails when a jar is not a zip', () => {
    const notZip = Buffer.from('not a zip');
    publish(notZip, ledgerJar());
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(`not a zip: ${GELDAR}`);
  });

  itRuns('exits 2 when a sha256 line names a path outside the directory', () => {
    publish();
    writeFileSync(
      join(dir, SUMS),
      `${digest(geldarJar())}  ../${GELDAR}\n${digest(ledgerJar())}  ${LEDGER}\n`,
    );
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('unsafe jar name');
  });

  itRuns('exits 2 when a sha256 line names a file with a space in it', () => {
    publish();
    writeFileSync(
      join(dir, SUMS),
      `${digest(geldarJar())}  geldar neoforge.jar\n${digest(ledgerJar())}  ${LEDGER}\n`,
    );
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('unsafe jar name');
  });

  itRuns('exits 2 when the sha256 file does not list both jars', () => {
    publish();
    writeFileSync(join(dir, SUMS), `${digest(geldarJar())}  ${GELDAR}\n`);
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('not listed');
  });

  itRuns('exits 2 on an upper-case digest, which is not the sha256sum format', () => {
    publish();
    writeFileSync(
      join(dir, SUMS),
      `${digest(geldarJar()).toUpperCase()}  ${GELDAR}\n${digest(ledgerJar())}  ${LEDGER}\n`,
    );
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(2);
  });

  itRuns('fails when the directory holds an upper-case JAR', () => {
    publish();
    writeFileSync(join(dir, 'evil.JAR'), 'not a jar');
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('unexpected file in');
    expect(result.stderr).toContain('evil.JAR');
  });

  itRuns('fails when the directory holds a dotfile jar', () => {
    publish();
    writeFileSync(join(dir, '.evil.jar'), 'not a jar');
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('unexpected file in');
    expect(result.stderr).toContain('.evil.jar');
  });

  itRuns(
    'fails when a file named like both jars with a space between them sits in the directory',
    () => {
      publish();
      writeFileSync(join(dir, `${GELDAR} ${LEDGER}`), 'not a jar');
      const result = verify(dir);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain('unexpected file in');
    },
  );

  itRuns('fails when the directory holds a file whose name starts with two dots', () => {
    publish();
    writeFileSync(join(dir, '..x.jar'), 'not a jar');
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('unexpected file in');
    expect(result.stderr).toContain('..x.jar');
  });

  itSymlink('fails when the directory holds a dangling symlink named evil.jar', () => {
    publish();
    symlinkSync(join(dir, 'missing-target'), join(dir, 'evil.jar'));
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('unexpected file in');
    expect(result.stderr).toContain('evil.jar');
  });

  itRuns('exits 2 when a sha256 digest is shorter than 64 hex digits', () => {
    publish();
    writeFileSync(
      join(dir, SUMS),
      `${digest(geldarJar()).slice(0, 63)}  ${GELDAR}\n${digest(ledgerJar())}  ${LEDGER}\n`,
    );
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('malformed line');
  });

  itRuns('exits 2 when the sha256 file lists one jar twice', () => {
    publish();
    writeFileSync(
      join(dir, SUMS),
      `${digest(geldarJar())}  ${GELDAR}\n${digest(geldarJar())}  ${GELDAR}\n${digest(ledgerJar())}  ${LEDGER}\n`,
    );
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(`duplicate jar name in`);
  });

  itRuns('exits 2 when the sha256 file lists a name that is not one of the build jars', () => {
    publish();
    writeFileSync(
      join(dir, SUMS),
      `${digest(geldarJar())}  ${GELDAR}\n${digest(ledgerJar())}  ${LEDGER}\n${digest('x')}  other.jar\n`,
    );
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('unexpected jar name in');
    expect(result.stderr).toContain('other.jar');
  });

  itRuns('fails with its own message when a jar has no META-INF/neoforge.mods.toml', () => {
    publish(zipOf([['dev/geldar/neoforge/GeldarMod.class', 'class bytes']]), ledgerJar());
    const result = verify(dir);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(`no META-INF/neoforge.mods.toml in ${GELDAR}`);
  });

  itRuns('exits 2 without exactly one directory argument', () => {
    const result = runScript([]);
    expect(result.status, result.stderr).toBe(2);
  });
});
