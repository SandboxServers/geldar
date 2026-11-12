import { describe, expect, it } from 'vitest';
import { checkFileCaps } from './file-caps.ts';
import {
  exemptionFor,
  type LineCapExemption,
  parseLineCapExemptions,
} from './line-cap-exemptions.ts';

const HARD = 700;
const lines = (n: number) => 'x\n'.repeat(n);
const list = (...entries: unknown[]) => JSON.stringify({ exemptions: entries });
const entry = (path: string, hardCap = 1200, reason = 'table-driven pin lists') => ({
  path,
  hardCap,
  reason,
});

describe('parseLineCapExemptions', () => {
  it('reads a well-formed list with no problems', () => {
    const parsed = parseLineCapExemptions(list(entry('compose/colo.yml', 900)), 'list.json', HARD);
    expect(parsed.problems).toEqual([]);
    expect(parsed.exemptions).toEqual([
      { path: 'compose/colo.yml', hardCap: 900, reason: 'table-driven pin lists' },
    ]);
  });

  it('fails an entry without a reason and leaves it out of the list', () => {
    const parsed = parseLineCapExemptions(
      list({ path: 'compose/colo.yml', hardCap: 900 }),
      'list.json',
      HARD,
    );
    expect(parsed.problems).toEqual(['list.json entry 1 (compose/colo.yml) has no reason']);
    expect(parsed.exemptions).toEqual([]);
  });

  it('fails a blank reason as well as a missing one', () => {
    const parsed = parseLineCapExemptions(list(entry('a.ts', 900, '   ')), 'list.json', HARD);
    expect(parsed.problems).toEqual(['list.json entry 1 (a.ts) has no reason']);
    expect(parsed.exemptions).toEqual([]);
  });

  it('fails an override that is not above the default hard cap', () => {
    const parsed = parseLineCapExemptions(
      list(entry('a.ts', 700), entry('b.ts', 699), entry('c.ts', 900.5)),
      'list.json',
      HARD,
    );
    expect(parsed.problems).toHaveLength(3);
    expect(parsed.problems[0]).toContain('"hardCap" must be an integer above 700');
    expect(parsed.exemptions).toEqual([]);
  });

  it('fails unknown keys, duplicate paths, bad paths and non-object entries', () => {
    const parsed = parseLineCapExemptions(
      list({ ...entry('a.ts', 900), owner: 'me' }, entry('a.ts', 900), entry('/abs.ts', 900), 42),
      'list.json',
      HARD,
    );
    expect(parsed.problems).toEqual([
      'list.json entry 1 has unknown keys: owner',
      'list.json entry 2: duplicate entry for a.ts',
      'list.json entry 3: "path" must be a repo-relative path with forward slashes',
      'list.json entry 4 is not an object',
    ]);
  });

  it('fails closed when the file is missing, not JSON or the wrong shape', () => {
    expect(parseLineCapExemptions(undefined, 'list.json', HARD).problems).toEqual([
      'list.json is missing; the line-cap exemption list fails closed',
    ]);
    expect(parseLineCapExemptions('{ nope', 'list.json', HARD).problems[0]).toMatch(
      /^list\.json is not JSON:/,
    );
    expect(parseLineCapExemptions('[]', 'list.json', HARD).problems).toEqual([
      'list.json must be an object with an "exemptions" array',
    ]);
  });
});

describe('exemptionFor', () => {
  const exemptions: LineCapExemption[] = [
    { path: 'compose/colo.yml', hardCap: 900, reason: 'one compose file' },
    { path: 'tools/*/src/*.test.ts', hardCap: 900, reason: 'table-driven pin lists' },
    { path: 'sql/**/*.sql', hardCap: 1200, reason: 'schema ledger' },
  ];

  it('matches an exact path only, with the dot literal', () => {
    expect(exemptionFor('compose/colo.yml', exemptions)?.hardCap).toBe(900);
    expect(exemptionFor('compose/colo-yml', exemptions)).toBeUndefined();
    expect(exemptionFor('compose/colo.yml.bak', exemptions)).toBeUndefined();
  });

  it('lets * stay within one path segment and ** cross segments', () => {
    expect(exemptionFor('tools/repo-checks/src/a.test.ts', exemptions)?.hardCap).toBe(900);
    expect(exemptionFor('tools/repo-checks/src/x/a.test.ts', exemptions)).toBeUndefined();
    expect(exemptionFor('sql/test/check-schema.sql', exemptions)?.hardCap).toBe(1200);
    expect(exemptionFor('sql/check-schema.sql', exemptions)?.hardCap).toBe(1200);
  });

  it('returns undefined for a file on no list', () => {
    expect(exemptionFor('golem/src/body.ts', exemptions)).toBeUndefined();
  });
});

describe('checkFileCaps with exemptions', () => {
  const colo: LineCapExemption[] = [{ path: 'compose/colo.yml', hardCap: 900, reason: 'one file' }];

  it('still fails an over-cap file that has no exemption', () => {
    const findings = checkFileCaps([{ path: 'golem/src/body.ts', text: lines(800) }], colo);
    expect(findings).toEqual([{ path: 'golem/src/body.ts', lines: 800, level: 'hard' }]);
  });

  it('passes an exempted file under its override and prints it as info with the reason', () => {
    const findings = checkFileCaps([{ path: 'compose/colo.yml', text: lines(850) }], colo);
    expect(findings).toEqual([
      {
        path: 'compose/colo.yml',
        lines: 850,
        level: 'info',
        exemption: { hardCap: 900, reason: 'one file' },
      },
    ]);
  });

  it('prints an exempted file under the soft cap as info, not as a soft warning', () => {
    const findings = checkFileCaps([{ path: 'compose/colo.yml', text: lines(600) }], colo);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('info');
  });

  it('fails an exempted file over its override, against the override', () => {
    const findings = checkFileCaps([{ path: 'compose/colo.yml', text: lines(901) }], colo);
    expect(findings).toEqual([
      {
        path: 'compose/colo.yml',
        lines: 901,
        level: 'hard',
        exemption: { hardCap: 900, reason: 'one file' },
      },
    ]);
  });

  it('allows exactly the override and flags one line over it', () => {
    expect(checkFileCaps([{ path: 'compose/colo.yml', text: lines(900) }], colo)[0]?.level).toBe(
      'info',
    );
    expect(checkFileCaps([{ path: 'compose/colo.yml', text: lines(901) }], colo)[0]?.level).toBe(
      'hard',
    );
  });
});
