import { describe, expect, it } from 'vitest';
import { capLevel, checkFileCaps, countLines, isCapped } from './file-caps.ts';

const lines = (n: number) => 'x\n'.repeat(n);

describe('isCapped', () => {
  it('caps source and config files', () => {
    expect(isCapped('golem/src/body.ts')).toBe(true);
    expect(isCapped('plugin/src/main/java/Core.java')).toBe(true);
    expect(isCapped('compose/phase0.yml')).toBe(true);
  });

  it('caps JSON, TOML and XML config as well', () => {
    expect(isCapped('contract/schemas/thought.schema.json')).toBe(true);
    expect(isCapped('plugin/gradle/libs.versions.toml')).toBe(true);
    expect(isCapped('plugin/src/main/resources/plugin.xml')).toBe(true);
  });

  it('exempts markdown, generated output, bench runs and lock files by name', () => {
    expect(isCapped('docs/spec.md')).toBe(false);
    expect(isCapped('contract/generated/types.ts')).toBe(false);
    expect(isCapped('pnpm-lock.yaml')).toBe(false);
    expect(isCapped('tools/x/package-lock.json')).toBe(false);
    expect(isCapped('plugin/gradle/verification-metadata.xml')).toBe(false);
    expect(isCapped('docs/analysis/phase0/bench-runs/20261109T130949Z-5aa8a83.json')).toBe(false);
  });
});

describe('countLines', () => {
  it('does not count a trailing newline as a line', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a')).toBe(1);
    expect(countLines('a\n')).toBe(1);
    expect(countLines('a\nb')).toBe(2);
  });
});

describe('capLevel', () => {
  it('allows exactly the caps and flags one line over', () => {
    expect(capLevel(500)).toBe('ok');
    expect(capLevel(501)).toBe('soft');
    expect(capLevel(700)).toBe('soft');
    expect(capLevel(701)).toBe('hard');
  });
});

describe('checkFileCaps', () => {
  it('reports hard findings before soft ones and skips exempt files', () => {
    const findings = checkFileCaps([
      { path: 'a.ts', text: lines(600) },
      { path: 'b.ts', text: lines(800) },
      { path: 'c.ts', text: lines(10) },
      { path: 'docs/spec.md', text: lines(2000) },
    ]);
    expect(findings).toEqual([
      { path: 'b.ts', lines: 800, level: 'hard' },
      { path: 'a.ts', lines: 600, level: 'soft' },
    ]);
  });
});
