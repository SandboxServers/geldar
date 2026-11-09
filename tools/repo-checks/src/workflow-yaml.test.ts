import { describe, expect, it } from 'vitest';
import { checkWorkflowYaml, isWorkflowFile } from './workflow-yaml.ts';

const PATH = '.github/workflows/ci.yml';

describe('checkWorkflowYaml', () => {
  it('accepts a valid workflow', () => {
    const text =
      'name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n';
    expect(checkWorkflowYaml(PATH, text)).toEqual([]);
  });

  it('reports invalid YAML', () => {
    const text = 'name: ci\njobs:\n  test:\n    steps: [unclosed\n';
    const problems = checkWorkflowYaml(PATH, text);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toContain(PATH);
  });

  it('reports a duplicate key', () => {
    const text = 'name: ci\njobs:\n  test:\n    runs-on: a\n    runs-on: b\n';
    const problems = checkWorkflowYaml(PATH, text);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/unique/i);
  });

  it('reports a second document', () => {
    expect(checkWorkflowYaml(PATH, 'a: 1\n---\nb: 2\n')).toHaveLength(1);
  });
});

describe('isWorkflowFile', () => {
  it('matches only workflow files', () => {
    expect(isWorkflowFile('.github/workflows/ci.yml')).toBe(true);
    expect(isWorkflowFile('.github/workflows/x.yaml')).toBe(true);
    expect(isWorkflowFile('.github/dependabot.yml')).toBe(false);
    expect(isWorkflowFile('.github/workflows/sub/x.yml')).toBe(false);
  });
});
