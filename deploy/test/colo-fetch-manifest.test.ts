// Tests for the "download the release manifest" step of .github/workflows/colo-deploy.yml. The step's run block is
// extracted from the workflow and run under bash with a fake `curl` first on PATH. The fake answers the four GitHub API
// URLs from fixture files, and the archive URL from a zip, failing the first FAKE_BLOB_FAILS times. Nothing goes to the network.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const WORKFLOW = fileURLToPath(new URL('../../.github/workflows/colo-deploy.yml', import.meta.url));
const MANIFEST = `# Release manifest.\nGELDAR_BODY_IMAGE=ghcr.io/sandboxservers/geldar-body@sha256:${'a'.repeat(64)}\n`;
const NOTE_MANIFEST = MANIFEST.replace('# Release', '# Annotation release');

function runBlock(): string {
  const lines = readFileSync(WORKFLOW, 'utf8').split('\n');
  const step = lines.findIndex((l) => l.includes('name: download the release manifest'));
  const runAt = lines.findIndex((l, i) => i > step && /^\s+run: \|$/.test(l));
  const indent = (lines[runAt] ?? '').search(/\S/);
  const body: string[] = [];
  for (const l of lines.slice(runAt + 1)) {
    if (l.trim() !== '' && l.search(/\S/) <= indent) break;
    body.push(l.slice(indent + 2));
  }
  return body.join('\n');
}

// A zip with one stored entry; no compression library or zip tool is needed.
function storedZip(name: string, data: string): Buffer {
  const n = Buffer.from(name);
  const d = Buffer.from(data);
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
  const entry = Buffer.concat([local, n, d]);
  const cd = Buffer.concat([central, n]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(entry.length, 16);
  return Buffer.concat([entry, cd, end]);
}

const FAKE_CURL = `#!/bin/bash
echo "curl $*" >>"$FAKE_LOG"
url="\${@: -1}"
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--output" ]; then out="$a"; fi
  prev="$a"
done
case "$url" in
  *archive*)
    n=$(cat "$FAKE_DIR/blob-count" 2>/dev/null || echo 0)
    echo $((n + 1)) >"$FAKE_DIR/blob-count"
    if [ "$n" -lt "\${FAKE_BLOB_FAILS:-0}" ]; then echo "curl: (28) timed out" >&2; exit 28; fi
    cp "$FAKE_DIR/artifact.zip" "$out" ;;
  */artifacts*) cat "$FAKE_DIR/artifacts.json" ;;
  */jobs*) cat "$FAKE_DIR/jobs.json" ;;
  */annotations*) cat "$FAKE_DIR/annotations.json" ;;
  *) echo "fake curl: unexpected url $url" >&2; exit 22 ;;
esac
`;

let dir: string;
let fakeBin: string;
let block: string;

function setup(opts: { digest?: string | null; zipOf?: string }): void {
  const zip = storedZip('release.env', opts.zipOf ?? MANIFEST);
  writeFileSync(join(dir, 'artifact.zip'), zip);
  const digest =
    opts.digest === undefined
      ? `sha256:${createHash('sha256').update(zip).digest('hex')}`
      : opts.digest;
  const artifact: Record<string, unknown> = {
    name: 'release.env',
    expired: false,
    archive_download_url: 'https://api.example.test/repos/o/r/actions/artifacts/9/zip/archive',
  };
  if (digest !== null) artifact.digest = digest;
  writeFileSync(join(dir, 'artifacts.json'), JSON.stringify({ artifacts: [artifact] }));
  writeFileSync(
    join(dir, 'jobs.json'),
    JSON.stringify({ jobs: [{ name: 'release manifest', id: 77 }] }),
  );
  writeFileSync(
    join(dir, 'annotations.json'),
    JSON.stringify([{ title: 'release.env', message: NOTE_MANIFEST }]),
  );
}

function run(blobFails: number): { status: number | null; out: string; manifest: string | null } {
  const outFile = join(dir, 'out', 'release.env');
  // A shell function named curl wins over any curl on PATH (Windows PATH lookup differs), so the fake is always used.
  const r = spawnSync(
    'bash',
    ['-c', `curl() { bash "${join(fakeBin, 'curl').replaceAll('\\', '/')}" "$@"; }\n${block}`],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        // Windows keeps the variable as `Path`; set both spellings so the fake curl comes first either way.
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`,
        Path: `${fakeBin}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`,
        GH_TOKEN: 'placeholder-token',
        REPO: 'o/r',
        RUN_ID: '123',
        OUT: outFile,
        GELDAR_API_URL: 'https://api.example.test',
        FAKE_DIR: dir,
        FAKE_LOG: join(dir, 'curl.log'),
        FAKE_BLOB_FAILS: String(blobFails),
      },
    },
  );
  let manifest: string | null = null;
  try {
    // The step strips CR itself; this normalisation is a second guard for a Windows jq.exe (local runs).
    manifest = readFileSync(outFile, 'utf8').replaceAll('\r\n', '\n');
  } catch {
    manifest = null;
  }
  return { status: r.status, out: `${r.stdout}${r.stderr}`, manifest };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'colo-fetch-'));
  fakeBin = join(dir, 'bin');
  mkdirSync(fakeBin);
  writeFileSync(join(fakeBin, 'curl'), FAKE_CURL, { mode: 0o755 });
  chmodSync(join(fakeBin, 'curl'), 0o755);
  block = runBlock();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const f of ['blob-count', 'curl.log']) rmSync(join(dir, f), { force: true });
  rmSync(join(dir, 'out'), { recursive: true, force: true });
});

describe('the release manifest download step', () => {
  it('extracts a non-empty run block', () => {
    expect(block).toContain('from_artifact');
  });

  it('fetches from the artifact, with time limits and retries on every curl', () => {
    setup({});
    const r = run(0);
    expect(r.status).toBe(0);
    expect(r.manifest).toBe(MANIFEST);
    const log = readFileSync(join(dir, 'curl.log'), 'utf8').trim().split('\n');
    expect(log.length).toBeGreaterThanOrEqual(2);
    for (const l of log) {
      expect(l).toContain(
        '--connect-timeout 10 --max-time 60 --retry 4 --retry-all-errors --retry-delay 5',
      );
      expect(l).toContain('--fail');
    }
  });

  it('retries a failed blob download and then succeeds from the artifact', () => {
    setup({});
    const r = run(2);
    expect(r.status).toBe(0);
    expect(r.manifest).toBe(MANIFEST);
    expect(readFileSync(join(dir, 'blob-count'), 'utf8').trim()).toBe('3');
    expect(r.out).toContain('fetched from the artifact');
  });

  it('falls back to the annotation when the blob host keeps timing out', () => {
    setup({});
    const r = run(99);
    expect(r.status).toBe(0);
    expect(r.manifest).toBe(NOTE_MANIFEST);
    expect(r.out).toContain('check-run annotation');
  });

  it('falls back when the API reports no digest', () => {
    setup({ digest: null });
    const r = run(0);
    expect(r.status).toBe(0);
    expect(r.manifest).toBe(NOTE_MANIFEST);
  });

  it('fails on a digest mismatch and does not use the fallback', () => {
    setup({ digest: `sha256:${'0'.repeat(64)}` });
    const r = run(0);
    expect(r.status).toBe(1);
    expect(r.manifest).toBeNull();
    expect(r.out).toContain('digest');
    expect(readFileSync(join(dir, 'curl.log'), 'utf8')).not.toContain('annotations');
  });

  it('fails when the artifact and the annotation both fail', () => {
    setup({});
    writeFileSync(join(dir, 'annotations.json'), '[]');
    const r = run(99);
    expect(r.status).toBe(1);
    expect(r.manifest).toBeNull();
  });
});
