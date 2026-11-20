import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// CAP-1: the opt-in CoreProtect overlay mounts the verified jar into phase0's paper service, read-only, and is the only
// phase0 file that does. compose/phase0.yml stays untouched: the default stack runs without CoreProtect.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

type Volume = {
  type?: string;
  source?: string;
  target?: string;
  read_only?: boolean;
  bind?: unknown;
};

function paperVolumes(rel: string): Volume[] {
  const doc = parse(readFileSync(`${ROOT}${rel}`, 'utf8')) as {
    services?: { paper?: { volumes?: unknown[] } };
  };
  return (doc.services?.paper?.volumes ?? []) as Volume[];
}

describe('compose/opt-in/coreprotect.yml (CAP-1)', () => {
  it('mounts the CoreProtect jar at /plugins/coreprotect.jar, read-only, without creating the host path', () => {
    const jar = paperVolumes('compose/opt-in/coreprotect.yml').find(
      (v) => v.target === '/plugins/coreprotect.jar',
    );
    expect(jar).toBeDefined();
    expect(jar?.type).toBe('bind');
    expect(jar?.read_only).toBe(true);
    expect(jar?.bind).toEqual({ create_host_path: false });
  });

  it('takes the host path from GELDAR_COREPROTECT_JAR with a default under the gitignored .data/ directory', () => {
    const jar = paperVolumes('compose/opt-in/coreprotect.yml').find(
      (v) => v.target === '/plugins/coreprotect.jar',
    );
    // Concatenated: a literal `${` in one string trips biome's noTemplateCurlyInString.
    expect(jar?.source).toBe(
      `$` + '{GELDAR_COREPROTECT_JAR:-../.data/coreprotect/coreprotect.jar}',
    );
  });

  it('leaves compose/phase0.yml without a CoreProtect mount', () => {
    const phase0 = readFileSync(`${ROOT}compose/phase0.yml`, 'utf8');
    expect(phase0.toLowerCase()).not.toContain('coreprotect');
  });

  it('defines only the paper service, with no published ports', () => {
    const doc = parse(readFileSync(`${ROOT}compose/opt-in/coreprotect.yml`, 'utf8')) as {
      services?: Record<string, { ports?: unknown }>;
    };
    expect(Object.keys(doc.services ?? {})).toEqual(['paper']);
    expect(doc.services?.paper?.ports).toBeUndefined();
  });
});
