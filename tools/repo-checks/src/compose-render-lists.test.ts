import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ci.yml renders every compose/*.yml on its own, except the files named in the skip list of its `case` line. A skipped file
// is checked merged with a base, in a `docker compose ... -f compose/<file>` line of ci.yml. nf-live-human.yml refers to the nf
// network that compose/nf-live.yml declares, so it fails alone (`refers to undefined network nf`) and must be skipped and merged.
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const ci = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');
const composeFiles = readdirSync(resolve(ROOT, 'compose')).filter((f) => /\.ya?ml$/.test(f));
const skipLine = ci.split('\n').find((l) => l.includes('continue ;; esac')) ?? '';
const skipped = new Set((/ in (.*)\) continue/.exec(skipLine)?.[1] ?? '').split('|'));
const mergedRenders = ci
  .split('\n')
  .filter((l) => l.includes('docker compose') && l.includes(' config'));
// Pre-existing gap, not part of the human lane: ci.yml skips nats-auth-mcp.yml and has no merged render for it. Reported.
const KNOWN_UNMERGED = ['nats-auth-mcp.yml'];
const escapeDots = (s: string) => s.replace(/\./g, '\\.');

describe('ci.yml compose render list', () => {
  it('names nf-live-human.yml in the skip list', () => {
    expect(skipped.has('nf-live-human.yml')).toBe(true);
  });

  it('renders nf-live-human.yml merged with compose/nf-live.yml', () => {
    expect(ci).toMatch(/-f compose\/nf-live\.yml -f compose\/nf-live-human\.yml config --quiet/);
  });

  it('gives every skipped compose file a merged render (or is a named pre-existing gap)', () => {
    const unmerged = [...skipped]
      .filter((f) => f !== '' && !KNOWN_UNMERGED.includes(f))
      .filter(
        (f) => !mergedRenders.some((l) => new RegExp(`-f compose/${escapeDots(f)}(\\s|$)`).test(l)),
      );
    expect(unmerged).toEqual([]);
  });

  it('lists only compose files that exist', () => {
    expect([...skipped].filter((f) => f !== '' && !composeFiles.includes(f))).toEqual([]);
  });
});

// geldar.ps1 `check` renders every compose/*.yml alone too, except the names in its exclusion list on the Filter line.
// nf-live-human.yml needs the nf network of nf-live.yml, so it is excluded there and rendered merged with it.
const PS1 = readFileSync(resolve(ROOT, 'geldar.ps1'), 'utf8');

describe('geldar.ps1 check render list', () => {
  it('names nf-live-human.yml in the exclusion list', () => {
    const exclusion = /Filter \*\.yml[^\n]*-notin @\(([^)]*)\)/.exec(PS1)?.[1] ?? '';
    expect(exclusion).toContain("'nf-live-human.yml'");
  });

  it('renders nf-live.yml merged with nf-live-human.yml under the geldar-nf project', () => {
    expect(PS1).toMatch(
      /docker compose -p geldar-nf -f \(Join-Path \$Root 'compose\/nf-live\.yml'\) -f \(Join-Path \$Root 'compose\/nf-live-human\.yml'\) config --quiet/,
    );
  });
});
