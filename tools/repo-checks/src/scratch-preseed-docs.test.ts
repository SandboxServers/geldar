// Drift test for the copy-pasteable pre-seed block in docs/runbooks/scratch-stack.md. The block pastes the pins and the URLs of the
// NeoForge installer, the Proxy Compatible Forge mod, Chunky and BlueMap. Each value must equal the one the entrypoint, the overlay or
// compose/neoforge/extra-mods.pins holds. The test parses those files; it hard-codes no pin.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string): string => readFileSync(`${ROOT}${rel}`, 'utf8');
const RUNBOOK = read('docs/runbooks/scratch-stack.md');
const ENTRY = read('compose/neoforge/neoforge-entrypoint.sh');
const PINS = read('compose/neoforge/extra-mods.pins');
const OVERLAY = read('compose/opt-in/scratch-neoforge.yml');
const PHASE0 = read('compose/phase0.yml');
const CHUNKY_DOC = read('docs/analysis/neoforge/pregen-and-extra-mods-design.md');
const BLUEMAP_DOC = read('docs/runbooks/map-neoforge.md');

const HEADING = '#### Pre-seed, copy-pasteable';
const LINK = '(#pre-seed-copy-pasteable)';
const PARENT = '### If the node cannot reach the NeoForge Maven or the Modrinth CDN';

/** The subsection from its heading up to the next heading of level 1 to 4 (or the end of the runbook). */
function preseedBlock(): string {
  const start = RUNBOOK.indexOf(`\n${HEADING}\n`);
  if (start < 0) throw new Error(`the runbook has no "${HEADING}" subsection`);
  const body = RUNBOOK.slice(start + 1);
  const next = body.slice(HEADING.length).search(/\n#{1,4} /);
  return next < 0 ? body : body.slice(0, HEADING.length + next);
}

/** The value captured by a pattern over one of the source files; throws with a clear message when the pattern is gone. */
function captured(text: string, pattern: RegExp, name: string): string {
  const value = pattern.exec(text)?.[1];
  if (value === undefined) throw new Error(`${name} not found in its source file`);
  return value;
}

const INSTALLER_SHA256 = captured(
  ENTRY,
  /^INSTALLER_SHA256=\$\{GELDAR_NF_INSTALLER_SHA256:-([0-9a-f]{64})\}$/m,
  'INSTALLER_SHA256',
);
const INSTALLER_SHA512 = captured(
  ENTRY,
  /^INSTALLER_SHA512=\$\{GELDAR_NF_INSTALLER_SHA512:-([0-9a-f]{128})\}$/m,
  'INSTALLER_SHA512',
);
const MOD_SHA512 = captured(
  ENTRY,
  /^MOD_SHA512=\$\{GELDAR_NF_MOD_SHA512:-([0-9a-f]{128})\}$/m,
  'MOD_SHA512',
);
const MOD_URL = captured(ENTRY, /^MOD_URL=\$\{GELDAR_NF_MOD_URL:-([^}\s]+)\}$/m, 'MOD_URL');
const INSTALLER_URL_TEMPLATE = captured(
  ENTRY,
  /^INSTALLER_URL="\$\{GELDAR_NF_INSTALLER_URL:-(https:\/\/[^"]+)\}"$/m,
  'INSTALLER_URL',
);
const BUILD = captured(
  OVERLAY,
  /NEOFORGE_VERSION: "26\.1\.2\.\$\{SCRATCH_NEOFORGE_BUILD:-(\d+)\}"/,
  'SCRATCH_NEOFORGE_BUILD',
);
const NEOFORGE_VERSION = `26.1.2.${BUILD}`;
// The installer URL the entrypoint would use by default, with NEOFORGE_VERSION set to the overlay's build.
const INSTALLER_URL = INSTALLER_URL_TEMPLATE.replace(/\$\{NEOFORGE_VERSION\}/g, NEOFORGE_VERSION);
const PAPER_IMAGE = captured(
  PHASE0,
  /^\s+image: (itzg\/minecraft-server:\S+)$/m,
  'the paper image',
);

/** The pin of a mod, from its line in compose/neoforge/extra-mods.pins (<name> <sha256> <file> <version>). */
function pinSha256(name: string): string {
  const sha = PINS.split('\n')
    .find((line) => line.split(' ')[0] === name)
    ?.split(' ')[1];
  if (sha === undefined || !/^[0-9a-f]{64}$/.test(sha))
    throw new Error(`no sha256 pin for ${name} in extra-mods.pins`);
  return sha;
}

/** Every `sha256sum`/`sha512sum` line of the block: the hash (64 or 128 hex digits) and the staged file name. */
function sumLines(block: string): Array<{ alg: string; hash: string; file: string }> {
  return [...block.matchAll(/^([0-9a-f]{64}|[0-9a-f]{128}) {2}(\S+)$/gm)].map((m) => ({
    alg: (m[1] ?? '').length === 64 ? 'sha256' : 'sha512',
    hash: m[1] ?? '',
    file: m[2] ?? '',
  }));
}

/** The `curl -fLo <file> '<url>'` lines of the block (single or double quotes), by staged file name. */
function curlLines(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/^curl -fLo (\S+) (['"])(\S+)\2$/gm)].map((m) => [m[1] ?? '', m[3] ?? '']),
  );
}

// The pinned values the block must carry, keyed by "<algorithm> <staged file>". Each is read from its source, never typed here.
const PINNED_SUMS = new Map<string, string>([
  ['sha256 in/neoforge-installer.jar', INSTALLER_SHA256],
  ['sha512 in/neoforge-installer.jar', INSTALLER_SHA512],
  ['sha512 in/mods/proxy-compatible-forge.jar', MOD_SHA512],
  ['sha256 extra/chunky.jar', pinSha256('chunky')],
  ['sha256 extra/bluemap.jar', pinSha256('bluemap')],
]);

describe('scratch runbook: the copy-pasteable pre-seed block', () => {
  it('the subsection exists under the pre-seed section, and that section links to it', () => {
    expect(RUNBOOK.indexOf(HEADING)).toBeGreaterThan(-1);
    const parent = RUNBOOK.indexOf(PARENT);
    expect(parent).toBeGreaterThan(-1);
    const link = RUNBOOK.indexOf(LINK);
    expect(link).toBeGreaterThan(parent);
    expect(link).toBeLessThan(RUNBOOK.indexOf(HEADING));
  });

  it('every pinned hash in the block equals its entrypoint default or its extra-mods.pins value, and the block names exactly those five', () => {
    const sums = sumLines(preseedBlock());
    const keyed = new Map(sums.map((s) => [`${s.alg} ${s.file}`, s.hash]));
    expect(sums).toHaveLength(PINNED_SUMS.size);
    expect([...keyed.keys()].sort()).toEqual([...PINNED_SUMS.keys()].sort());
    for (const [key, pin] of PINNED_SUMS) expect(keyed.get(key), key).toBe(pin);
  });

  it('the URLs in the block are the entrypoint defaults (NEOFORGE_VERSION from the overlay build), and the recorded Chunky and BlueMap URLs', () => {
    const urls = curlLines(preseedBlock());
    expect(urls.size).toBe(4);
    // The block sets B to the overlay build and V to 26.1.2.$B; the installer URL is built from V.
    const block = preseedBlock();
    expect(block).toContain(`\nB=${BUILD}\n`);
    expect(block).toContain('\nV=26.1.2.$B\n');
    expect(urls.get('in/neoforge-installer.jar')?.replace(/\$V/g, NEOFORGE_VERSION)).toBe(
      INSTALLER_URL,
    );
    expect(urls.get('in/mods/proxy-compatible-forge.jar')).toBe(MOD_URL);
    expect(CHUNKY_DOC).toContain(urls.get('extra/chunky.jar') ?? '<no chunky URL in the block>');
    expect(BLUEMAP_DOC).toContain(urls.get('extra/bluemap.jar') ?? '<no bluemap URL in the block>');
  });

  it('the block runs the paper image of compose/phase0.yml and the scratch-nf world volume', () => {
    const block = preseedBlock();
    expect(block).toContain(PAPER_IMAGE);
    expect(block).toContain('scratch-nf_paper-data:/data');
  });
});
